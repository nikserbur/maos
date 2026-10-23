#include "Scheduler.h"
#include "SchedCore.h"
#include "RlRule.h"
#include "CpSatRule.h"
#include "GaImprover.h"
#include "PlanMath.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <queue>
#include <random>
#include <cctype>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace maos {
namespace sched {


// Рабочих минут в [0, makespan] (фонд времени для загрузки/простоя ресурса).
double working_span(const Calendar& cal, double makespan) {
  if (!cal.any || makespan <= 0) return makespan > 0 ? makespan : 1;
  double w = 0; long days = (long)(makespan / 1440) + 1;
  for (long d = 0; d <= days; ++d) {
    int dow = (int)((d % 7 + 7) % 7);
    for (auto& [s, e] : cal.day[dow]) {
      double lo = std::max(0.0, d * 1440.0 + s), hi = std::min(makespan, d * 1440.0 + e);
      if (hi > lo) w += hi - lo;
    }
  }
  return w > 0 ? w : makespan;
}

Calendar load_calendar(Database& db, bool enabled) {
  Calendar c;
  if (!enabled) return c;
  auto sched = db.query_json("SELECT id FROM schedules WHERE is_default=1 LIMIT 1");
  if (sched.empty()) sched = db.query_json("SELECT id FROM schedules LIMIT 1");
  if (sched.empty()) return c;
  std::string sid = str(sched[0], "id");
  for (auto& s : db.query_json("SELECT day_of_week,start_min,end_min FROM shifts WHERE schedule_id=?", { sid })) {
    int dow = (int)num(s, "day_of_week", 1) - 1;        // 1..7 → 0..6
    if (dow < 0 || dow > 6) continue;
    int a = (int)num(s, "start_min", 0), b = (int)num(s, "end_min", 1440);
    if (b > a) { c.day[dow].push_back({ a, b }); c.any = true; }
  }
  return c;
}

double num(const json& j, const char* k, double def) {
  if (!j.contains(k) || j[k].is_null()) return def;
  if (j[k].is_number()) return j[k].get<double>();
  const std::string s = j[k].get<std::string>();
  if (s.empty()) return def;
  try { return std::stod(s); } catch (...) { return def; }
}
std::string str(const json& j, const char* k) {
  if (!j.contains(k) || j[k].is_null()) return "";
  if (j[k].is_string()) return j[k].get<std::string>();
  return j[k].dump();
}


// Только ASCII (не std::tolower): под не-«C» локалью (nanobind-модуль в Python) побайтовый
// tolower портит байты UTF-8 кириллицы; для имён типов РЦ этого достаточно.
static std::string lower(std::string s) {
  for (char& c : s) if (c >= 'A' && c <= 'Z') c = (char)(c + ('a' - 'A'));
  return s;
}

Model load_model(Database& db) {
  Model m;
  std::unordered_map<std::string,double> rate;
  for (auto& t : db.query_json(
         "SELECT id,name,hour_rate,mtbf_hours,repair_hours,mtbm_hours,maintenance_hours "
         "FROM work_center_types")) {
    rate[str(t,"id")] = num(t,"hour_rate"); m.wcName[str(t,"id")] = str(t,"name");
    Model::WctRisk rk;
    rk.mtbf = num(t,"mtbf_hours"); rk.repairH = num(t,"repair_hours");
    rk.mtbm = num(t,"mtbm_hours"); rk.maintH  = num(t,"maintenance_hours");
    if (rk.mtbf > 0 || rk.mtbm > 0) m.wctRisk[str(t,"id")] = rk;
  }
  for (auto& mc : db.query_json(
         "SELECT id,name,wc_type_id,schedule FROM machines WHERE status='active' "
         "AND wc_type_id IS NOT NULL AND wc_type_id<>''")) {
    m.machinesOf[str(mc,"wc_type_id")].push_back(str(mc,"id"));
    m.machineName[str(mc,"id")] = str(mc,"name"); m.machineWct[str(mc,"id")] = str(mc,"wc_type_id");
    const std::string sch = str(mc,"schedule");
    if (!sch.empty()) m.machineSched[str(mc,"id")] = sch;   // индивидуальный график
  }
  for (auto& p : db.query_json("SELECT id,name,batch_size,stock,purchased,lead_time_hours FROM products")) {
    Prod pr; pr.batchSize = std::max(1.0, num(p,"batch_size",1));
    pr.stock = num(p,"stock"); pr.purchased = num(p,"purchased") != 0; pr.leadHours = num(p,"lead_time_hours");
    m.prods[str(p,"id")] = pr;
    m.prodName[str(p,"id")] = str(p,"name");
  }
  for (auto& w : db.query_json("SELECT id,first_name,last_name,skills,cost_per_hour FROM workers")) {
    WorkerInfo wi; wi.id = str(w,"id");
    wi.name = str(w,"last_name") + " " + str(w,"first_name");
    wi.costPerHour = num(w,"cost_per_hour");
    // Компетенции — CSV токенов (имена/ID типов РЦ); пусто = универсал.
    std::string raw = str(w,"skills");
    size_t pos = 0;
    while (pos < raw.size()) {
      size_t c = raw.find(',', pos);
      std::string tok = raw.substr(pos, c == std::string::npos ? std::string::npos : c - pos);
      size_t a = tok.find_first_not_of(" \t"), b = tok.find_last_not_of(" \t");
      if (a != std::string::npos) wi.skills.push_back(lower(tok.substr(a, b - a + 1)));
      if (c == std::string::npos) break; pos = c + 1;
    }
    m.workers.push_back(std::move(wi));
  }

  // Связи операций — двумя запросами на всю модель (было 2 SQL на каждую операцию).
  // Загружаем ВСЕ допустимые типы (FJSP): операция может исполняться на любом из
  // них — раньше брался только первый, и альтернативная мощность простаивала.
  std::unordered_map<std::string, std::vector<std::string>> wctsOf;
  for (auto& r : db.query_json(
         "SELECT operation_id, wc_type_id FROM operation_wc_types ORDER BY rowid"))
    wctsOf[str(r,"operation_id")].push_back(str(r,"wc_type_id"));
  std::unordered_map<std::string, std::vector<std::pair<std::string,double>>> inputsOf;
  for (auto& r : db.query_json("SELECT operation_id, product_id, qty FROM operation_inputs"))
    inputsOf[str(r,"operation_id")].push_back({ str(r,"product_id"), num(r,"qty",1) });

  // Нормы «операция × тип» (time_norms): при наличии пары норма берётся из неё,
  // а не из плоских полей операции (ТЗ «Время выполнения операции» §2).
  struct PairNorm { double tOpt, tNorm, tPess, setup; };
  std::unordered_map<std::string, PairNorm> normOf;   // "opId|wctId" → норма пары
  for (auto& r : db.query_json("SELECT * FROM time_norms"))
    normOf[str(r,"operation_id") + "|" + str(r,"wc_type_id")] =
      { num(r,"t_opt"), num(r,"t_norm"), num(r,"t_pess"), num(r,"setup_time") };

  for (auto& o : db.query_json(
         "SELECT o.*, r.product_id AS product_of FROM routings r "
         "JOIN operations o ON o.routing_id = r.id "
         "WHERE r.product_id IS NOT NULL AND r.product_id <> '' "
         "AND COALESCE(r.is_default,1)=1 "               // действующая версия техкарты
         "ORDER BY r.product_id, o.order_no, o.id")) {
    std::string pid = str(o,"product_of");
    Op op; op.id = str(o,"id"); op.name = str(o,"name");
    double tOpt = num(o,"t_opt"), tNorm = num(o,"t_norm"), tPess = num(o,"t_pess");
    if (tOpt <= 0) tOpt = tNorm; if (tPess <= 0) tPess = tNorm;
    op.tExp = (tOpt + 4*tNorm + tPess) / 6.0; if (op.tExp <= 0) op.tExp = tNorm > 0 ? tNorm : 30;
    double s = (tPess - tOpt) / 6.0; op.sigma = s > 0 ? s : op.tExp * 0.15;
    op.setupTime = num(o,"setup_time"); op.riskCoef = num(o,"risk_coef",0.05);
    op.tailWeight = num(o,"tail_weight",0.08); op.tailIndex = std::max(1.2, num(o,"tail_index",2.5));
    op.orderNo = (int)num(o,"order_no",10);
    if (auto w = wctsOf.find(op.id); w != wctsOf.end()) op.wcTypes = w->second;
    op.wcType = op.wcTypes.empty() ? std::string() : op.wcTypes.front();
    // Норма пары для ведущего типа перекрывает плоскую норму операции.
    if (auto nit = normOf.find(op.id + "|" + op.wcType); nit != normOf.end()) {
      const PairNorm& pn = nit->second;
      double o2 = pn.tOpt > 0 ? pn.tOpt : pn.tNorm, p2 = pn.tPess > 0 ? pn.tPess : pn.tNorm;
      if (pn.tNorm > 0) {
        op.tExp = (o2 + 4*pn.tNorm + p2) / 6.0;
        double s2 = (p2 - o2) / 6.0; op.sigma = s2 > 0 ? s2 : op.tExp * 0.15;
      }
      if (pn.setup > 0) op.setupTime = pn.setup;
    }
    auto it = rate.find(op.wcType); op.hourRate = it != rate.end() ? it->second : 0;
    op.laborRate = num(o,"labor_rate");
    if (auto i2 = inputsOf.find(op.id); i2 != inputsOf.end()) op.inputs = i2->second;
    m.opsOf[pid].push_back(std::move(op));
  }

  // Матрица компетенций: рабочий допущен к типу РЦ, если его skills пусты
  // (универсал) или содержат имя/ID типа. Пустой список по типу → допущены все.
  for (auto& [wct, mids] : m.machinesOf) {
    const std::string nm = lower(m.wcName.count(wct) ? m.wcName.at(wct) : wct);
    const std::string idl = lower(wct);
    std::vector<int> elig;
    for (size_t w = 0; w < m.workers.size(); ++w) {
      const auto& sk = m.workers[w].skills;
      if (sk.empty()) { elig.push_back((int)w); continue; }
      for (const std::string& t : sk)
        if (t == nm || t == idl || (t.size() > 3 && nm.find(t) != std::string::npos)) {
          elig.push_back((int)w); break;
        }
    }
    if (!elig.empty() && elig.size() < m.workers.size())
      m.eligibleWorkers[wct] = std::move(elig);
  }
  return m;
}

/* Индивидуальный график станка из строки machines.schedule: '8x5' (пн-пт 8ч),
   '12x2' (ежедневно 12ч), '24x7' (круглосуточно). Возвращает false, если график
   не распознан (пусто/прочее) → станок работает по общему календарю.
   B4: '24x7' распознаётся ЯВНО и даёт календарь без ограничений (any=false —
   работа круглосуточно); раньше он возвращал any=false как «не задан» и станок
   молча падал на общий сменный календарь. */
bool machine_calendar(std::string sched, Calendar& c) {
  c = Calendar{};
  sched.erase(0, sched.find_first_not_of(" \t"));
  sched.erase(sched.find_last_not_of(" \t") + 1);
  for (char& ch : sched) ch = (char)std::tolower((unsigned char)ch);
  if (sched == "8x5") {
    for (int d = 0; d < 5; ++d) c.day[d].push_back({ 480, 960 });     // 08:00–16:00
    c.any = true;
    return true;
  }
  if (sched == "12x2") {
    for (int d = 0; d < 7; ++d) c.day[d].push_back({ 480, 1200 });    // 08:00–20:00
    c.any = true;
    return true;
  }
  if (sched == "24x7" || sched == "24/7") return true;                // круглосуточно
  return false;
}



double sample_dur(const Job& j, double twOverride, std::mt19937& rng) {
  double mean = std::max(0.5, j.durMean), cv = j.sigma / mean;
  double sl = std::sqrt(std::log(1.0 + cv * cv)), mu = std::log(mean) - 0.5 * sl * sl;
  std::normal_distribution<double> n(0, 1); std::uniform_real_distribution<double> u(0, 1);
  double d = std::exp(mu + std::max(1e-6, sl) * n(rng));
  double tw = twOverride >= 0 ? twOverride : j.tailWeight;
  if (u(rng) < tw) { double f = std::pow(std::max(1e-9, 1.0 - u(rng)), -1.0 / j.tailIndex);
                     d *= 1.0 + std::min(8.0, f - 1.0); }            // тяжёлый хвост (Парето)
  if (u(rng) < j.riskCoef) d += 0.5 * mean;                          // брак/переделка
  return std::max(0.1, d);
}


std::vector<double> priorities(const std::string& rule, const std::vector<Job>& jobs,
                               const std::vector<double>& orderWork,
                               const CustomRule& custom) {
  size_t J = jobs.size(); std::vector<double> key(J, 0);

  // Остаточная работа ПО ЦЕПОЧКЕ (критический путь вперёд): rem = dur + max(rem succ).
  // Раньше CR/MS считались от ПОЛНОЙ работы заказа — правила вырождались в EDD
  // («Требования эвристики» §2: CR/MS — от оставшейся работы).
  const bool customUsesRem = rule == "CUSTOM" &&
    std::any_of(custom.begin(), custom.end(), [](auto& c) { return c.first == "rem"; });
  std::vector<double> rem(J, 0);
  if (rule == "CR" || rule == "MS" || rule == "MWKR" || customUsesRem) {
    std::vector<std::vector<int>> succ(J);
    std::vector<int> succLeft(J, 0);
    for (size_t i = 0; i < J; ++i)
      for (int p : jobs[i].preds) if (p >= 0 && p < (int)J) succ[p].push_back((int)i);
    for (size_t i = 0; i < J; ++i) succLeft[i] = (int)succ[i].size();
    std::vector<int> stack; std::vector<double> best(J, 0);
    for (size_t i = 0; i < J; ++i) if (succLeft[i] == 0) stack.push_back((int)i);
    while (!stack.empty()) {
      int v = stack.back(); stack.pop_back();
      rem[v] = jobs[v].durMean + best[v];
      for (int p : jobs[v].preds) if (p >= 0 && p < (int)J) {
        best[p] = std::max(best[p], rem[v]);
        if (--succLeft[p] == 0) stack.push_back(p);
      }
    }
  }

  // ── КОНСТРУКТОР: key = Σ w_c · norm_c (минмакс-нормализация каждого критерия;
  // меньший key = раньше, отрицательный вес = «больше — раньше»). Позволяет
  // собирать эвристики из пресетов: «LPT, но из длинных раньше те, у кого
  // больше входных материалов» = duration:-1 + inputs:-0.2.
  if (rule == "CUSTOM" && !custom.empty()) {
    auto critOf = [&](const std::string& c, size_t i) -> double {
      const Job& j = jobs[i];
      if (c == "duration") return j.durMean;
      if (c == "due")      return j.dueMin;
      if (c == "rem")      return rem[i];
      if (c == "inputs")   return (double)j.nInputs;
      if (c == "setup")    return j.setupTime;
      return 0;
    };
    for (auto& [cname, w] : custom) {
      if (w == 0) continue;
      double lo = 1e300, hi = -1e300;
      for (size_t i = 0; i < J; ++i) {
        double v = critOf(cname, i);
        lo = std::min(lo, v); hi = std::max(hi, v);
      }
      const double span = hi > lo ? hi - lo : 1.0;
      for (size_t i = 0; i < J; ++i)
        key[i] += w * (critOf(cname, i) - lo) / span;
    }
    return key;
  }

  for (size_t i = 0; i < J; ++i) {
    const Job& j = jobs[i]; double ow = orderWork[j.orderIdx] > 0 ? orderWork[j.orderIdx] : 1;
    if (rule == "SPT")       key[i] = j.durMean;
    else if (rule == "LPT")  key[i] = -j.durMean;
    else if (rule == "EDD")  key[i] = j.dueMin;
    else if (rule == "CR")   key[i] = j.dueMin / std::max(1.0, rem[i]);
    else if (rule == "MWKR") key[i] = -std::max(rem[i], 1.0);
    else if (rule == "MS")   key[i] = j.dueMin - rem[i];
    else { (void)ow;         key[i] = j.orderIdx * 1e6 + (double)i; }  // FIFO
  }
  return key;
}

void sim_init(SimState& st, const Model& m, const std::vector<Job>& jobs) {
  const size_t J = jobs.size(); SimOut& o = st.out;
  o = SimOut{};
  o.start.assign(J,0); o.end.assign(J,0); o.machineId.assign(J,""); o.worker.assign(J,-1);
  o.busyByWorker.assign(m.workers.size(), 0);
  o.setupJ.assign(J, 0); o.downJ.assign(J, 0);
  st.mFree.clear(); st.wFree.assign(m.workers.size(), 0);
  st.lastProd.clear(); st.usage.clear();
  st.predLeft.assign(J, 0); st.succ.assign(J, {});
  for (size_t i = 0; i < J; ++i) {
    st.predLeft[i] = (int)jobs[i].preds.size();
    for (int p : jobs[i].preds) if (p >= 0 && p < (int)J) st.succ[p].push_back((int)i);
  }
  st.done.assign(J, 0); st.nDone = 0;
}

// Шаг размещения — ядро списочного планирования, общее для simulate() и SimEnv:
// выбор станка (least-loaded по всем допустимым типам, либо принудительный) и
// рабочего, наладка при смене изделия, ТО/поломки, снап к календарю.
Placement sim_place(SimState& st, const Model& m, const std::vector<Job>& jobs, int best,
                    const std::vector<double>& dur, const Calendar& cal,
                    const std::unordered_map<std::string, Calendar>& calByM,
                    const PinMap& pins, std::mt19937* rng,
                    const std::string& forcedMachine, double notBefore) {
  SimOut& o = st.out;
  auto& mFree = st.mFree; auto& wFree = st.wFree; auto& lastProd = st.lastProd; auto& usage = st.usage;
  const Job& j = jobs[best];
  double readyT = 0; for (int p : j.preds) readyT = std::max(readyT, o.end[p]);
  // Ручная правка (pin): фиксированный станок и «не раньше» время старта.
  const auto pinIt = pins.find(best);
  // FJSP: станок выбирается среди ВСЕХ допустимых типов операции (раньше — только
  // первый тип: альтернативная мощность простаивала, узкое место не разгружалось).
  std::string chosenM; double mfree = 0;
  if (!forcedMachine.empty()) {                                  // SimEnv: станок выбрал агент
    chosenM = forcedMachine;
    mfree = mFree.count(chosenM) ? mFree[chosenM] : 0;
  } else if (pinIt != pins.end() && !pinIt->second.second.empty()) {
    chosenM = pinIt->second.second;
    mfree = mFree.count(chosenM) ? mFree[chosenM] : 0;
  } else {
    double bm = 1e300;
    auto consider = [&](const std::string& wct) {
      if (auto it = m.machinesOf.find(wct); it != m.machinesOf.end())
        for (auto& mid : it->second) {
          double f = mFree.count(mid) ? mFree[mid] : 0;
          if (f < bm) { bm = f; chosenM = mid; }
        }
    };
    if (!j.wcTypes.empty()) for (auto& w : j.wcTypes) consider(w);
    else if (!j.wcType.empty()) consider(j.wcType);
    if (!chosenM.empty()) mfree = bm;
  }
  // Длительность на ВЫБРАННОМ типе: норма пары (durByType, FJSP-бенчмарки) масштабирует
  // общий розыгрыш; пусто → как раньше (одна норма операции).
  double d = dur[best];
  if (!j.durByType.empty() && !chosenM.empty() && m.machineWct.count(chosenM)) {
    const std::string& wct = m.machineWct.at(chosenM);
    for (auto& [t, mean] : j.durByType)
      if (t == wct && j.durMean > 0) { d = dur[best] * mean / j.durMean; break; }
  }
  // Рабочий — наименее занятый из ДОПУЩЕННЫХ к типу выбранного станка
  // (матрица компетенций); тип без матрицы → любой рабочий.
  // B3: «поставка» (только срок поставщика, без станка) рабочего НЕ занимает —
  // раньше рабочий блокировался на весь lead time поставщика.
  int wi = -1; double wfree = 0;
  if (!m.workers.empty() && j.needsWorker) {
    double bw = 1e300;
    auto scan = [&](int w) { if (wFree[w] < bw) { bw = wFree[w]; wi = w; } };
    const std::string mwct = !chosenM.empty() && m.machineWct.count(chosenM)
                           ? m.machineWct.at(chosenM) : j.wcType;
    auto el = m.eligibleWorkers.find(mwct);
    if (el != m.eligibleWorkers.end()) for (int w : el->second) scan(w);
    else for (size_t w = 0; w < wFree.size(); ++w) scan((int)w);
    wfree = bw;
  }
  // Наладка при СМЕНЕ ИЗДЕЛИЯ на станке (sequence-dependent, упрощённо: константа
  // операции). Раньше наладка входила только в первую transfer-партию независимо
  // от того, что стоял на станке до этого.
  double setup = 0;
  if (!chosenM.empty() && j.setupTime > 0) {
    auto lp = lastProd.find(chosenM);
    if (lp == lastProd.end() || lp->second != j.productId) setup = j.setupTime;
  }
  // ── Надёжность: плановое ТО по наработке + случайные поломки ──────────
  // ТО: при пересечении наработкой границы k·mtbm станок останавливается на
  // maintH часов. Поломка: интенсивность растёт с ЗАГРУЗКОЙ станка (чем выше
  // утилизация — тем чаще отказ: λ = (1/MTBF)·(0.5+1.5·util)); время ремонта —
  // логнормальное (CV 0.6) со своим распределением.
  double downtime = 0;
  if (!chosenM.empty() && m.machineWct.count(chosenM)) {
    auto rkIt = m.wctRisk.find(m.machineWct.at(chosenM));
    if (rkIt != m.wctRisk.end()) {
      const auto& rk = rkIt->second;
      const double u = usage.count(chosenM) ? usage.at(chosenM) : 0;
      if (rk.mtbm > 0 && rk.maintH > 0) {
        const double step = rk.mtbm * 60.0;
        if (std::floor((u + d) / step) > std::floor(u / step)) {
          downtime += rk.maintH * 60.0;
          o.maintMinutes += rk.maintH * 60.0;
        }
      }
      if (rng && rk.mtbf > 0 && rk.repairH > 0) {
        const double t0m = std::max(mfree, 1.0);
        const double util = std::min(1.0, u / t0m);            // загрузка станка к моменту
        const double lam = (1.0 / (rk.mtbf * 60.0)) * (0.5 + 1.5 * util);
        std::uniform_real_distribution<double> u01(0, 1);
        if (u01(*rng) < 1.0 - std::exp(-lam * d)) {
          std::normal_distribution<double> nz(0, 1);
          const double cv = 0.6, sl = std::sqrt(std::log(1.0 + cv * cv));
          const double rep = rk.repairH * 60.0 * std::exp(sl * nz(*rng) - 0.5 * sl * sl);
          downtime += rep; o.nBreakdowns++; o.breakdownMinutes += rep;
        }
      }
    }
  }
  const double work = d + setup + downtime;
  // Календарь: индивидуальный график станка (если задан) вместо общего.
  const Calendar& mcal = (!chosenM.empty() && calByM.count(chosenM)) ? calByM.at(chosenM) : cal;
  double t0 = std::max(readyT, std::max(mfree, wfree));
  t0 = std::max(t0, std::max(notBefore, j.releaseMin));                 // SimEnv: событие/сдвиг запуска
  if (pinIt != pins.end()) t0 = std::max(t0, pinIt->second.first);     // «не раньше» из пина
  double st0 = mcal.nextWork(t0);                                      // снап к рабочему времени
  double en = mcal.advance(st0, work);                                 // финиш с учётом смен
  o.start[best] = st0; o.end[best] = en; o.machineId[best] = chosenM; o.worker[best] = wi;
  o.setupJ[best] = setup; o.downJ[best] = downtime;
  if (!chosenM.empty()) {
    mFree[chosenM] = en; o.busyByMachine[chosenM] += work; lastProd[chosenM] = j.productId;
    usage[chosenM] += work;
    if (setup > 0) {
      o.nSetups++; o.setupMinutes += setup;
      o.setupCost += (setup / 60.0) * (j.hourRate + j.laborRate);
    }
  }
  if (wi >= 0) wFree[wi] = en, o.busyByWorker[wi] += work;
  o.makespan = std::max(o.makespan, en); st.done[best] = 1; ++st.nDone;
  for (int s : st.succ[best]) --st.predLeft[s];
  Placement pl; pl.machineId = chosenM; pl.worker = wi; pl.start = st0; pl.end = en;
  pl.setup = setup; pl.downtime = downtime; pl.proc = d;
  return pl;
}

// rng: nullptr → детерминированный прогон (без случайных поломок; плановое ТО
// учитывается всегда). В МК-прогонах поломки сэмплируются.
SimOut simulate(const Model& m, const std::vector<Job>& jobs,
                const std::vector<double>& key, const std::vector<double>& dur,
                const Calendar& cal,
                const std::unordered_map<std::string, Calendar>& calByM,
                const PinMap& pins, std::mt19937* rng) {
  size_t J = jobs.size();
  SimState st; sim_init(st, m, jobs);
  // Готовность через ОЧЕРЕДЬ ПРИОРИТЕТА (по key): O(J·logJ) вместо O(J²) — иначе большой
  // план (тысячи операций × правила × сэмплы) подвисает.
  using PQItem = std::pair<double,int>;
  std::priority_queue<PQItem, std::vector<PQItem>, std::greater<PQItem>> ready;
  for (size_t i = 0; i < J; ++i) if (st.predLeft[i] == 0) ready.push({ key[i], (int)i });
  size_t sched = 0, scan = 0;
  while (sched < J) {
    int best = -1;
    if (!ready.empty()) { best = ready.top().second; ready.pop(); }
    else { while (scan < J && st.done[scan]) ++scan; if (scan < J) best = (int)scan; else break; }
    if (best < 0 || st.done[best]) continue;
    sim_place(st, m, jobs, best, dur, cal, calByM, pins, rng, std::string(), 0.0);
    ++sched;
    for (int s : st.succ[best]) if (st.predLeft[s] == 0) ready.push({ key[s], s });
  }
  return std::move(st.out);
}

double order_tardiness(const std::vector<Job>& jobs, const SimOut& o, int nOrders,
                       const std::vector<double>& due, int& nLate) {
  std::vector<double> fin(nOrders, 0);
  for (size_t i = 0; i < jobs.size(); ++i) fin[jobs[i].orderIdx] = std::max(fin[jobs[i].orderIdx], o.end[i]);
  double t = 0; nLate = 0;
  for (int k = 0; k < nOrders; ++k) { double late = std::max(0.0, fin[k] - due[k]); t += late; if (late > 1e-6) ++nLate; }
  return t;
}

double cvar_upper(std::vector<double> v, double alpha) {  // среднее ХУДШИХ (больших) alpha
  if (v.empty()) return 0; std::sort(v.begin(), v.end());
  size_t k = std::max<size_t>(1, (size_t)std::floor(alpha * v.size())); double s = 0;
  for (size_t i = v.size() - k; i < v.size(); ++i) s += v[i]; return s / k;
}
double mean_of(const std::vector<double>& v) { double s = 0; for (double x : v) s += x; return v.empty()?0:s/v.size(); }

}  // namespace sched
using namespace sched;

namespace {

/* ── Волна A2: правило «CP-SAT» (sidecar rl/cpsat_service.py) ──────────────────── */
struct CpSatPlan {
  cpsat::Solution sol;
  PinMap pins;                 // жёсткий план: «не раньше старта CP-SAT» + станок CP-SAT
  PinMap machinePins;          // только станки CP-SAT — маршрутизация для ГА по операциям
  std::vector<double> key;     // ранг старта
  double replayMk = 0;         // детерминированный Cmax воспроизведения пинами (sim_place, мин)
  std::string hintRule;        // правило-подсказка солверу
};

// Решение CP-SAT по той же развёртке джобов; подсказка — лучший детерминированный план правила.
CpSatPlan plan_cpsat(const Model& m, const std::vector<Job>& jobs, const Calendar& cal,
                     const std::unordered_map<std::string, Calendar>& calByM, const std::vector<double>& due,
                     const std::vector<double>& orderWork, const std::vector<double>& durMean,
                     const PinMap& userPins, const ScheduleParams& p, int nOrders) {
  CpSatPlan cp;
  SimOut hint; double bestF = 1e300;
  for (const char* r : { "EDD", "SPT", "CR", "MWKR", "MS", "FIFO", "LPT" }) {
    SimOut so = simulate(m, jobs, priorities(r, jobs, orderWork), durMean, cal, calByM, userPins);
    int nl; const double f = so.makespan + 0.5 * order_tardiness(jobs, so, nOrders, due, nl);
    if (f < bestF) { bestF = f; hint = std::move(so); cp.hintRule = r; }
  }
  const double tl = std::clamp(p.cpsatTimeLimit, 1.0, 600.0);
  const double wTard = 0.5 / std::max(1e-6, p.wTime);    // F ∝ Cmax + (0.5/w_time)·просрочка
  const json payload = cpsat::build_payload(m, jobs, cal, calByM, due, tl, p.seed, wTard, &hint);
  cp.sol = cpsat::solve(payload, tl);
  if (!cp.sol.ok) return cp;
  cp.pins = cpsat::pins_from(cp.sol, userPins);
  cp.machinePins = cpsat::machine_pins_from(cp.sol, userPins);
  cp.key = cpsat::rank_key(cp.sol.starts);
  cp.replayMk = simulate(m, jobs, cp.key, durMean, cal, calByM, cp.pins).makespan;
  return cp;
}

// Парный бутстреп по сценариям: Δ = b − a для среднего и CVaR_α (верхнего хвоста), 95 %-ДИ.
json paired_delta_ci(const std::vector<double>& a, const std::vector<double>& b, double alpha, unsigned seed) {
  const size_t n = std::min(a.size(), b.size());
  if (n == 0) return nullptr;
  constexpr int kBoot = 1000;                            // техн.: число бутстреп-выборок
  std::mt19937 rng(seed);
  std::vector<double> dm, dc;
  dm.reserve(kBoot); dc.reserve(kBoot);
  for (int t = 0; t < kBoot; ++t) {
    std::vector<double> xa(n), xb(n);
    for (size_t i = 0; i < n; ++i) { const size_t k = rng() % n; xa[i] = a[k]; xb[i] = b[k]; }
    dm.push_back(mean_of(xb) - mean_of(xa));
    dc.push_back(cvar_upper(xb, alpha) - cvar_upper(xa, alpha));
  }
  std::sort(dm.begin(), dm.end()); std::sort(dc.begin(), dc.end());
  auto q = [&](const std::vector<double>& v, double t) { return v[std::min(v.size() - 1, (size_t)(t * v.size()))]; };
  return { {"n", (int)n},
           {"delta_mean", mean_of(b) - mean_of(a)}, {"ci_mean", { q(dm, 0.025), q(dm, 0.975) }},
           {"delta_cvar", cvar_upper(b, alpha) - cvar_upper(a, alpha)}, {"ci_cvar", { q(dc, 0.025), q(dc, 0.975) }} };
}

}  // namespace

/* ── Главная процедура ───────────────────────────────────────────────────── */
json run_schedule(Database& db, const ScheduleParams& p) {
  Model m = load_model(db);
  Calendar cal = load_calendar(db, p.useCalendar);   // рабочий календарь (смены/выходные)
  json warnings = json::array();

  // ── Программа: из запроса / из портфеля прогона / демо ──
  std::vector<OrderLine> program = p.program;
  double portfolioHorizon = 0;                 // горизонт прогона Стадии 2, ч
  if (program.empty() && !p.runId.empty()) {   // программа из портфеля Стадии 2
    auto rows = db.query_json(
      "SELECT pi.product_id AS pid, pi.qty AS qty FROM portfolios pf "
      "JOIN portfolio_items pi ON pi.portfolio_id=pf.id "
      "WHERE pf.run_id=? AND pf.kind='robust'", { p.runId });
    for (auto& r : rows) program.push_back({ str(r,"pid"), num(r,"qty"), 0 });
    // Сроки заказов = горизонт прогона оптимизации: раньше due=0 → сроки
    // выдумывались формулой, и связка стадий теряла горизонт (двухстадийная
    // модель требует общий горизонт плана и программы).
    try {
      auto rr = db.query_one("SELECT result_json FROM optimization_runs WHERE id=?", { p.runId });
      json rj = json::parse(str(rr, "result_json"));
      portfolioHorizon = rj.value("horizon_hours", 0.0);
    } catch (...) {}
    if (portfolioHorizon > 0)
      for (auto& ol : program) ol.dueHours = portfolioHorizon;
  }
  if (program.empty()) {                       // программа из реестра заказов
    for (auto& r : db.query_json(
           "SELECT product_id,quantity,due_hours FROM demand_orders "
           "WHERE status<>'done' ORDER BY priority, due_hours"))
      program.push_back({ str(r,"product_id"), num(r,"quantity",1), num(r,"due_hours") });
  }
  if (program.empty()) {                       // демо-программа из готовых SKU
    const std::vector<std::pair<std::string,double>> demo = {
      {"fin-reb",180},{"fin-galv",120},{"fin-cold",150},{"fin-s235",160},
      {"fin-pnt",90},{"prod-hrc",100},
    };
    for (size_t i = 0; i < demo.size(); ++i)
      if (m.opsOf.count(demo[i].first)) program.push_back({ demo[i].first, demo[i].second, 0 });
  }
  if (program.empty()) return { {"error_soft", true},
    {"warnings", json::array({"Нет изделий с техкартами для планирования."})} };

  // Сроки заказов (если не заданы) — равномерно по «ожидаемому» горизонту.
  int nOrders = (int)program.size();
  std::vector<double> due(nOrders);

  // ── Развёртка в граф операций ──
  std::vector<Job> jobs;
  Expander ex{ m, jobs };
  for (int k = 0; k < nOrders; ++k)
    ex.expand(k, program[k].productId, std::max(1.0, program[k].qty), 1e12);  // due проставим ниже
  if (jobs.empty()) return { {"error_soft", true},
    {"warnings", json::array({"Программа не развернулась в операции (нет техкарт)."})} };

  // ── Дефицит сырья → операция «Поставка/подготовка» как предшественник заказа ──
  // Считаем потребность в покупном сырье по всей программе; для дефицитных
  // (потребность > остаток) добавляем срок поставки как отдельную подготовительную
  // операцию перед началом заказа (см. «Требования к запасам»).
  {
    std::unordered_map<std::string, double> matNeed;
    std::function<void(const std::string&, double, std::unordered_set<std::string>&, int)> reqf =
      [&](const std::string& pid, double mult, std::unordered_set<std::string>& vis, int depth) {
        if (depth > 64 || vis.count(pid)) return;             // защита от глубокой/циклической вложенности
        vis.insert(pid);
        if (auto it = m.opsOf.find(pid); it != m.opsOf.end())
          for (auto& o : it->second) for (auto& in : o.inputs) {
            matNeed[in.first] += mult * in.second; reqf(in.first, mult * in.second, vis, depth + 1);
          }
        vis.erase(pid);
      };
    for (auto& ol : program) { std::unordered_set<std::string> vis; reqf(ol.productId, std::max(1.0, ol.qty), vis, 0); }
    double supplyLead = 0; json shortJson = json::array();
    for (auto& [mid, need] : matNeed) {
      auto pit = m.prods.find(mid);
      if (pit != m.prods.end() && pit->second.purchased && need > pit->second.stock) {
        supplyLead = std::max(supplyLead, pit->second.leadHours);
        shortJson.push_back(m.prodName.count(mid) ? m.prodName[mid] : mid);
      }
    }
    if (supplyLead > 0) {
      for (int k = 0; k < nOrders; ++k) {
        Job sj; sj.orderIdx = k; sj.productId = "supply"; sj.opId = "supply";
        sj.opName = "Поставка/подготовка сырья"; sj.wcType = "";
        sj.durMean = supplyLead * 60.0; sj.sigma = supplyLead * 60.0 * 0.2;
        sj.riskCoef = 0.05; sj.tailWeight = 0.12; sj.tailIndex = 2.0;
        sj.hourRate = 0; sj.laborRate = 0; sj.dueMin = 1e12;
        sj.needsWorker = false;                                  // B3: срок поставщика — не работа цеха
        int sjIdx = (int)jobs.size(); jobs.push_back(sj);
        for (size_t j = 0; j < jobs.size(); ++j)
          if (jobs[j].orderIdx == k && (int)j != sjIdx && jobs[j].preds.empty())
            jobs[j].preds.push_back(sjIdx);
      }
    }
  }

  // Работа по заказам + грубая оценка горизонта для дедлайнов.
  std::vector<double> orderWork(nOrders, 0);
  for (auto& j : jobs) orderWork[j.orderIdx] += j.durMean;
  double totalWork = 0; for (double w : orderWork) totalWork += w;
  double horizon = totalWork;  // груб. верхняя граница (мин)
  for (int k = 0; k < nOrders; ++k) {
    due[k] = program[k].dueHours > 0 ? program[k].dueHours * 60.0
                                     : horizon * (0.45 + 0.55 * (k + 1.0) / nOrders);
  }
  for (auto& j : jobs) j.dueMin = due[j.orderIdx];

  // Индивидуальные календари станков ('8x5'/'12x2'/'24x7' из паспорта ЕО).
  // B4: распознанный график (в т.ч. '24x7' = без ограничений) кладётся ВСЕГДА;
  // нераспознанный/пустой → станок работает по общему календарю.
  std::unordered_map<std::string, Calendar> calByM;
  if (p.useCalendar)
    for (auto& [mid, sch] : m.machineSched) {
      Calendar mc;
      if (machine_calendar(sch, mc)) calByM.emplace(mid, std::move(mc));
    }
  // Ручные правки Ганта (drag&drop): jobIdx → (не раньше, станок).
  PinMap pinMap;
  for (const SchedPin& pn : p.pins)
    if (pn.jobIdx >= 0 && pn.jobIdx < (int)jobs.size())
      pinMap[pn.jobIdx] = { pn.startHours * 60.0, pn.machineId };

  // ── Перебор диспетч-правил (старт), оценка симуляцией + Монте-Карло (хвост) ──
  std::vector<std::string> rules = { "EDD", "SPT", "CR", "MWKR", "MS", "FIFO", "LPT" };
  const bool wantCpSat = p.rule == "CP-SAT" && p.customRule.empty();
  if (!p.customRule.empty()) rules = { "CUSTOM" };       // конструктор эвристики
  else if (wantCpSat) rules = { "CP-SAT", "EDD", "SPT", "CR", "MWKR", "MS", "FIFO", "LPT" };  // + правила для сравнения
  else if (p.rule != "auto") rules = { p.rule };
  // Волна A: правило «RL» — политика ONNX (RlRule) в событийной SimEnv даёт ключ приоритетов
  // (ранг старта) по ТОЙ ЖЕ развёртке джобов; остальной конвейер (МК, ГА, Ганта) не меняется.
  // Без политики — понятная ошибка; путь EDD/SPT/… не затронут.
  rl::RlPlan rlPlan;
  if (p.rule == "RL") {
    std::vector<std::pair<std::string,double>> prog; std::vector<double> dueH;
    for (int k = 0; k < nOrders; ++k) { prog.push_back({ program[k].productId, std::max(1.0, program[k].qty) }); dueH.push_back(due[k] / 60.0); }
    rlPlan = rl::plan(db, prog, dueH, p.useCalendar, p.seed, std::min(60, std::max(20, p.samples / 10)), p.alpha);
    if (!rlPlan.ok || rlPlan.key.size() != jobs.size())
      return { {"error_soft", true}, {"warnings", json::array({ rlPlan.ok ? std::string("Правило «RL»: размер ключа не совпал с развёрткой.") : rlPlan.error })},
               {"rl", rl::status()} };
  }
  int N = std::max(60, p.samples);
  if (jobs.size() > 1500) N = std::min(N, 40);   // крупный план — меньше сэмплов (скорость)
  std::mt19937 rng(p.seed);

  // Заранее сэмплируем длительности по прогонам (общие для всех правил — честно).
  std::vector<std::vector<double>> durMC(N, std::vector<double>(jobs.size()));
  for (int s = 0; s < N; ++s)
    for (size_t i = 0; i < jobs.size(); ++i) durMC[s][i] = sample_dur(jobs[i], p.tailWeight, rng);
  std::vector<double> durMean(jobs.size());
  for (size_t i = 0; i < jobs.size(); ++i) durMean[i] = jobs[i].durMean;

  // Волна A2: правило «CP-SAT» — точная детерминированная модель в sidecar; старты и станки
  // фиксируются пинами, дальше — тот же конвейер МК/CVaR. Sidecar недоступен → error_soft.
  CpSatPlan cp;
  if (wantCpSat) {
    cp = plan_cpsat(m, jobs, cal, calByM, due, orderWork, durMean, pinMap, p, nOrders);
    if (!cp.sol.ok)
      return { {"error_soft", true}, {"warnings", json::array({ cp.sol.error })},
               {"cpsat", { {"status", cp.sol.status}, {"error", cp.sol.error}, {"url", cpsat::sidecar_url()} }} };
  }
  auto pinsOf = [&](const std::string& rule) -> const PinMap& { return rule == "CP-SAT" ? cp.pins : pinMap; };
  auto keyOf = [&](const std::string& rule) {
    if (rule == "CP-SAT") return cp.key;
    if (rule == "RL") return rlPlan.key;
    return priorities(rule, jobs, orderWork, p.customRule);
  };

  struct RuleEval { std::string rule; double mkDet, mkMean, mkCVaR, mkWorst, tardMean, tardCVaR, setupMin, bdMin = 0, score; };
  std::vector<RuleEval> evals(rules.size());
  // Монте-Карло-оценка ПРИОРИТЕТНОГО КЛЮЧА на всех N сценариях (общие случайные
  // числа: одинаковые durMC и seed поломок для любого ключа). Используется и для
  // сравнения правил, и (B5) для итогового ключа после локального поиска.
  struct McEval { double mkMean = 0, mkCVaR = 0, mkWorst = 0, tardMean = 0, tardCVaR = 0, bdMin = 0; };
  auto mcEval = [&](const std::vector<double>& key, const PinMap& pins) {
    std::vector<double> mks(N), tards(N);
    double bdSum = 0;
    for (int s = 0; s < N; ++s) {
      std::mt19937 brng(p.seed + 7919u * (unsigned)s);   // одинаково для всех ключей
      SimOut so = simulate(m, jobs, key, durMC[s], cal, calByM, pins, &brng);
      mks[s] = so.makespan; int nl2; tards[s] = order_tardiness(jobs, so, nOrders, due, nl2);
      bdSum += so.breakdownMinutes;
    }
    McEval r;
    r.mkMean = mean_of(mks); r.mkCVaR = cvar_upper(mks, p.alpha);
    r.mkWorst = *std::max_element(mks.begin(), mks.end());
    r.tardMean = mean_of(tards); r.tardCVaR = cvar_upper(tards, p.alpha);
    r.bdMin = bdSum / N;
    return r;
  };
  // Правила НЕЗАВИСИМЫ (общие durMC read-only) — оцениваем параллельно по потокам:
  // 7 правил × (1+N) симуляций раньше шли строго последовательно.
  {
    auto evalRule = [&](size_t ri) {
      const std::string& rule = rules[ri];
      const auto key = keyOf(rule);
      const PinMap& pins = pinsOf(rule);
      SimOut det = simulate(m, jobs, key, durMean, cal, calByM, pins);
      int nl; double tardDet = order_tardiness(jobs, det, nOrders, due, nl);
      const McEval mc = mcEval(key, pins);
      RuleEval e; e.rule = rule; e.mkDet = det.makespan; e.bdMin = mc.bdMin;
      e.mkMean = mc.mkMean; e.mkCVaR = mc.mkCVaR; e.mkWorst = mc.mkWorst;
      e.tardMean = mc.tardMean; e.tardCVaR = mc.tardCVaR;
      e.setupMin = det.setupMinutes;
      // Целевая F = w_time·ВРЕМЯ + w_cost·СТОИМОСТЬ + w_risk·РИСК + просрочка
      // («Требования к оптимизации» §3). Стоимостная компонента — минуты
      // переналадок (единственная составляющая, зависящая от ПОРЯДКА; в одних
      // единицах с makespan). Раньше w_cost игнорировался вовсе.
      e.score = p.wTime * e.mkMean + p.wRisk * (e.mkCVaR - e.mkMean)
              + p.wCost * e.setupMin + 0.5 * e.tardMean + 0.001 * tardDet;
      evals[ri] = e;
    };
    std::vector<std::thread> pool;
    pool.reserve(rules.size());
    for (size_t ri = 0; ri < rules.size(); ++ri) pool.emplace_back(evalRule, ri);
    for (auto& t : pool) t.join();
  }
  size_t bestR = 0; for (size_t i = 1; i < evals.size(); ++i) if (evals[i].score < evals[bestR].score) bestR = i;
  // CP-SAT запрошен явно → он и есть план; лучшее из правил — для сравнения (gap_to_rule).
  size_t bestRuleR = bestR;
  if (wantCpSat) {
    bestRuleR = 1; for (size_t i = 2; i < evals.size(); ++i) if (evals[i].score < evals[bestRuleR].score) bestRuleR = i;
    bestR = 0;
  }
  const std::string chosenRule = evals[bestR].rule;

  // ── Детальное расписание выбранного правила (по средним — для Ганта) ──
  auto key = keyOf(chosenRule);
  const PinMap* finalPins = &pinsOf(chosenRule);        // пины итогового плана (CP-SAT — жёсткие)

  // ── Улучшение ПОВЕРХ правил («Требования эвристики» §4: диспетч-правило —
  // только стартовая точка). Генетический алгоритм по ключам приоритетов
  // (GaImprover.h). Хромосома сжатая: веса составного правила по 5 нормированным
  // критериям + сдвиг приоритета каждого заказа,
  //   key_i = Σ_c w_c·norm_c(i) + δ_заказ(i),
  // — десятки генов вместо тысяч операций (иначе мутация лишь перемешивает очередь),
  // и любое правило — точка этого пространства (EDD: w_срок=1; FIFO: δ_k=k/K).
  // Пригодность — та же F на ОБУЧАЮЩИХ сценариях [0, NS). Результат принимается,
  // только если F лучше и на ОТЛОЖЕННЫХ сценариях [NS, NS+NV): иначе выигрыш мог
  // быть подгонкой под конкретные сэмплы (оптимистичный сдвиг).
  //
  // Волна A2 — второй режим хромосомы: КЛЮЧИ ПО ОПЕРАЦИЯМ (random keys, Bean 1994): ген = ключ
  // джобы ∈ [0,1]; затравки — нормированные старты CP-SAT (если есть) и ранги ключей правил.
  // При CP-SAT маршрутизация (станки) берётся из его решения, ГА ищет робастную ОЧЕРЕДНОСТЬ.
  // Оба режима идут по одному протоколу (обучение [0,NS) → проверка [NS,NS+NV)); принимается
  // лучший по отложенным сценариям из тех, что лучше базы и там, и там.
  json improverJson = nullptr;
  bool keyImproved = false;                              // ключ изменён ГА
  const int G = ((int)jobs.size() > 3000) ? 0 : std::max(0, p.improveIters);
  const int NS = std::min(30, N / 2);                    // обучающие сценарии
  const int NV = std::min(N - NS, 120);                  // отложенные — проверка вне выборки
  // Cmax и просрочка по сценариям [s0, s1) (CRN: те же durMC и seed поломок для любого ключа).
  auto runScen = [&](const std::vector<double>& k2, const PinMap& pins, int s0, int s1,
                     std::vector<double>& mks, std::vector<double>& tards) {
    mks.assign(s1 - s0, 0); tards.assign(s1 - s0, 0);
    for (int s = s0; s < s1; ++s) {
      std::mt19937 brng(p.seed + 7919u * (unsigned)s);
      SimOut so = simulate(m, jobs, k2, durMC[s], cal, calByM, pins, &brng);
      mks[s - s0] = so.makespan; int n3; tards[s - s0] = order_tardiness(jobs, so, nOrders, due, n3);
    }
  };
  auto scoreOn = [&](const std::vector<double>& k2, int s0, int s1, const PinMap& pins) {
    SimOut det2 = simulate(m, jobs, k2, durMean, cal, calByM, pins);
    int nl2; double tardDet2 = order_tardiness(jobs, det2, nOrders, due, nl2);
    std::vector<double> mks, tards; runScen(k2, pins, s0, s1, mks, tards);
    double mkMean = mean_of(mks), mkCv = cvar_upper(mks, p.alpha);
    return p.wTime * mkMean + p.wRisk * (mkCv - mkMean)
         + p.wCost * det2.setupMinutes + 0.5 * mean_of(tards) + 0.001 * tardDet2;
  };
  const std::string gaMode = p.gaMode == "auto" || p.gaMode.empty() ? (wantCpSat ? "both" : "structured") : p.gaMode;
  const std::string seedSource = cp.sol.ok ? "cpsat" : "rules";
  if (G > 0) {
    // Режим прогона ГА: лучшая хромосома, её ключ, пины декодирования, оценка вне выборки.
    struct ModeRun { std::string name; GaResult ga; std::vector<double> key; const PinMap* pins; double val = 0; int nSeeds = 0; GaConfig gc; };
    std::vector<ModeRun> runs;
    // ── Режим 1: структурная хромосома (5 весов + сдвиги заказов) ──
    const std::array<const char*, 5> kCrit = { "due", "rem", "duration", "inputs", "setup" };
    const int C = (int)kCrit.size();
    if (gaMode == "structured" || gaMode == "both") {
      std::vector<std::vector<double>> norm(C);
      for (int c = 0; c < C; ++c) norm[c] = priorities("CUSTOM", jobs, orderWork, { { kCrit[c], 1.0 } });
      auto decode = [&](const std::vector<double>& g) {
        std::vector<double> k2(jobs.size());
        for (size_t i = 0; i < jobs.size(); ++i) {
          double v = g[C + jobs[i].orderIdx];
          for (int c = 0; c < C; ++c) v += g[c] * norm[c][i];
          k2[i] = v;
        }
        return k2;
      };
      // Затравки — правила в этом пространстве (CR и MS — линейные приближения).
      auto genome = [&](std::initializer_list<double> w) {
        std::vector<double> g(C + nOrders, 0.0);
        std::copy(w.begin(), w.end(), g.begin());
        return g;
      };
      auto ruleGenome = [&](const std::string& r) {
        if (r == "CUSTOM") {
          std::vector<double> g(C + nOrders, 0.0);
          for (auto& [cn, w] : p.customRule)
            for (int c = 0; c < C; ++c) if (cn == kCrit[c]) g[c] += w;
          return g;
        }
        if (r == "SPT")  return genome({ 0, 0, 1 });
        if (r == "LPT")  return genome({ 0, 0, -1 });
        if (r == "MWKR") return genome({ 0, -1 });
        if (r == "MS")   return genome({ 1, -1 });
        if (r == "CR")   return genome({ 1, -0.5 });
        if (r == "FIFO") {
          std::vector<double> g(C + nOrders, 0.0);
          for (int k = 0; k < nOrders; ++k) g[C + k] = (k + 1.0) / nOrders;
          return g;
        }
        return genome({ 1 });                            // EDD
      };
      std::vector<std::vector<double>> seeds = { ruleGenome(chosenRule) };
      // RL/CP-SAT-ключ не лежит в пространстве хромосомы — ГА поверх правил.
      if (chosenRule == "RL" || chosenRule == "CP-SAT") seeds.clear();
      for (size_t ri = 0; ri < rules.size(); ++ri)
        if (ri != bestR && rules[ri] != "CP-SAT") seeds.push_back(ruleGenome(rules[ri]));
      ModeRun r; r.name = "structured"; r.pins = &pinMap; r.nSeeds = (int)seeds.size();
      r.gc.generations = G;
      r.gc.seed = p.seed + 777;
      r.gc.sigma0 = 0.1;                                 // ≈ 10 % шкалы нормированного критерия
      r.gc.mutationRate = 0.15;
      r.gc.swapBegin = C;                                // обмен — только приоритетами заказов
      r.gc.stallGens = 8;
      r.ga = run_key_ga(seeds, [&](const std::vector<double>& g) { return scoreOn(decode(g), 0, NS, pinMap); }, r.gc);
      r.key = decode(r.ga.bestKey);
      runs.push_back(std::move(r));
    }
    // ── Режим 2: ключи по операциям (тёплый старт CP-SAT или правила) ──
    if (gaMode == "op_keys" || gaMode == "both") {
      std::vector<std::vector<double>> seeds;
      if (cp.sol.ok) seeds.push_back(cpsat::opkey_from_starts(cp.sol.starts));
      if (chosenRule != "CP-SAT") seeds.push_back(cpsat::opkey_from_key(key));
      for (size_t ri = 0; ri < rules.size(); ++ri)
        if (ri != bestR && rules[ri] != "CP-SAT") seeds.push_back(cpsat::opkey_from_key(keyOf(rules[ri])));
      ModeRun r; r.name = "op_keys"; r.pins = cp.sol.ok ? &cp.machinePins : &pinMap; r.nSeeds = (int)seeds.size();
      r.gc.generations = G;
      r.gc.seed = p.seed + 991;
      r.gc.sigma0 = 0.05;                                // 5 % шкалы [0,1]
      r.gc.mutationRate = std::min(0.1, 20.0 / std::max<size_t>(1, jobs.size()));   // ≈ 20 генов на мутацию
      r.gc.swapBegin = 0;
      r.gc.stallGens = 8;
      const PinMap& opPins = *r.pins;
      r.ga = run_key_ga(seeds, [&](const std::vector<double>& g) { return scoreOn(g, 0, NS, opPins); }, r.gc);
      r.key = r.ga.bestKey;
      runs.push_back(std::move(r));
    }
    // Базовая линия — НАСТОЯЩИЙ ключ выбранного правила с его пинами (CP-SAT — жёсткий план).
    const double trainRule = scoreOn(key, 0, NS, *finalPins);
    const double valRule = NV > 0 ? scoreOn(key, NS, NS + NV, *finalPins) : trainRule;
    int won = -1;
    for (size_t i = 0; i < runs.size(); ++i) {
      runs[i].val = NV > 0 ? scoreOn(runs[i].key, NS, NS + NV, *runs[i].pins) : runs[i].ga.bestScore;
      const bool ok = runs[i].ga.bestScore < trainRule && runs[i].val < valRule;
      if (ok && (won < 0 || runs[i].val < runs[won].val)) won = (int)i;
    }
    const bool adopted = won >= 0;
    if (adopted) { key = runs[won].key; finalPins = runs[won].pins; keyImproved = true; }
    auto gainPct = [](double before, double after) { return before > 0 ? (before - after) / before * 100.0 : 0.0; };
    json modes = json::object();
    for (auto& r : runs)
      modes[r.name] = { {"score_train", r.ga.bestScore}, {"score_validation", r.val}, {"seeds", r.nSeeds},
                        {"generations", (int)r.ga.history.size() - 1}, {"evaluations", r.ga.evaluations},
                        {"genes", (int)r.ga.bestKey.size()}, {"adoptable", r.ga.bestScore < trainRule && r.val < valRule},
                        {"stopped", r.ga.stoppedByTime ? "time" : r.ga.stoppedByStall ? "stall" : "generations"} };
    // Поля верхнего уровня — у победившего режима (иначе у первого прогнанного) — совместимо с UI.
    const ModeRun& rep = runs[adopted ? won : 0];
    json hist = json::array();
    for (const GaGeneration& h : rep.ga.history) hist.push_back({ {"gen", h.gen}, {"best", h.best}, {"mean", h.mean} });
    const bool structured = rep.name == "structured";
    improverJson = {
      {"method", "ga"},
      {"iterations", (int)rep.ga.history.size() - 1},
      {"population", rep.gc.popSize}, {"evaluations", rep.ga.evaluations}, {"seeds", rep.nSeeds},
      {"accepted", adopted ? rep.ga.improvements : 0},
      {"adopted", adopted},
      {"stopped", rep.ga.stoppedByTime ? "time" : rep.ga.stoppedByStall ? "stall" : "generations"},
      {"score_before", trainRule},
      {"score_after", adopted ? rep.ga.bestScore : trainRule},
      {"improvement_pct", adopted ? gainPct(trainRule, rep.ga.bestScore) : 0.0},
      {"genes", (int)rep.ga.bestKey.size()},
      {"train_scenarios", NS},
      {"validation", { {"scenarios", NV}, {"score_rule", valRule}, {"score_ga", rep.val},
                       {"improvement_pct", gainPct(valRule, rep.val)} }},
      {"history", hist},
      {"mode", gaMode}, {"mode_won", adopted ? json(rep.name) : json(nullptr)},
      {"seed_source", seedSource}, {"modes", modes},
    };
    if (structured)                                      // веса составного правила — только у структурной хромосомы
      improverJson["weights"] = { {"due", rep.ga.bestKey[0]}, {"rem", rep.ga.bestKey[1]}, {"duration", rep.ga.bestKey[2]},
                                  {"inputs", rep.ga.bestKey[3]}, {"setup", rep.ga.bestKey[4]} };
  }

  // Волна A2: сводка CP-SAT и «цена детерминизма» — жёсткий план CP-SAT (пины) против итогового
  // (робастно донастроенного) на ОДНИХ И ТЕХ ЖЕ отложенных сценариях (CRN), парный бутстреп.
  json cpsatJson = nullptr;
  if (cp.sol.ok) {
    const bool heldOut = G > 0 && NV > 0;
    const int s0 = heldOut ? NS : 0, s1 = heldOut ? NS + NV : N;
    std::vector<double> mkA, tdA, mkB, tdB;
    runScen(cp.key, cp.pins, s0, s1, mkA, tdA);
    runScen(key, *finalPins, s0, s1, mkB, tdB);
    auto toH = [](std::vector<double> v) { for (double& x : v) x /= 60.0; return v; };
    const double finalDetMk = simulate(m, jobs, key, durMean, cal, calByM, *finalPins).makespan;
    const RuleEval& br = evals[bestRuleR];
    cpsatJson = {
      {"status", cp.sol.status}, {"objective", cp.sol.objective}, {"bound", cp.sol.bound}, {"time_s", cp.sol.timeS},
      {"setup_mode", cp.sol.setupMode}, {"hint_rule", cp.hintRule}, {"calendar_mode", cp.sol.calendarMode},
      {"routing", cp.sol.routing}, {"from_hint", cp.sol.fromHint}, {"note", cp.sol.fromHint ? cp.sol.error : std::string()},
      {"makespan_solver_h", cp.sol.makespan / 60.0}, {"makespan_replay_h", cp.replayMk / 60.0},
      {"best_rule", br.rule}, {"best_rule_makespan_h", br.mkDet / 60.0},
      // Разрыв к лучшему правилу по детерминированному Cmax (воспроизведение пинами); < 0 — CP-SAT лучше.
      {"gap_to_rule", br.mkDet > 0 ? (cp.replayMk - br.mkDet) / br.mkDet : 0.0},
      {"gap_to_rule_score", evals[bestRuleR].score > 0 ? (evals[0].score - evals[bestRuleR].score) / evals[bestRuleR].score : 0.0},
      {"price_of_determinism", {
        {"scenarios", s1 - s0}, {"held_out", heldOut}, {"final_plan", keyImproved ? "ga" : "cpsat"},
        {"cpsat_det_makespan_h", cp.replayMk / 60.0}, {"final_det_makespan_h", finalDetMk / 60.0},
        {"cpsat", { {"makespan_mean_h", mean_of(mkA) / 60.0}, {"makespan_cvar_h", cvar_upper(mkA, p.alpha) / 60.0},
                    {"tardiness_mean_h", mean_of(tdA) / 60.0} }},
        {"final", { {"makespan_mean_h", mean_of(mkB) / 60.0}, {"makespan_cvar_h", cvar_upper(mkB, p.alpha) / 60.0},
                    {"tardiness_mean_h", mean_of(tdB) / 60.0} }},
        // Δ = итоговый − жёсткий CP-SAT (часы); отрицательное — робастная донастройка лучше.
        {"makespan_delta", paired_delta_ci(toH(mkA), toH(mkB), p.alpha, p.seed + 5150u)},
        {"tardiness_delta", paired_delta_ci(toH(tdA), toH(tdB), p.alpha, p.seed + 5151u)},
      }},
    };
  }

  // B5: риск-KPI (E/CVaR/худший makespan, CVaR просрочки, поломки) — Монте-Карло
  // ИТОГОВОГО ключа (того же, что даёт Ганта), на всех N сценариях. Раньше они
  // брались у правила ДО локального поиска и не относились к показанному плану.
  // Если ключ не менялся — оценка правила и есть оценка итогового ключа (те же CRN).
  const McEval finalMc = keyImproved ? mcEval(key, *finalPins) : McEval{
    evals[bestR].mkMean, evals[bestR].mkCVaR, evals[bestR].mkWorst,
    evals[bestR].tardMean, evals[bestR].tardCVaR, evals[bestR].bdMin };

  SimOut sched = simulate(m, jobs, key, durMean, cal, calByM, *finalPins);
  double makespan = sched.makespan;
  int nLate = 0; double tardiness = order_tardiness(jobs, sched, nOrders, due, nLate);

  auto H = [](double minutes) { return minutes / 60.0; };  // мин → часы
  if (!improverJson.is_null()) {                       // эффект локального поиска на E[Cmax]
    improverJson["makespan_mean_rule"]  = H(evals[bestR].mkMean);
    improverJson["makespan_mean_final"] = H(finalMc.mkMean);
  }

  // Гантт.
  json gantt = json::array();
  for (size_t i = 0; i < jobs.size(); ++i) {
    const Job& j = jobs[i];
    bool late = sched.end[i] > j.dueMin + 1e-6;
    bool isSupply = j.productId == "supply";
    std::string mid = isSupply ? "supply" : sched.machineId[i];
    std::string mname = isSupply ? "Снабжение/поставка"
      : (m.machineName.count(sched.machineId[i]) ? m.machineName[sched.machineId[i]] : "");
    // FJSP: тип в Ганте — ФАКТИЧЕСКИЙ тип выбранного станка (может отличаться от ведущего).
    std::string wct = (!isSupply && !mid.empty() && m.machineWct.count(mid)) ? m.machineWct[mid] : j.wcType;
    gantt.push_back({
      {"job_idx", (int)i},                       // для ручных правок (drag&drop → пин)
      {"batches", j.batches},                    // партий в джобе (нормировка калибровки)
      {"order_idx", j.orderIdx}, {"product_id", j.productId},
      {"product_name", isSupply ? "—" : (m.prodName.count(j.productId)?m.prodName[j.productId]:j.productId)},
      {"op_id", j.opId}, {"op_name", j.opName},
      {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"machine_id", mid}, {"machine_name", mname},
      {"worker", sched.worker[i]},
      {"worker_id", (sched.worker[i] >= 0 && sched.worker[i] < (int)m.workers.size())
                      ? m.workers[sched.worker[i]].id : std::string()},
      {"worker_name", (sched.worker[i] >= 0 && sched.worker[i] < (int)m.workers.size())
                      ? m.workers[sched.worker[i]].name : std::string()},
      {"start", H(sched.start[i])}, {"end", H(sched.end[i])},
      {"due", H(j.dueMin)}, {"late", late},
      // B9: разложение занятости джобы — обработка (продуктивное время), наладка, простой (ТО/ремонт).
      {"proc_hours", isSupply ? 0.0 : H(durMean[i])},
      {"setup_hours", H(sched.setupJ[i])}, {"downtime_hours", H(sched.downJ[i])},
    });
  }

  // ── ОЧЕРЕДИ: сколько операций «ждут» (готовы по предшественникам, но станок занят) в
  //    каждый момент времени и на каком оборудовании — видно, где копятся узкие места.
  json queueTimeline = json::array();
  json queueByWc = json::array();
  {
    const int BK = 48;
    const double bw = std::max(1e-9, makespan / std::max(1, BK));
    std::vector<std::unordered_map<std::string, int>> qByWc(BK + 1);
    std::vector<int> qTot(BK + 1, 0);
    for (size_t i = 0; i < jobs.size(); ++i) {
      if (jobs[i].productId == "supply") continue;
      double a = 0; for (int p : jobs[i].preds) a = std::max(a, sched.end[p]);  // готовность
      double b = sched.start[i];                                                // старт (конец ожидания)
      if (b <= a + 1e-6) continue;
      int b0 = std::max(0, (int)std::floor(a / bw));
      int b1 = std::min(BK, (int)std::floor((b - 1e-6) / bw));
      for (int k = b0; k <= b1; ++k) { qTot[k]++; qByWc[k][jobs[i].wcType]++; }
    }
    for (int k = 0; k <= BK; ++k) {
      std::string topWc; int topN = 0;
      for (auto& [wc, n] : qByWc[k]) if (n > topN) { topN = n; topWc = wc; }
      queueTimeline.push_back({ {"t", H(k * bw)}, {"queued", qTot[k]},
        {"top_wc", m.wcName.count(topWc) ? m.wcName[topWc] : topWc}, {"top_wc_n", topN} });
    }
    // Разбивка очереди по типам РЦ: своя серия на каждый рабочий центр — чтобы в UI
    // можно было выбрать конкретный участок и видеть его очередь во времени.
    std::unordered_map<std::string, std::vector<int>> series;   // wc → queued по бинам
    for (int k = 0; k <= BK; ++k)
      for (auto& [wc, n] : qByWc[k]) {
        auto& v = series[wc];
        if (v.empty()) v.assign(BK + 1, 0);
        v[k] = n;
      }
    for (auto& [wc, v] : series) {
      int peak = 0; for (int n : v) peak = std::max(peak, n);
      if (peak == 0) continue;
      json pts = json::array();
      for (int k = 0; k <= BK; ++k) pts.push_back({ {"t", H(k * bw)}, {"queued", v[k]} });
      queueByWc.push_back({ {"wc_type_id", wc}, {"wc_name", m.wcName.count(wc) ? m.wcName[wc] : wc},
                            {"peak", peak}, {"points", pts} });
    }
  }

  // ── Загрузка (B9, AUDIT §4.2, ISO 22400 APT/фонд): ЕДИНОЕ определение
  //    utilization = Σ продуктивного времени ресурса / Σ его КАЛЕНДАРНОГО фонда за
  //    горизонт [0, makespan]. Продуктивное время станка = обработка; наладка и
  //    простой (плановое ТО + ремонт) НЕ входят в занятость и даются отдельно, так что
  //    фонд = обработка + наладка + простой + свободное время. Фонд станка — по ЕГО
  //    календарю (индивидуальный график, иначе общий; без календаря — 24×7).
  double fond = working_span(cal, makespan);           // фонд общего календаря (рабочие)
  std::unordered_map<std::string,double> procM, setupM, downM;   // станок → мин
  std::vector<double> prodW(m.workers.size(), 0);                 // рабочий → мин
  for (size_t i = 0; i < jobs.size(); ++i) {
    const std::string& mid = sched.machineId[i];
    if (!mid.empty()) { procM[mid] += durMean[i]; setupM[mid] += sched.setupJ[i]; downM[mid] += sched.downJ[i]; }
    // Рабочий выполняет обработку и наладку; ТО/ремонт — простой станка, не работа рабочего.
    const int w = sched.worker[i];
    if (w >= 0 && w < (int)prodW.size()) prodW[w] += durMean[i] + sched.setupJ[i];
  }
  auto getm = [](const std::unordered_map<std::string,double>& mp, const std::string& k) {
    auto it = mp.find(k); return it != mp.end() ? it->second : 0.0; };
  json machineLoad = json::array();
  double totalBusy = 0, totalCap = 0, totalSetup = 0, totalDown = 0, totalIdle = 0;
  std::unordered_map<std::string,double> wcBusy, wcCap, wcSetup, wcDown, wcIdle;
  for (auto& [wct, mids] : m.machinesOf) for (auto& mid : mids) {
    const double busy = getm(procM, mid), su = getm(setupM, mid), dn = getm(downM, mid);
    const Calendar& mcal = calByM.count(mid) ? calByM.at(mid) : cal;
    const double fund = working_span(mcal, makespan);
    const double idle = std::max(0.0, fund - busy - su - dn);
    machineLoad.push_back({ {"machine_id", mid}, {"machine_name", m.machineName[mid]},
      {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"busy_hours", H(busy)}, {"idle_hours", H(idle)}, {"utilization", fund > 0 ? busy / fund : 0},
      {"setup_hours", H(su)}, {"downtime_hours", H(dn)}, {"fund_hours", H(fund)} });
    totalBusy += busy; totalCap += fund; totalSetup += su; totalDown += dn; totalIdle += idle;
    wcBusy[wct] += busy; wcCap[wct] += fund; wcSetup[wct] += su; wcDown[wct] += dn; wcIdle[wct] += idle;
  }
  json wcLoad = json::array(); std::string bottleneck; double bnUtil = -1;
  for (auto& [wct, cap] : wcCap) {
    double util = cap > 0 ? wcBusy[wct] / cap : 0;
    wcLoad.push_back({ {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"busy_hours", H(wcBusy[wct])}, {"idle_hours", H(wcIdle[wct])}, {"utilization", util},
      {"setup_hours", H(wcSetup[wct])}, {"downtime_hours", H(wcDown[wct])}, {"fund_hours", H(cap)} });
    if (util > bnUtil) { bnUtil = util; bottleneck = wct; }
  }

  // Планы рабочих + простои людей. Фонд рабочего — общий сменный календарь (своих
  // графиков у рабочих в модели нет); при работе на станке 24×7 вне смен загрузка
  // может превысить 1 — это сверхурочные относительно графика, а не ошибка формулы.
  json workerPlan = json::array();
  for (size_t w = 0; w < m.workers.size(); ++w) {
    json js = json::array(); int cnt = 0;
    for (size_t i = 0; i < jobs.size(); ++i) if (sched.worker[i] == (int)w) {
      js.push_back({ {"op_name", jobs[i].opName}, {"product_id", jobs[i].productId},
        {"start", H(sched.start[i])}, {"end", H(sched.end[i])} }); ++cnt;
    }
    const double busy = prodW[w];
    workerPlan.push_back({ {"worker_id", m.workers[w].id}, {"name", m.workers[w].name},
      {"jobs", js}, {"job_count", cnt}, {"busy_hours", H(busy)},
      {"idle_hours", H(std::max(0.0, fond - busy))}, {"utilization", fond > 0 ? busy / fond : 0},
      {"fund_hours", H(fond)} });
  }

  // ── Дополнительные KPI (стандарт APS: flow time, ожидание, НЗП, проходка) ──
  double flowSum = 0, wipArea = 0, waitSum = 0, procSum = 0, qtySum = 0;
  {
    std::vector<double> ordStart(nOrders, 1e300), ordFin(nOrders, 0);
    for (size_t i = 0; i < jobs.size(); ++i) {
      ordStart[jobs[i].orderIdx] = std::min(ordStart[jobs[i].orderIdx], sched.start[i]);
      ordFin[jobs[i].orderIdx]   = std::max(ordFin[jobs[i].orderIdx],   sched.end[i]);
      double readyT = 0; for (int pr2 : jobs[i].preds) readyT = std::max(readyT, sched.end[pr2]);
      waitSum += std::max(0.0, sched.start[i] - readyT);   // ожидание станка/рабочего
      procSum += std::max(0.0, sched.end[i] - sched.start[i]);
    }
    for (int k2 = 0; k2 < nOrders; ++k2) {
      if (ordFin[k2] <= 0) continue;
      flowSum += ordFin[k2] - std::min(ordStart[k2], ordFin[k2]);
      wipArea += ordFin[k2] - std::min(ordStart[k2], ordFin[k2]);
      qtySum  += std::max(1.0, program[k2].qty);
    }
  }
  // B10, единицы (AUDIT §4.2): throughput — ЕДИНИЦ ПРОДУКЦИИ в сутки; wip_avg —
  // среднее число ЗАКАЗОВ в системе = Σ времени потока / Cmax; orders_per_day —
  // интенсивность λ (заказов в сутки). Закон Литтла: wip_avg = λ · W, W = flow_time_mean.
  const double flowMeanH = nOrders > 0 ? flowSum / nOrders / 60.0 : 0;
  const double waitShare = (waitSum + procSum) > 0 ? waitSum / (waitSum + procSum) : 0;
  const double wipAvg    = makespan > 0 ? wipArea / makespan : 0;
  const double thruDay   = makespan > 0 ? qtySum / (makespan / 60.0 / 24.0) : 0;
  const double ordersDay = makespan > 0 ? nOrders / (makespan / 60.0 / 24.0) : 0;

  json rulesJson = json::array();
  for (auto& e : evals) rulesJson.push_back({
    {"rule", e.rule}, {"makespan", H(e.mkMean)}, {"makespan_cvar", H(e.mkCVaR)},
    {"makespan_worst", H(e.mkWorst)}, {"tardiness", H(e.tardMean)}, {"score", e.score},
    {"chosen", e.rule == chosenRule} });

  double cost = 0; for (size_t i = 0; i < jobs.size(); ++i)
    cost += (durMean[i] / 60.0) * (jobs[i].hourRate + jobs[i].laborRate);
  cost += sched.setupCost;                              // переналадки — тоже деньги
  // Стоимость труда по фактическим назначениям (тарифная ставка рабочего × занятость).
  double laborCost = 0;
  for (size_t w = 0; w < m.workers.size() && w < sched.busyByWorker.size(); ++w)
    laborCost += (sched.busyByWorker[w] / 60.0) * m.workers[w].costPerHour;

  // ── Recourse: обратная связь Стадия 1 → Стадия 2. Фактические часы на единицу
  // (нормо-часы + доля переналадок) пишутся в stage1_feedback — ТОЛЬКО при явном
  // p.applyFeedback (R5): оптимизатор читает их тоже только по явному apply_feedback.
  if (p.applyFeedback) try {
    std::unordered_map<std::string, std::pair<double,double>> agg;   // product → (мин, шт)
    for (int k = 0; k < nOrders; ++k) agg[program[k].productId].second += std::max(1.0, program[k].qty);
    for (const Job& j : jobs)
      if (j.productId != "supply") agg[program[j.orderIdx].productId].first += j.durMean;
    const double setupShare = totalWork > 0 ? sched.setupMinutes / totalWork : 0;
    for (auto& [pid, pq] : agg) {
      if (pq.first <= 0 || pq.second <= 0) continue;
      const double naiveH  = pq.first / 60.0 / pq.second;
      const double actualH = naiveH * (1.0 + setupShare);
      db.exec("INSERT INTO stage1_feedback(product_id,hours_per_unit,naive_hours,factor,updated_at) "
              "VALUES(?,?,?,?,datetime('now')) "
              "ON CONFLICT(product_id) DO UPDATE SET hours_per_unit=excluded.hours_per_unit, "
              "naive_hours=excluded.naive_hours, factor=excluded.factor, updated_at=excluded.updated_at",
              { pid, std::to_string(actualH), std::to_string(naiveH),
                std::to_string(std::max(1.0, actualH / std::max(1e-9, naiveH))) });
    }
  } catch (...) {}                                       // фидбэк не должен ронять план

  // Осуществимость связки стадий: вписывается ли программа портфеля в горизонт,
  // под который Стадия 2 резервировала мощность.
  if (portfolioHorizon > 0) {
    if (H(finalMc.mkCVaR) > portfolioHorizon)
      warnings.push_back("Портфель НЕ вписывается в горизонт прогона с учётом риска: CVaR makespan "
                         + std::to_string((int)std::lround(H(finalMc.mkCVaR))) + " ч > "
                         + std::to_string((int)std::lround(portfolioHorizon)) + " ч.");
    else if (H(makespan) > portfolioHorizon)
      warnings.push_back("Детерминированный план превышает горизонт прогона ("
                         + std::to_string((int)std::lround(H(makespan))) + " ч > "
                         + std::to_string((int)std::lround(portfolioHorizon)) + " ч).");
  }

  json programJson = json::array();
  for (int k = 0; k < nOrders; ++k) programJson.push_back({
    {"product_id", program[k].productId},
    {"product_name", m.prodName.count(program[k].productId)?m.prodName[program[k].productId]:program[k].productId},
    {"qty", program[k].qty}, {"due_hours", H(due[k])} });

  json result = {
    {"rule", chosenRule}, {"samples", N}, {"alpha", p.alpha},
    {"weights", { {"time", p.wTime}, {"cost", p.wCost}, {"risk", p.wRisk} }},
    {"n_orders", nOrders}, {"n_jobs", (int)jobs.size()}, {"n_machines", (int)m.machineName.size()},
    {"n_workers", (int)m.workers.size()},
    {"program", programJson}, {"gantt", gantt}, {"queue_timeline", queueTimeline}, {"queue_by_wc", queueByWc},
    {"machine_load", machineLoad}, {"wc_load", wcLoad}, {"worker_plan", workerPlan},
    {"bottleneck", { {"wc_type_id", bottleneck}, {"wc_name", m.wcName.count(bottleneck)?m.wcName[bottleneck]:bottleneck},
                     {"utilization", bnUtil} }},
    {"idle", { {"machine_idle_hours", H(totalIdle)},
               {"machine_utilization", totalCap>0?totalBusy/totalCap:0} }},
    {"calendar", { {"enabled", cal.any}, {"work_fond_hours", H(fond)},
                   {"machine_fund_hours", H(totalCap)} }},
    {"kpi", {
      {"makespan", H(makespan)}, {"makespan_mean", H(finalMc.mkMean)}, {"makespan_cvar", H(finalMc.mkCVaR)},
      {"makespan_worst", H(finalMc.mkWorst)}, {"tardiness", H(tardiness)}, {"tardiness_cvar", H(finalMc.tardCVaR)},
      {"n_late", nLate}, {"otd", nOrders>0 ? (double)(nOrders - nLate) / nOrders : 1.0},
      {"utilization", totalCap>0?totalBusy/totalCap:0}, {"cost", cost},
      {"labor_cost", laborCost},
      {"n_setups", sched.nSetups}, {"setup_hours", H(sched.setupMinutes)},
      {"maintenance_hours", H(sched.maintMinutes)},
      {"breakdown_hours_mean", H(finalMc.bdMin)},
      {"flow_time_mean_h", flowMeanH}, {"wait_share", waitShare},
      {"wip_avg", wipAvg}, {"throughput_per_day", thruDay},
      // Новые поля (AUDIT §4.2): знаменатель — Σ календарного фонда станков.
      {"machine_fund_hours", H(totalCap)},
      {"setup_share", totalCap > 0 ? totalSetup / totalCap : 0.0},
      // Коэффициент готовности (оценка): 1 − (плановое ТО детерм. плана + E[ремонт] МК) / Σ фонда.
      {"availability", totalCap > 0
          ? std::max(0.0, 1.0 - (sched.maintMinutes + finalMc.bdMin) / totalCap) : 1.0},
      {"orders_per_day", ordersDay} }},
    {"portfolio_horizon_hours", portfolioHorizon},
    {"n_pins", (int)pinMap.size()},
    {"improver", improverJson},
    {"rules", rulesJson}, {"warnings", warnings},
    // Волна A: структурные ходы агента (UX-V2 §4.7) и сводка политики RL; null без правила RL.
    {"moves", p.rule == "RL" ? rlPlan.moves : json(nullptr)},
    {"rl", p.rule == "RL" ? rlPlan.rlEval : json(nullptr)},
    // Волна A2: правило «CP-SAT» — статус солвера, разрыв к лучшему правилу, «цена детерминизма».
    {"cpsat", cpsatJson},
  };
  return result;
}

}  // namespace maos
