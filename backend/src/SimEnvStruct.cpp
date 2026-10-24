/**
 * Волна A3 (PLAN-V2 §9, METHODOLOGY-V2 §7.1–7.3): структурный режим SimEnv — L2/L3 вокруг узкого места.
 *
 * Эпохи решения: начало каждой недели И экстренные события (отказ станка узкого места, прибытие срочного
 * заказа, вскрывшийся срыв поставки) — будущее не раскрывается, эпоха наступает в момент события.
 * Пространство ходов (kStructActs, маски «по построению»):
 *   overtime      — сверхурочная смена (суббота) на станках текущего узкого места до конца недели (+1 нед.);
 *   outsource_op  — субподряд операций узкого места у заказов с прогнозом просрочки (срок + работа, наценка);
 *   alt_route     — альтернативный тип РЦ / техкарта для самого срочного не начатого заказа (ходы A1 5/6);
 *   split         — дробление партий самого срочного не начатого заказа (ход A1 2);
 *   invest0..2    — L3: станок типа РЦ или модернизация (MTBF↑) с CAPEX, сроком ввода, ТО/экипажем,
 *                   финансирование — транши кредитной линии (минимум выборки водопада) при заказе и при вводе;
 *   draw / repay  — буфер ликвидности (транш 25 % невыбранного лимита) / погашение 50 % излишка кассы;
 *   dispatch_*    — режим диспетчеризации L0: статический чемпион | EDD | «срочный первым» поверх чемпиона.
 * Узкое место — тип РЦ с наибольшей незавершённой работой на неделю фонда его станков (наблюдаемо).
 * Все константы — с кодами паспорта rl.a3.* (Passport.cpp).
 */
#include "SimEnv.h"
#include <algorithm>
#include <cmath>
#include <numeric>

namespace maos::env {
namespace {
constexpr int kEvMachineS = 2;                       // = kEvMachine (SimEnv.cpp)
constexpr int kMaxOtAhead = 2;                       // сверхурочные — не дальше чем на 2 недели вперёд [К] rl.a3.overtime
constexpr double kDrawShare = 0.25;                  // буфер ликвидности: доля невыбранного лимита [К] rl.a3.draw
constexpr double kRepayShare = 0.5;                  // погашение: доля излишка кассы над C_min [К] rl.a3.repay
constexpr int kSatDow = 5, kSunDow = 6;              // суббота/воскресенье (день 0 = Пн)
constexpr int kOtStartMin = 360;                     // сверхурочная смена с 06:00 [К]
}  // namespace

const char* const SimEnv::kStructActNames[SimEnv::kStructActs] = {
  "noop", "overtime", "outsource_op", "alt_route", "split", "invest0", "invest1", "invest2",
  "draw", "repay", "dispatch_default", "dispatch_edd", "dispatch_expedite" };

/* ── Снимок / сброс ─────────────────────────────────────────────────────── */
void SimEnv::struct_init() {
  baseModel_ = inst_.model; baseCalByM_ = inst_.calByM; nBaseMachines_ = machineIds_.size();
  // Ставка типа РЦ (машино-час + труд) — средняя по операциям экземпляра и альтернативных техкарт.
  std::unordered_map<std::string, std::pair<double, int>> acc;
  auto add = [&](const Op& o) { for (auto& t : o.wcTypes) { auto& a = acc[t]; a.first += o.hourRate + o.laborRate; ++a.second; } };
  for (auto& [p, ops] : inst_.model.opsOf) for (auto& o : ops) add(o);
  for (auto& [p, alts] : inst_.altRoutings) for (auto& [rid, ops] : alts) for (auto& o : ops) add(o);
  for (auto& [t, a] : acc) typeRate_[t] = a.second ? a.first / a.second : 0.0;
  investWeek_.assign(inst_.investCands.size(), -1);
}

void SimEnv::struct_reset() {
  if (modelDirty_) {
    inst_.model = baseModel_; inst_.calByM = baseCalByM_;
    for (size_t i = nBaseMachines_; i < machineIds_.size(); ++i) machineIdx_.erase(machineIds_[i]);
    machineIds_.resize(nBaseMachines_); modelDirty_ = false;
  }
  otUntilWeek_.clear(); investWeek_.assign(inst_.investCands.size(), -1); drawFloor_.clear();
  dispMode_ = 0; supplyRevealT_ = -1; shockEpoch_ = false; otWeeks_ = 0;
  feeOutsource_ = feeOvertime_ = capexTotal_ = 0;
}

void SimEnv::set_dispatch(const std::string& rule, const std::vector<double>& key) {
  defRule_ = rule.empty() ? std::string("EDD") : rule; defKey_ = key;
}
void SimEnv::schedule_invest(int c, int week) {
  if (c < 0) { pendingInvest_.clear(); return; }
  if (c < (int)inst_.investCands.size()) pendingInvest_.push_back({ c, std::max(0, week) });
}

/* ── Диспетчеризация L0 в структурном режиме ─────────────────────────────── */
int SimEnv::dispatch_choice() const {
  if (dispMode_ == 1) return rule_choice("EDD");
  if (dispMode_ == 2) return expedite_choice(defKey_.empty() ? defRule_ : std::string(), defKey_);
  return defKey_.empty() ? rule_choice(defRule_) : key_choice(defKey_);
}
double SimEnv::run_l0() {
  double acc = 0; long guard = 0;
  while (!done_ && level_ == 0 && ++guard < 50'000'000) acc += step_job(dispatch_choice()).reward;
  return acc;
}

/* ── Мощность, узкое место, прогноз ──────────────────────────────────────── */
double SimEnv::week_capacity_min(const std::string& mid) const {
  const auto it = inst_.calByM.find(mid);
  const Calendar& c = it != inst_.calByM.end() ? it->second : inst_.cal;
  if (!c.any) return kWeekMin;
  double s = 0; for (auto& d : c.day) for (auto& [a, b] : d) s += std::max(0, b - a);
  return s;
}
double SimEnv::type_rate(const std::string& wct) const {
  auto it = typeRate_.find(wct); return it != typeRate_.end() ? it->second : 0.0;
}
int SimEnv::horizon_tt() const {
  const int taxP = std::max(1, inst_.fin.taxPeriodWeeks);
  return ((cfg_.horizonWeeks + taxP - 1) / taxP) * taxP;
}

std::string SimEnv::bottleneck_type() const {
  std::unordered_map<std::string, double> rem;
  for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && !jobs_[j].wcType.empty()) rem[jobs_[j].wcType] += jobs_[j].durMean;
  std::string best; double bv = -1;
  for (auto& [t, w] : rem) {
    auto it = inst_.model.machinesOf.find(t); if (it == inst_.model.machinesOf.end() || it->second.empty()) continue;
    double cap = 0; for (auto& mid : it->second) cap += week_capacity_min(mid);
    const double v = w / std::max(1.0, cap);
    if (v > bv || (v == bv && t < best)) { bv = v; best = t; }
  }
  return best;
}

// Прогноз окончания заказов: max(цепочка по средним без учёта мощности, очередь узкого места по EDD / фонд).
std::vector<double> SimEnv::project_finish(const std::string& wct) const {
  const int K = (int)ord_.size();
  std::vector<double> est(jobs_.size(), 0.0), fin(K, now_), bw(K, 0.0);
  for (int v : topo_) {
    const Job& j = jobs_[v]; double e;
    if (st_.done[v]) e = finishAt_[v] >= 0 ? finishAt_[v] : st_.out.end[v];
    else { double s0 = std::max(now_, j.releaseMin); for (int p : j.preds) s0 = std::max(s0, est[p]); e = s0 + j.durMean; }
    est[v] = e; fin[j.orderIdx] = std::max(fin[j.orderIdx], e);
    if (!st_.done[v] && j.wcType == wct) bw[j.orderIdx] += j.durMean;
  }
  double cap = 0;
  if (auto it = inst_.model.machinesOf.find(wct); it != inst_.model.machinesOf.end()) for (auto& mid : it->second) cap += week_capacity_min(mid);
  const double rate = std::max(1e-9, cap / kWeekMin);      // машино-минут узкого места на календарную минуту
  std::vector<int> ord(K); std::iota(ord.begin(), ord.end(), 0);
  std::sort(ord.begin(), ord.end(), [&](int a, int b) { return due_[a] != due_[b] ? due_[a] < due_[b] : a < b; });
  double cum = 0;
  for (int k : ord) { if (bw[k] <= 0) continue; cum += bw[k]; fin[k] = std::max(fin[k], std::max(now_, inst_.orders[k].releaseMin) + cum / rate); }
  return fin;
}

int SimEnv::urgent_order_for(int kind) const {
  int best = -1; double bs = 1e300;
  for (int k = 0; k < (int)ord_.size(); ++k) {
    if (!move_allowed(kind, k)) continue;
    const double slack = due_[k] - now_ - order_cycle_min(k);
    if (slack < bs) { bs = slack; best = k; }
  }
  return best;
}

/* ── Маски ───────────────────────────────────────────────────────────────── */
bool SimEnv::struct_allowed(int a) const {
  if (a == kSNoop) return true;
  if (a <= 0 || a >= kStructActs || done_) return false;
  const auto [c, u] = cash_state();
  switch (a) {
    case kSOvertime: {
      if (inst_.overtimeHoursWeek <= 0 || week_ >= cfg_.horizonWeeks) return false;
      const std::string bn = bottleneck_type(); if (bn.empty()) return false;
      auto it = otUntilWeek_.find(bn); const int until = it != otUntilWeek_.end() ? it->second : week_;
      return until < week_ + kMaxOtAhead;
    }
    case kSOutsource: {
      if (inst_.outsourceLeadHours <= 0 || inst_.outsourceOpMarkup <= 0 || c + u <= 0) return false;
      return !outsource_pick(bottleneck_type()).empty();
    }
    case kSAltRoute: return urgent_order_for(6) >= 0 || urgent_order_for(5) >= 0;
    case kSSplit: return urgent_order_for(2) >= 0;
    case kSInvest0: case kSInvest1: case kSInvest2: {
      const int ci = a - kSInvest0;
      if (ci >= (int)inst_.investCands.size() || investWeek_[ci] >= 0) return false;
      const InvestCand& ic = inst_.investCands[ci];
      if (ic.capex <= 0 || !inst_.model.machinesOf.count(ic.wct)) return false;
      if (week_ + ic.leadWeeks >= cfg_.horizonWeeks) return false;            // ввод до конца горизонта
      return c + u >= ic.capex * ic.prepayShare;
    }
    case kSDraw: return u > 1e-9 && week_ < cfg_.horizonWeeks;
    case kSRepay: {
      const bool hasDebt = !(cashValid_ && !cashRes_.periods.empty()) ? inst_.fin.d0 > 0 : cashRes_.periods.back().debt > 0;
      return hasDebt && c - inst_.fin.cMin > 0;
    }
    case kSDispDefault: return dispMode_ != 0;
    case kSDispEdd: return dispMode_ != 1;
    case kSDispExpedite: return dispMode_ != 2 && rushRelease_ >= 0 && now_ >= rushRelease_ - 1e-9;
  }
  return false;
}

/* ── Ходы ────────────────────────────────────────────────────────────────── */
void SimEnv::refresh_calendar(const std::string& wct) {
  auto it = inst_.model.machinesOf.find(wct); if (it == inst_.model.machinesOf.end()) return;
  auto ot = otUntilWeek_.find(wct);
  const bool active = ot != otUntilWeek_.end() && ot->second > week_;
  const std::string first = it->second.empty() ? std::string() : it->second.front();
  for (auto& mid : it->second) {
    // База: собственный график станка → график первого станка типа (купленный станок) → общий календарь.
    const Calendar* base = &inst_.cal; bool hasOwn = false;
    if (auto b = baseCalByM_.find(mid); b != baseCalByM_.end()) { base = &b->second; hasOwn = true; }
    else if (auto b2 = baseCalByM_.find(first); b2 != baseCalByM_.end()) { base = &b2->second; hasOwn = true; }
    if (!active) { if (hasOwn) inst_.calByM[mid] = *base; else inst_.calByM.erase(mid); continue; }
    Calendar cal = *base;
    if (cal.any) {
      const int dow = cal.day[kSatDow].empty() ? kSatDow : (cal.day[kSunDow].empty() ? kSunDow : -1);
      if (dow >= 0) cal.day[dow].push_back({ kOtStartMin, std::min(1440, kOtStartMin + (int)std::lround(inst_.overtimeHoursWeek * 60.0)) });
    }
    inst_.calByM[mid] = cal;
  }
  // Простаивающие станки типа — переопросить с новым календарём.
  for (auto& mid : it->second) {
    auto mi = machineIdx_.find(mid); if (mi == machineIdx_.end() || mi->second >= (int)idle_.size()) continue;
    if (idle_[mi->second]) { pollPending_[mi->second] = 1; events_.push({ now_, kEvMachineS, mi->second }); }
  }
  modelDirty_ = true;
}

void SimEnv::apply_overtime(const std::string& wct) {
  int& until = otUntilWeek_[wct];
  if (until <= week_) until = week_;
  const int charged = until;                 // оплачивается неделя `until` (текущая или следующая)
  until += 1;
  const auto it = inst_.model.machinesOf.find(wct);
  const double nMach = it != inst_.model.machinesOf.end() ? (double)it->second.size() : 0.0;
  const double fee = nMach * inst_.overtimeHoursWeek * type_rate(wct) * inst_.overtimeCostMul;
  if ((int)weekly_.size() <= charged) weekly_.resize(charged + 1);
  weekly_[charged].otherFixed += fee; feeOvertime_ += fee; ++otWeeks_;
  refresh_calendar(wct);
}

void SimEnv::expire_overtime(int week) {
  std::vector<std::string> ended;
  for (auto& [w, until] : otUntilWeek_) if (until <= week) ended.push_back(w);
  for (auto& w : ended) { otUntilWeek_.erase(w); refresh_calendar(w); }
}

// Джобы узкого места к субподряду: заказы с прогнозом просрочки, чьё ожидание в очереди (работа впереди по EDD
// / фонд) длиннее срока субподрядчика (иначе субподряд только задержит), по сроку; объём — доля недельного фонда.
std::vector<int> SimEnv::outsource_pick(const std::string& wct) const {
  std::vector<int> out;
  if (wct.empty() || !inst_.model.machinesOf.count(wct)) return out;
  double cap = 0; for (auto& mid : inst_.model.machinesOf.at(wct)) cap += week_capacity_min(mid);
  const double target = inst_.outsourceOpShare * cap, lead = inst_.outsourceLeadHours * 60.0;
  const std::vector<double> proj = project_finish(wct);
  const double rate = std::max(1e-9, cap / kWeekMin);
  const int K = (int)ord_.size();
  std::vector<double> bw(K, 0.0);
  for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && jobs_[j].wcType == wct) bw[jobs_[j].orderIdx] += jobs_[j].durMean;
  std::vector<int> ord(K); std::iota(ord.begin(), ord.end(), 0);
  std::sort(ord.begin(), ord.end(), [&](int a, int b) { return due_[a] != due_[b] ? due_[a] < due_[b] : a < b; });
  double ahead = 0, work = 0;
  for (int k : ord) {
    if (bw[k] <= 0) continue;
    const bool pick = proj[k] > due_[k] + 1e-9 && ahead / rate > lead;
    ahead += bw[k];
    if (!pick) continue;
    for (int i = ord_[k].jobBegin; i < ord_[k].jobEnd && work < target; ++i)
      if (!st_.done[i] && !outsrcJob_[i] && jobs_[i].wcType == wct) { out.push_back(i); work += jobs_[i].durMean; }
    if (work >= target) break;
  }
  return out;
}

int SimEnv::outsource_bottleneck(const std::string& wct, std::vector<std::string>& opsOut) {
  const std::vector<int> pick = outsource_pick(wct);
  if (pick.empty()) return 0;
  for (int i : pick) {
    ord_[jobs_[i].orderIdx].outsourcedOps.insert(jobs_[i].opId + "#" + std::to_string(jobs_[i].batchIdx));
    opsOut.push_back(std::to_string(jobs_[i].orderIdx) + ":" + jobs_[i].opId + "#" + std::to_string(jobs_[i].batchIdx));
  }
  std::vector<char> keep(jobs_.size(), 1);
  rebuild_jobs(&keep);
  place_ready_outsourced();
  return (int)pick.size();
}

// Субподряд, чьи предшественники уже завершены, передаётся сразу (иначе — по завершении предшественника).
void SimEnv::place_ready_outsourced() {
  for (size_t j = 0; j < jobs_.size(); ++j) {
    if (st_.done[j] || !outsrcJob_[j] || st_.predLeft[j] != 0 || jobs_[j].releaseMin > now_ + 1e-9) continue;
    bool ready = true; for (int p : jobs_[j].preds) if (finishAt_[p] > now_ + 1e-9) { ready = false; break; }
    if (ready) auto_place_ready_supply((int)j);
  }
}

void SimEnv::order_invest(int c) {
  const InvestCand& ic = inst_.investCands[c];
  const int w0 = week_;
  investWeek_[c] = w0;
  const double tDel = std::max(now_, w0 * kWeekMin) + ic.leadWeeks * kWeekMin;
  const int wd = (int)std::floor(tDel / kWeekMin), TT = horizon_tt();
  const int need = std::max(wd, TT) + 1;
  if ((int)weekly_.size() < need) weekly_.resize(need);
  if ((int)drawFloor_.size() < need) drawFloor_.resize(need, 0.0);
  const double pre = ic.capex * ic.prepayShare, rest = ic.capex - pre;
  weekly_[w0].capex += pre; drawFloor_[w0] += pre;          // транш при заказе
  weekly_[wd].capex += rest; drawFloor_[wd] += rest;        // транш при вводе
  const double dep = ic.capex / std::max(1.0, ic.lifeWeeks);
  for (int w = wd; w < TT; ++w) { weekly_[w].depreciation += dep; weekly_[w].repairPlanned += ic.opexWeekly; }
  capexTotal_ += ic.capex;
  events_.push({ tDel, kEvInvest, c });
  modelDirty_ = true;
}

void SimEnv::activate_invest(int c) {
  const InvestCand& ic = inst_.investCands[c];
  Model& m = inst_.model;
  modelDirty_ = true;
  if (ic.kind == "modernize") {
    auto& rk = m.wctRisk[ic.wct]; rk.mtbf *= std::max(1e-9, ic.mtbfMul); rk.repairH *= std::max(0.0, ic.repairMul);
    return;
  }
  const std::string mid = "inv-" + ic.id;
  if (machineIdx_.count(mid)) return;
  m.machinesOf[ic.wct].push_back(mid); m.machineWct[mid] = ic.wct; m.machineName[mid] = "Новый станок " + ic.wct;
  const int mi = (int)machineIds_.size();
  machineIds_.push_back(mid); machineIdx_[mid] = mi;
  idle_.push_back(1); pollPending_.push_back(1); st_.mFree[mid] = now_;
  if (!m.workers.empty()) {                  // экипаж станка: рабочий с допуском к типу
    sched::WorkerInfo w; w.id = "inv-crew-" + ic.id; w.name = w.id; w.skills = { ic.wct };
    m.workers.push_back(w); st_.wFree.push_back(now_); st_.out.busyByWorker.push_back(0.0);
    if (auto el = m.eligibleWorkers.find(ic.wct); el != m.eligibleWorkers.end()) el->second.push_back((int)m.workers.size() - 1);
  }
  refresh_calendar(ic.wct);                   // календарь типа (+ сверхурочные, если действуют)
  events_.push({ now_, kEvMachineS, mi });
}

bool SimEnv::apply_struct(int a, std::string& why) {
  if (!struct_allowed(a) || a == kSNoop) { why = "маска"; return false; }
  MoveLog ml; ml.week = week_; ml.id = "mv-" + std::to_string(++moveSeq_);
  const std::string bn = bottleneck_type();
  const auto [c, u] = cash_state();
  ml.before = { {"week", week_}, {"t_h", now_ / 60.0}, {"bottleneck", bn}, {"cash", c}, {"undrawn", u},
                {"trigger", shockEpoch_ ? "shock" : "week"} };
  ml.kind = kStructActNames[a];
  switch (a) {
    case kSOvertime:
      apply_overtime(bn);
      ml.after = { {"wc_type", bn}, {"until_week", otUntilWeek_[bn]}, {"hours_week", inst_.overtimeHoursWeek} };
      ml.masksChecked = { "узкое место существует", "не дальше 2 недель вперёд", "неделя < горизонта" };
      break;
    case kSOutsource: {
      std::vector<std::string> ops; const int n = outsource_bottleneck(bn, ops);
      if (n == 0) { why = "нет джоб"; return false; }
      ml.after = { {"wc_type", bn}, {"n_jobs", n}, {"jobs", ops} };
      ml.masksChecked = { "предложение субподряда [К]", "прогноз просрочки заказа", "ожидание в очереди > срока субподрядчика" };
      break;
    }
    case kSAltRoute: case kSSplit: {      // ходы A1 (2 split, 5 reroute, 6 reassign) без слотов kMaxOrders
      int kind = a == kSSplit ? 2 : 6, k = urgent_order_for(kind);
      if (k < 0 && a == kSAltRoute) { kind = 5; k = urgent_order_for(5); }
      if (k < 0) { why = "маска"; return false; }
      OrderState& os = ord_[k]; const OrderSpec& o = inst_.orders[k];
      ml.orderIdx = k; ml.kind = kMoveKindNames[kind];
      const double sf = std::max(1.0, o.qty / (inst_.model.prods.count(o.productId) ? inst_.model.prods.at(o.productId).batchSize : 1));
      const int N = os.nBatches > 0 ? os.nBatches : sched::Expander::nBatches(sf);
      if (kind == 2) os.nBatches = N * 2;
      else if (kind == 5) os.routingAlt = (os.routingAlt + 2) % ((int)inst_.altRoutings.at(o.productId).size() + 1) - 1;
      else { std::string alt; const std::string op = bottleneck_op_of(k, alt); os.forcedType[op] = alt; ml.after["op_id"] = op; ml.after["wc_type"] = alt; }
      ml.after["n_batches"] = os.nBatches; ml.after["routing_alt"] = os.routingAlt;
      ml.masksChecked = { "заказ не начат", "самый срочный из допустимых" };
      std::vector<char> keep(jobs_.size(), 1);
      rebuild_jobs(&keep);
      break;
    }
    case kSInvest0: case kSInvest1: case kSInvest2: {
      const int ci = a - kSInvest0; const InvestCand& ic = inst_.investCands[ci];
      order_invest(ci);
      ml.kind = ic.kind == "modernize" ? "modernize" : "invest";
      ml.after = { {"cand", ic.id}, {"wc_type", ic.wct}, {"capex", ic.capex}, {"lead_weeks", ic.leadWeeks},
                   {"delivery_week", week_ + ic.leadWeeks}, {"tranche_now", ic.capex * ic.prepayShare},
                   {"source", ic.source} };
      ml.masksChecked = { "кандидат не куплен", "ввод до конца горизонта", "C_t + U_t ≥ транш при заказе" };
      break;
    }
    case kSDraw: {
      if ((int)drawFloor_.size() <= week_) drawFloor_.resize(week_ + 1, 0.0);
      drawFloor_[week_] += kDrawShare * u; ml.kind = "finance";
      ml.after = { {"drawdown_floor", drawFloor_[week_]} }; ml.masksChecked = { "d_t ≤ U_t" };
      break;
    }
    case kSRepay: {
      if ((int)drawPlan_.size() <= week_) { drawPlan_.resize(week_ + 1, -1); repayPlan_.resize(week_ + 1, -1); }
      repayPlan_[week_] = kRepayShare * std::max(0.0, c - inst_.fin.cMin); ml.kind = "finance";
      ml.after = { {"repayment", repayPlan_[week_]} }; ml.masksChecked = { "rep_t ≤ C_t − C_min" };
      break;
    }
    case kSDispDefault: case kSDispEdd: case kSDispExpedite:
      dispMode_ = a - kSDispDefault; ml.kind = "dispatch";
      ml.after = { {"mode", kStructActNames[a]} }; ml.masksChecked = { "режим отличается от текущего" };
      break;
  }
  moves_.push_back(ml);
  return true;
}

/* ── Наблюдение L3 (kStructObs признаков) ─────────────────────────────────── */
void SimEnv::build_obs_struct() {
  std::fill(obsL2_.begin(), obsL2_.end(), 0.f); std::fill(maskL2_.begin(), maskL2_.end(), 0);
  if (week_ > 0 && (!cashValid_ || (int)cashRes_.periods.size() != week_)) { cashRes_ = run_cash(week_); cashValid_ = true; }
  float* f = obsL2_.data();
  const double H = std::max(1, cfg_.horizonWeeks) * kWeekMin;
  const std::string bn = bottleneck_type();
  // Загрузка: работа типа / недельный фонд (недель работы впереди) — узкое место и второе.
  std::unordered_map<std::string, double> rem; double remAll = 0;
  for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && !jobs_[j].wcType.empty()) { rem[jobs_[j].wcType] += jobs_[j].durMean; remAll += jobs_[j].durMean; }
  std::vector<double> loads;
  double capAll = 0;
  for (auto& [t, mids] : inst_.model.machinesOf) {
    double cap = 0; for (auto& mid : mids) cap += week_capacity_min(mid);
    capAll += cap;
    if (cap > 0 && rem.count(t)) loads.push_back(rem.at(t) / cap);
  }
  std::sort(loads.rbegin(), loads.rend());
  const double weeksLeft = std::max(1e-3, (H - now_) / kWeekMin);
  f[0] = (float)week_ / std::max(1, cfg_.horizonWeeks); f[1] = (float)(now_ / H);
  f[2] = loads.size() > 0 ? (float)std::min(10.0, loads[0] / weeksLeft) : 0.f;
  f[3] = loads.size() > 1 ? (float)std::min(10.0, loads[1] / weeksLeft) : 0.f;
  double bnCap = 0, readyBn = 0; int nBn = 0;
  if (!bn.empty()) {
    for (auto& mid : inst_.model.machinesOf.at(bn)) { bnCap += week_capacity_min(mid); ++nBn; }
    for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && st_.predLeft[j] == 0 && jobs_[j].wcType == bn) readyBn += jobs_[j].durMean;
  }
  f[4] = bnCap > 0 ? (float)std::min(10.0, readyBn / bnCap) : 0.f;
  if (auto ot = otUntilWeek_.find(bn); ot != otUntilWeek_.end()) f[5] = (float)std::max(0, ot->second - week_) / kMaxOtAhead;
  f[6] = (float)otWeeks_ / std::max(1, cfg_.horizonWeeks);
  f[7] = (outageMi_ >= 0 && now_ >= outA_ - 1e-9 && now_ < outB_ - 1e-9) ? 1.f : 0.f;
  f[8] = (shockT_ >= 0 && now_ >= shockT_ - 1e-9) ? 1.f : 0.f;
  if (rushRelease_ >= 0 && now_ >= rushRelease_ - 1e-9 && (int)ord_.size() > nBaseOrders_) {
    double r = 0, tot = 0;
    for (int k = nBaseOrders_; k < (int)ord_.size(); ++k)
      for (int i = ord_[k].jobBegin; i < ord_[k].jobEnd; ++i) { tot += jobs_[i].durMean; if (!st_.done[i]) r += jobs_[i].durMean; }
    f[9] = tot > 0 ? (float)(r / tot) : 0.f;
    const int k = (int)ord_.size() - 1;
    f[10] = (float)std::max(-3.0, std::min(3.0, (due_[k] - now_ - order_cycle_min(k)) / scaleT_));
  }
  f[11] = (supplyRevealT_ >= 0 && now_ >= supplyRevealT_ - 1e-9) ? 1.f : 0.f;
  // Прогноз просрочки с учётом мощности узкого места.
  const std::vector<double> proj = bn.empty() ? std::vector<double>(ord_.size(), now_) : project_finish(bn);
  double tard = 0, valLate = 0, valAll = 0, minSlack = 1e300; int nLate = 0, nOpen = 0, nFin = 0;
  for (size_t k = 0; k < ord_.size(); ++k) {
    const double v = inst_.orders[k].price * inst_.orders[k].qty; valAll += v;
    if (ord_[k].finishMin >= 0) { ++nFin; continue; }
    ++nOpen; const double late = proj[k] - due_[k];
    if (late > 0) { tard += late; ++nLate; valLate += v; }
    minSlack = std::min(minSlack, due_[k] - proj[k]);
  }
  f[12] = (float)std::min(10.0, tard / std::max(1.0, scaleT_ * std::max(1, nOpen)));
  f[13] = nOpen ? (float)nLate / nOpen : 0.f;
  f[14] = valAll > 0 ? (float)(valLate / valAll) : 0.f;
  f[15] = nOpen ? (float)std::max(-3.0, std::min(3.0, minSlack / kWeekMin / 4.0)) : 0.f;
  f[16] = ord_.empty() ? 0.f : (float)nFin / ord_.size();
  f[17] = jobs_.empty() ? 0.f : (float)st_.nDone / jobs_.size();
  // Деньги.
  const auto [c, u] = cash_state(); const double lim = std::max(1.0, inst_.fin.creditLimit);
  f[18] = (float)std::max(-5.0, std::min(5.0, c / scaleMoney_)); f[19] = (float)(u / lim);
  const double debt = (cashValid_ && !cashRes_.periods.empty()) ? cashRes_.periods.back().debt : inst_.fin.d0;
  f[20] = (float)std::min(3.0, debt / lim);
  f[21] = (cashValid_ && cashRes_.breach) ? 1.f : 0.f;
  f[22] = cashValid_ ? (float)std::max(-5.0, std::min(5.0, cashRes_.minCash / scaleMoney_)) : 0.f;
  const int wk = std::min(week_, std::max(0, (int)sc_.keyRate.size() - 1));
  f[23] = (float)((!sc_.keyRate.empty() ? sc_.keyRate[wk] : inst_.fin.keyRate) / 0.2);
  const int rg = (week_ < (int)sc_.regime.size()) ? sc_.regime[week_] : 0; if (rg >= 0 && rg < 3) f[24 + rg] = 1.f;
  f[27] = (!sc_.fx.empty() && sc_.fx[0] > 0) ? (float)(sc_.fx[std::min(week_, (int)sc_.fx.size() - 1)] / sc_.fx[0] - 1.0) : 0.f;
  for (int ci = 0; ci < kInvestSlots && ci < (int)inst_.investCands.size(); ++ci) {
    const InvestCand& ic = inst_.investCands[ci];
    f[28 + ci] = investWeek_[ci] >= 0 ? 1.f : 0.f;
    if (investWeek_[ci] >= 0) f[31 + ci] = (float)std::max(0.0, investWeek_[ci] + ic.leadWeeks - week_) / std::max(1.0, ic.leadWeeks);
    f[34 + ci] = (float)std::min(3.0, ic.capex / std::max(1.0, c + u));
  }
  f[37] = (float)(feeOutsource_ / scaleMoney_); f[38] = (float)(feeOvertime_ / scaleMoney_);
  f[39 + std::min(2, std::max(0, dispMode_))] = 1.f;
  f[42] = (float)movesThisWeek_ / std::max(1, cfg_.maxMovesPerWeek);
  f[43] = shockEpoch_ ? 1.f : 0.f;
  f[44] = capAll > 0 ? (float)std::min(10.0, remAll / capAll / weeksLeft) : 0.f;
  f[45] = (float)(weeksLeft * kWeekMin / H);
  f[46] = (!inst_.investCands.empty() && inst_.investCands[0].wct == bn) ? 1.f : 0.f;
  f[47] = (float)nBn / 10.0f;
  if (cfg_.structObsA4) build_obs_a4(f, bn, c, u);
  for (int a = 0; a < kStructActs; ++a) maskL2_[a] = struct_allowed(a) ? 1 : 0;
}

/* ── A4: последствия ходов (дешёвый взгляд вперёд) и дескрипторы экземпляра ── */
// Прогноз окончания заказов с ходом: та же модель, что project_finish (цепочка по средним + очередь узкого места по
// EDD / фонд), но extraE машино-минут сверхурочных в ближайшую неделю (очередь до cap + E проходит за неделю, дальше —
// со сдвигом на E) и джобы removed у субподрядчика (срок + работа, вне очереди узкого места).
std::vector<double> SimEnv::project_finish_alt(const std::string& wct, double extraE, const std::vector<int>& removed) const {
  const int K = (int)ord_.size();
  std::vector<char> rem(jobs_.size(), 0);
  for (int j : removed) if (j >= 0 && j < (int)jobs_.size()) rem[j] = 1;
  const double lead = inst_.outsourceLeadHours * 60.0;
  std::vector<double> est(jobs_.size(), 0.0), fin(K, now_), bw(K, 0.0);
  for (int v : topo_) {
    const Job& j = jobs_[v]; double e;
    if (st_.done[v]) e = finishAt_[v] >= 0 ? finishAt_[v] : st_.out.end[v];
    else { double s0 = std::max(now_, j.releaseMin); for (int p : j.preds) s0 = std::max(s0, est[p]); e = s0 + (rem[v] ? lead : 0.0) + j.durMean; }
    est[v] = e; fin[j.orderIdx] = std::max(fin[j.orderIdx], e);
    if (!st_.done[v] && !rem[v] && j.wcType == wct) bw[j.orderIdx] += j.durMean;
  }
  double cap = 0;
  if (auto it = inst_.model.machinesOf.find(wct); it != inst_.model.machinesOf.end()) for (auto& mid : it->second) cap += week_capacity_min(mid);
  const double rate = std::max(1e-9, cap / kWeekMin);
  std::vector<int> ord(K); std::iota(ord.begin(), ord.end(), 0);
  std::sort(ord.begin(), ord.end(), [&](int a, int b) { return due_[a] != due_[b] ? due_[a] < due_[b] : a < b; });
  double cum = 0;
  for (int k : ord) {
    if (bw[k] <= 0) continue;
    cum += bw[k];
    const double q = extraE <= 0 ? cum : (cum >= cap + extraE ? cum - extraE : cum * cap / std::max(1e-9, cap + extraE));
    fin[k] = std::max(fin[k], std::max(now_, inst_.orders[k].releaseMin) + q / rate);
  }
  return fin;
}

// Цена окончания заказа k в момент fin: штраф договора (A3) или, если окончание за горизонтом водопада, потеря
// маржи (выручка не признаётся, материалы остаются запасом). Завершённые заказы уже в водопаде → 0.
std::pair<double,double> SimEnv::order_cost(int k, double fin) const {
  if (ord_[k].finishMin >= 0) return { 0.0, 0.0 };
  const OrderSpec& o = inst_.orders[k];
  const double val = o.price * o.qty * sc_.priceMul;
  if (fin >= horizon_tt() * kWeekMin) return { 0.0, std::max(0.0, val - o.matCost * o.qty) };
  const double lateW = std::max(0.0, fin - due_[k]) / kWeekMin;
  if (lateW <= 0) return { 0.0, 0.0 };
  if (k >= nBaseOrders_) return { cfg_.rushLateLoss * val, 0.0 };
  const double perW = inst_.latePerWeek >= 0 ? inst_.latePerWeek : cfg_.tardPenaltyPerWeek;
  const double cap = inst_.lateCap >= 0 ? inst_.lateCap : cfg_.tardPenaltyCap;
  return { std::min(cap, inst_.lateFixed + perW * lateW) * val, 0.0 };
}

// f[48..79]: последствия ходов в % стоимости портфеля V (обрезка ±10), запас ликвидности (доли V), дескрипторы.
void SimEnv::build_obs_a4(float* f, const std::string& bn, double c, double u) const {
  double V = 0, margin = 0, maxDue = 0;
  for (int k = 0; k < nBaseOrders_ && k < (int)inst_.orders.size(); ++k) {
    const OrderSpec& o = inst_.orders[k];
    V += o.price * o.qty; margin += (o.price - o.matCost) * o.qty; maxDue = std::max(maxDue, o.dueMin);
  }
  V = std::max(1.0, V);
  auto pct = [&](double x) { return (float)std::max(-10.0, std::min(10.0, 100.0 * x / V)); };
  auto frac = [&](double x) { return (float)std::max(-5.0, std::min(5.0, x / V)); };
  auto costs = [&](const std::vector<double>& fin) {
    std::pair<double,double> s{ 0.0, 0.0 };
    for (int k = 0; k < (int)ord_.size(); ++k) { const auto pc = order_cost(k, fin[k]); s.first += pc.first; s.second += pc.second; }
    return s;
  };
  auto put = [&](int at, std::pair<double,double> base, std::pair<double,double> alt, double fee) {
    f[at] = pct(base.first - alt.first); f[at + 1] = pct(base.second - alt.second); f[at + 2] = pct(fee);
    f[at + 3] = pct(base.first + base.second - alt.first - alt.second - fee);
  };
  if (!bn.empty()) {
    const auto base = costs(project_finish_alt(bn, 0.0, {}));
    if (struct_allowed(kSOvertime)) {                     // сверхурочные: +16 ч/станок узкого места на неделю
      const auto it = inst_.model.machinesOf.find(bn);
      const double nM = it != inst_.model.machinesOf.end() ? (double)it->second.size() : 0.0;
      const double fee = nM * inst_.overtimeHoursWeek * type_rate(bn) * inst_.overtimeCostMul;
      put(48, base, costs(project_finish_alt(bn, nM * inst_.overtimeHoursWeek * 60.0, {})), fee);
    }
    if (struct_allowed(kSOutsource)) {                    // субподряд: те же джобы, что выберет ход
      const std::vector<int> pick = outsource_pick(bn);
      double fee = 0; for (int j : pick) fee += inst_.outsourceOpMarkup * jobs_[j].durMean / 60.0 * (jobs_[j].hourRate + jobs_[j].laborRate);
      put(52, base, costs(project_finish_alt(bn, 0.0, pick)), fee);
    }
  }
  f[68] = frac(c + u);
  for (int ci = 0; ci < kInvestSlots && ci < (int)inst_.investCands.size(); ++ci) {
    const InvestCand& ic = inst_.investCands[ci];
    f[69 + ci] = frac(c + u - ic.capex * ic.prepayShare);
    if (ci >= (int)inst_.investLa.size() || !struct_allowed(kSInvest0 + ci)) continue;
    const auto& row = inst_.investLa[ci];
    if (week_ < (int)row.size())
      for (int q = 0; q < 4 && q < (int)row[week_].size(); ++q) f[56 + 4 * ci + q] = (float)std::max(-10.0, std::min(10.0, row[week_][q]));
  }
  // Дескрипторы экземпляра (класс по сроку последнего заказа: ≤ 6 нед. — малый, ≤ 12 — средний, иначе крупный).
  const double dueW = maxDue / kWeekMin;
  f[dueW <= 6.0 ? 72 : (dueW <= 12.0 ? 73 : 74)] = 1.f;
  f[75] = frac(inst_.fin.creditLimit); f[76] = frac(inst_.fin.c0);
  f[77] = frac(26.0 * (inst_.otherFixedWeekly + inst_.payrollFixedWeekly + inst_.repairBudgetWeekly));
  f[78] = frac(margin);
  f[79] = inst_.investCands.empty() ? 0.f : frac(inst_.investCands[0].capex);
}

json SimEnv::struct_state() const {
  const std::string bn = bottleneck_type();
  const auto [c, u] = cash_state();
  json inv = json::array();
  for (size_t ci = 0; ci < inst_.investCands.size(); ++ci) inv.push_back({ {"id", inst_.investCands[ci].id}, {"week", investWeek_[ci]} });
  json ot = json::object(); for (auto& [w, until] : otUntilWeek_) ot[w] = until;
  return { {"week", week_}, {"t_h", now_ / 60.0}, {"bottleneck", bn}, {"cash", c}, {"undrawn", u}, {"dispatch", dispMode_},
           {"overtime_until", ot}, {"invest", inv}, {"shock_epoch", shockEpoch_}, {"fee_overtime", feeOvertime_},
           {"fee_outsource", feeOutsource_}, {"capex", capexTotal_} };
}

}  // namespace maos::env
