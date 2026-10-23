#include "SimEnv.h"
#include "GaImprover.h"
#include "Passport.h"
#include <mutex>
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <stdexcept>
#include <tuple>

namespace maos::env {
namespace {

using sched::num;
using sched::str;

constexpr int kEvJobDone = 0, kEvWeek = 1, kEvMachine = 2;
constexpr int kMaxShiftWeeks = 4;        // предел сдвига запуска [К] rl.max_shift_weeks
constexpr int kMaxBatches = 16;          // потолок transfer-партий (r1.10)
constexpr double kCashRiskShare = 0.0;   // флаг «касса в зоне риска»: C_t < kCashRiskShare·масштаб

// Детерминированный 64-битный хэш (splitmix) — потоки CRN по идентичности джобы.
uint64_t mix(uint64_t x) {
  x += 0x9E3779B97F4A7C15ull;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ull;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBull;
  return x ^ (x >> 31);
}
uint64_t hash_str(const std::string& s) {
  uint64_t h = 1469598103934665603ull;
  for (unsigned char c : s) { h ^= c; h *= 1099511628211ull; }
  return h;
}

json calendar_json(const Calendar& c) {
  json days = json::array();
  for (int d = 0; d < 7; ++d) {
    json dd = json::array();
    for (auto& [s, e] : c.day[d]) dd.push_back({ s, e });
    days.push_back(dd);
  }
  return { {"any", c.any}, {"days", days} };
}
Calendar calendar_from(const json& j) {
  Calendar c;
  if (!j.is_object() || !j.contains("days")) return c;
  int d = 0;
  for (auto& dd : j["days"]) {
    if (d >= 7) break;
    for (auto& se : dd) if (se.is_array() && se.size() == 2) {
      c.day[d].push_back({ se[0].get<int>(), se[1].get<int>() }); c.any = true;
    }
    ++d;
  }
  return c;
}

json op_json(const Op& o) {
  json ins = json::array(); for (auto& [p, q] : o.inputs) ins.push_back({ p, q });
  json tbt = json::object(); for (auto& [t, m] : o.tByType) tbt[t] = m;
  return { {"id", o.id}, {"name", o.name}, {"wc_types", o.wcTypes}, {"t_exp", o.tExp}, {"sigma", o.sigma},
           {"setup", o.setupTime}, {"risk", o.riskCoef}, {"tail_w", o.tailWeight}, {"tail_idx", o.tailIndex},
           {"hour_rate", o.hourRate}, {"labor_rate", o.laborRate}, {"order_no", o.orderNo},
           {"inputs", ins}, {"t_by_type", tbt} };
}
Op op_from(const json& j) {
  Op o; o.id = str(j, "id"); o.name = str(j, "name");
  if (j.contains("wc_types")) for (auto& t : j["wc_types"]) o.wcTypes.push_back(t.get<std::string>());
  o.wcType = o.wcTypes.empty() ? std::string() : o.wcTypes.front();
  o.tExp = num(j, "t_exp", 30); o.sigma = num(j, "sigma", o.tExp * 0.15); o.setupTime = num(j, "setup", 0);
  o.riskCoef = num(j, "risk", 0.05); o.tailWeight = num(j, "tail_w", 0.08); o.tailIndex = std::max(1.2, num(j, "tail_idx", 2.5));
  o.hourRate = num(j, "hour_rate", 0); o.laborRate = num(j, "labor_rate", 0); o.orderNo = (int)num(j, "order_no", 10);
  if (j.contains("inputs")) for (auto& in : j["inputs"]) o.inputs.push_back({ in[0].get<std::string>(), in[1].get<double>() });
  if (j.contains("t_by_type") && j["t_by_type"].is_object())
    for (auto& [t, m] : j["t_by_type"].items()) o.tByType.push_back({ t, m.get<double>() });
  return o;
}

// Материальная себестоимость единицы по BOM: покупное → base_cost, иначе Σ входов.
double mat_cost_of(const std::string& pid, const Model& m, const std::unordered_map<std::string,double>& baseCost,
                   std::unordered_set<std::string>& vis, int depth) {
  if (depth > 64 || vis.count(pid)) return 0;
  if (m.prods.count(pid) && m.prods.at(pid).purchased) { auto it = baseCost.find(pid); return it != baseCost.end() ? it->second : 0; }
  auto it = m.opsOf.find(pid); if (it == m.opsOf.end()) return 0;
  vis.insert(pid); double c = 0;
  for (auto& o : it->second) for (auto& [q, qty] : o.inputs) c += qty * mat_cost_of(q, m, baseCost, vis, depth + 1);
  vis.erase(pid); return c;
}

}  // namespace

const char* const SimEnv::kMoveKindNames[SimEnv::kMoveKinds] = {
  "shift_plus", "shift_minus", "split", "merge", "outsource", "reroute", "reassign" };

/* ── Экземпляр ───────────────────────────────────────────────────────────── */
namespace {
// A3: договоры, сверхурочные, субподряд операций, кандидаты L3.
json a3_json(const Instance& inst) {
  json c = json::array();
  for (auto& ic : inst.investCands)
    c.push_back({ {"id", ic.id}, {"kind", ic.kind}, {"wct", ic.wct}, {"capex", ic.capex}, {"lead_weeks", ic.leadWeeks},
                  {"opex_weekly", ic.opexWeekly}, {"life_weeks", ic.lifeWeeks}, {"mtbf_mul", ic.mtbfMul}, {"repair_mul", ic.repairMul},
                  {"prepay_share", ic.prepayShare}, {"source", ic.source} });
  return { {"late_fixed", inst.lateFixed}, {"late_per_week", inst.latePerWeek}, {"late_cap", inst.lateCap},
           {"overtime_hours_week", inst.overtimeHoursWeek}, {"overtime_cost_mul", inst.overtimeCostMul},
           {"outsource_op_markup", inst.outsourceOpMarkup}, {"outsource_op_share", inst.outsourceOpShare},
           {"invest_cands", c} };
}
void a3_from(const json& a, Instance& inst) {
  if (!a.is_object()) return;
  inst.lateFixed = num(a, "late_fixed", 0); inst.latePerWeek = num(a, "late_per_week", -1); inst.lateCap = num(a, "late_cap", -1);
  inst.overtimeHoursWeek = num(a, "overtime_hours_week", 16); inst.overtimeCostMul = num(a, "overtime_cost_mul", 0.6);
  inst.outsourceOpMarkup = num(a, "outsource_op_markup", 1.6); inst.outsourceOpShare = num(a, "outsource_op_share", 0.25);
  if (a.contains("invest_cands") && a["invest_cands"].is_array())
    for (auto& c : a["invest_cands"]) {
      InvestCand ic; ic.id = str(c, "id"); ic.kind = c.value("kind", std::string("machine")); ic.wct = str(c, "wct");
      ic.capex = num(c, "capex"); ic.leadWeeks = num(c, "lead_weeks", 6); ic.opexWeekly = num(c, "opex_weekly");
      ic.lifeWeeks = std::max(1.0, num(c, "life_weeks", 520)); ic.mtbfMul = num(c, "mtbf_mul", 1); ic.repairMul = num(c, "repair_mul", 1);
      ic.prepayShare = std::min(1.0, std::max(0.0, num(c, "prepay_share", 0.3))); ic.source = str(c, "source");
      inst.investCands.push_back(ic);
    }
}
}  // namespace

json instance_to_json(const Instance& inst) {
  const Model& m = inst.model;
  json machines = json::array();
  for (auto& [wct, mids] : m.machinesOf) for (auto& mid : mids)
    machines.push_back({ {"id", mid}, {"name", m.machineName.count(mid) ? m.machineName.at(mid) : mid}, {"wct", wct},
                         {"schedule", m.machineSched.count(mid) ? m.machineSched.at(mid) : ""} });
  json wcts = json::array();
  std::set<std::string> allWct;
  for (auto& [w, _] : m.machinesOf) allWct.insert(w);
  for (auto& [w, _] : m.wcName) allWct.insert(w);
  for (auto& w : allWct) {
    Model::WctRisk rk = m.wctRisk.count(w) ? m.wctRisk.at(w) : Model::WctRisk{};
    wcts.push_back({ {"id", w}, {"name", m.wcName.count(w) ? m.wcName.at(w) : w}, {"mtbf", rk.mtbf},
                     {"repair_h", rk.repairH}, {"mtbm", rk.mtbm}, {"maint_h", rk.maintH} });
  }
  json products = json::array();
  for (auto& [pid, pr] : m.prods) {
    json ops = json::array();
    if (m.opsOf.count(pid)) for (auto& o : m.opsOf.at(pid)) ops.push_back(op_json(o));
    json alts = json::array();
    if (inst.altRoutings.count(pid))
      for (auto& [rid, aops] : inst.altRoutings.at(pid)) {
        json aj = json::array(); for (auto& o : aops) aj.push_back(op_json(o));
        alts.push_back({ {"id", rid}, {"ops", aj} });
      }
    products.push_back({ {"id", pid}, {"name", m.prodName.count(pid) ? m.prodName.at(pid) : pid},
                         {"batch_size", pr.batchSize}, {"stock", pr.stock}, {"purchased", pr.purchased},
                         {"lead_hours", pr.leadHours}, {"ops", ops}, {"alt_routings", alts} });
  }
  json workers = json::array();
  for (auto& w : m.workers) workers.push_back({ {"id", w.id}, {"name", w.name}, {"skills", w.skills}, {"cost", w.costPerHour} });
  json elig = json::object(); for (auto& [w, v] : m.eligibleWorkers) elig[w] = v;
  json orders = json::array();
  for (auto& o : inst.orders)
    orders.push_back({ {"product_id", o.productId}, {"qty", o.qty}, {"due_h", o.dueMin / 60.0}, {"release_h", o.releaseMin / 60.0},
                       {"priority", o.priority}, {"price", o.price}, {"mat_cost", o.matCost} });
  json mcal = json::object(); for (auto& [mid, c] : inst.calByM) mcal[mid] = calendar_json(c);
  const cash::FinParams& f = inst.fin;
  json fin = { {"c0", f.c0}, {"c_min", f.cMin}, {"credit_limit", f.creditLimit}, {"d0", f.d0}, {"key_rate", f.keyRate},
               {"spread", f.spread}, {"overdraft_spread", f.overdraftSpread}, {"overdraft_limit", f.overdraftLimit},
               {"tau_v", f.tauV}, {"tau_p", f.tauP}, {"tau_soc", f.tauSoc}, {"dso_kernel", f.dsoKernel},
               {"prepay_share", f.prepayShare}, {"dpo_weeks", f.dpoWeeks}, {"lead_weeks", f.leadWeeks},
               {"dscr_covenant", f.dscrCovenant}, {"payroll_weeks", f.payrollWeeks}, {"tax_cumulative", f.taxCumulative} };
  return { {"name", inst.name}, {"machines", machines}, {"wc_types", wcts}, {"products", products},
           {"workers", workers}, {"eligible", elig}, {"orders", orders}, {"calendar", calendar_json(inst.cal)},
           {"machine_calendars", mcal},
           {"outsource", { {"lead_h", inst.outsourceLeadHours}, {"markup", inst.outsourceMarkup}, {"prepay", inst.outsourcePrepay} }},
           {"fin", fin}, {"fixed", { {"payroll_w", inst.payrollFixedWeekly}, {"repair_w", inst.repairBudgetWeekly},
                                     {"other_w", inst.otherFixedWeekly} }},
           {"tail_weight", inst.tailWeight}, {"a3", a3_json(inst)} };
}

Instance instance_from_json(const json& j) {
  Instance inst; Model& m = inst.model;
  inst.name = j.value("name", std::string("instance"));
  if (j.contains("wc_types")) for (auto& w : j["wc_types"]) {
    const std::string id = str(w, "id"); m.wcName[id] = w.value("name", id);
    Model::WctRisk rk; rk.mtbf = num(w, "mtbf"); rk.repairH = num(w, "repair_h"); rk.mtbm = num(w, "mtbm"); rk.maintH = num(w, "maint_h");
    if (rk.mtbf > 0 || rk.mtbm > 0) m.wctRisk[id] = rk;
    if (!m.machinesOf.count(id)) m.machinesOf[id] = {};
  }
  if (j.contains("machines")) for (auto& mc : j["machines"]) {
    const std::string id = str(mc, "id"), wct = str(mc, "wct");
    m.machinesOf[wct].push_back(id); m.machineName[id] = mc.value("name", id); m.machineWct[id] = wct;
    const std::string sch = str(mc, "schedule"); if (!sch.empty()) m.machineSched[id] = sch;
  }
  if (j.contains("products")) for (auto& p : j["products"]) {
    const std::string id = str(p, "id");
    sched::Prod pr; pr.batchSize = std::max(1.0, num(p, "batch_size", 1)); pr.stock = num(p, "stock");
    pr.purchased = p.value("purchased", false); pr.leadHours = num(p, "lead_hours");
    m.prods[id] = pr; m.prodName[id] = p.value("name", id);
    if (p.contains("ops")) for (auto& o : p["ops"]) m.opsOf[id].push_back(op_from(o));
    if (p.contains("alt_routings")) for (auto& a : p["alt_routings"]) {
      std::vector<Op> ops; for (auto& o : a["ops"]) ops.push_back(op_from(o));
      inst.altRoutings[id].push_back({ str(a, "id"), std::move(ops) });
    }
  }
  if (j.contains("workers")) for (auto& w : j["workers"]) {
    sched::WorkerInfo wi; wi.id = str(w, "id"); wi.name = w.value("name", wi.id); wi.costPerHour = num(w, "cost");
    if (w.contains("skills")) for (auto& s : w["skills"]) wi.skills.push_back(s.get<std::string>());
    m.workers.push_back(wi);
  }
  if (j.contains("eligible") && j["eligible"].is_object())
    for (auto& [w, v] : j["eligible"].items()) m.eligibleWorkers[w] = v.get<std::vector<int>>();
  if (j.contains("orders")) for (auto& o : j["orders"]) {
    OrderSpec os; os.productId = str(o, "product_id"); os.qty = num(o, "qty", 1); os.dueMin = num(o, "due_h") * 60.0;
    os.releaseMin = num(o, "release_h") * 60.0; os.priority = (int)num(o, "priority", 5);
    os.price = num(o, "price"); os.matCost = num(o, "mat_cost"); inst.orders.push_back(os);
  }
  if (j.contains("calendar")) inst.cal = calendar_from(j["calendar"]);
  if (j.contains("machine_calendars") && j["machine_calendars"].is_object())
    for (auto& [mid, c] : j["machine_calendars"].items()) inst.calByM[mid] = calendar_from(c);
  if (j.contains("outsource")) { auto& o = j["outsource"]; inst.outsourceLeadHours = num(o, "lead_h"); inst.outsourceMarkup = num(o, "markup", 1.3); inst.outsourcePrepay = num(o, "prepay", 0.5); }
  if (j.contains("fin") && j["fin"].is_object()) {
    auto& f = j["fin"]; cash::FinParams& fp = inst.fin;
    fp.c0 = num(f, "c0", fp.c0); fp.cMin = num(f, "c_min", fp.cMin); fp.creditLimit = num(f, "credit_limit", fp.creditLimit);
    fp.d0 = num(f, "d0", fp.d0); fp.keyRate = num(f, "key_rate", fp.keyRate); fp.spread = num(f, "spread", fp.spread);
    fp.overdraftSpread = num(f, "overdraft_spread", fp.overdraftSpread); fp.overdraftLimit = num(f, "overdraft_limit", fp.overdraftLimit);
    fp.tauV = num(f, "tau_v", fp.tauV); fp.tauP = num(f, "tau_p", fp.tauP); fp.tauSoc = num(f, "tau_soc", fp.tauSoc);
    if (f.contains("dso_kernel") && f["dso_kernel"].is_array()) fp.dsoKernel = f["dso_kernel"].get<std::vector<double>>();
    fp.prepayShare = num(f, "prepay_share", fp.prepayShare); fp.dpoWeeks = (int)num(f, "dpo_weeks", fp.dpoWeeks);
    fp.leadWeeks = (int)num(f, "lead_weeks", fp.leadWeeks); fp.dscrCovenant = num(f, "dscr_covenant", fp.dscrCovenant);
    if (f.contains("payroll_weeks") && f["payroll_weeks"].is_array()) fp.payrollWeeks = f["payroll_weeks"].get<std::vector<int>>();
    fp.taxCumulative = f.value("tax_cumulative", false);
  }
  if (j.contains("fixed")) { auto& f = j["fixed"]; inst.payrollFixedWeekly = num(f, "payroll_w"); inst.repairBudgetWeekly = num(f, "repair_w"); inst.otherFixedWeekly = num(f, "other_w"); }
  inst.tailWeight = j.value("tail_weight", -1.0);
  if (j.contains("a3")) a3_from(j["a3"], inst);
  return inst;
}

Instance instance_from_db(Database& db, const std::vector<std::pair<std::string,double>>& program,
                          const std::vector<double>& dueHours, bool useCalendar) {
  Instance inst; inst.model = sched::load_model(db); Model& m = inst.model;
  inst.name = "maos-db";
  inst.cal = sched::load_calendar(db, useCalendar);
  if (useCalendar) for (auto& [mid, sch] : m.machineSched) { Calendar c; if (sched::machine_calendar(sch, c)) inst.calByM.emplace(mid, c); }
  std::unordered_map<std::string,double> baseCost, basePrice;
  for (auto& p : db.query_json("SELECT id,base_cost,base_price FROM products")) { baseCost[str(p,"id")] = num(p,"base_cost"); basePrice[str(p,"id")] = num(p,"base_price"); }
  // Программа.
  std::vector<std::pair<std::string,double>> prog = program; std::vector<double> dueH = dueHours; std::vector<int> prio;
  if (prog.empty()) {
    for (auto& r : db.query_json("SELECT product_id,quantity,due_hours,priority FROM demand_orders WHERE status<>'done' ORDER BY priority, due_hours")) {
      if (!m.opsOf.count(str(r,"product_id"))) continue;
      prog.push_back({ str(r,"product_id"), num(r,"quantity",1) }); dueH.push_back(num(r,"due_hours")); prio.push_back((int)num(r,"priority",5));
    }
  }
  for (size_t k = 0; k < prog.size(); ++k) {
    OrderSpec o; o.productId = prog[k].first; o.qty = std::max(1.0, prog[k].second);
    o.dueMin = (k < dueH.size() && dueH[k] > 0) ? dueH[k] * 60.0 : 0; o.priority = k < prio.size() ? prio[k] : 5;
    o.price = basePrice.count(o.productId) ? basePrice[o.productId] : 0;
    std::unordered_set<std::string> vis; o.matCost = mat_cost_of(o.productId, m, baseCost, vis, 0);
    inst.orders.push_back(o);
  }
  // Альтернативные техкарты (is_default=0) — для хода «маршрут».
  std::unordered_map<std::string, std::vector<std::string>> wctsOf;
  for (auto& r : db.query_json("SELECT operation_id, wc_type_id FROM operation_wc_types ORDER BY rowid")) wctsOf[str(r,"operation_id")].push_back(str(r,"wc_type_id"));
  std::unordered_map<std::string, std::vector<std::pair<std::string,double>>> inputsOf;
  for (auto& r : db.query_json("SELECT operation_id, product_id, qty FROM operation_inputs")) inputsOf[str(r,"operation_id")].push_back({ str(r,"product_id"), num(r,"qty",1) });
  std::unordered_map<std::string,double> rate; for (auto& t : db.query_json("SELECT id,hour_rate FROM work_center_types")) rate[str(t,"id")] = num(t,"hour_rate");
  for (auto& o : db.query_json("SELECT o.*, r.product_id AS product_of, r.id AS rid FROM routings r JOIN operations o ON o.routing_id=r.id "
                               "WHERE r.product_id IS NOT NULL AND r.product_id<>'' AND COALESCE(r.is_default,1)=0 ORDER BY r.product_id, r.id, o.order_no, o.id")) {
    Op op; op.id = str(o,"id"); op.name = str(o,"name");
    double tOpt = num(o,"t_opt"), tNorm = num(o,"t_norm"), tPess = num(o,"t_pess");
    if (tOpt <= 0) tOpt = tNorm; if (tPess <= 0) tPess = tNorm;
    op.tExp = (tOpt + 4*tNorm + tPess) / 6.0; if (op.tExp <= 0) op.tExp = tNorm > 0 ? tNorm : 30;
    double s = (tPess - tOpt) / 6.0; op.sigma = s > 0 ? s : op.tExp * 0.15;
    op.setupTime = num(o,"setup_time"); op.riskCoef = num(o,"risk_coef",0.05); op.tailWeight = num(o,"tail_weight",0.08);
    op.tailIndex = std::max(1.2, num(o,"tail_index",2.5)); op.orderNo = (int)num(o,"order_no",10);
    if (auto w = wctsOf.find(op.id); w != wctsOf.end()) op.wcTypes = w->second;
    op.wcType = op.wcTypes.empty() ? std::string() : op.wcTypes.front();
    op.hourRate = rate.count(op.wcType) ? rate[op.wcType] : 0; op.laborRate = num(o,"labor_rate");
    if (auto i2 = inputsOf.find(op.id); i2 != inputsOf.end()) op.inputs = i2->second;
    auto& alts = inst.altRoutings[str(o,"product_of")];
    const std::string rid = str(o,"rid");
    if (alts.empty() || alts.back().first != rid) alts.push_back({ rid, {} });
    alts.back().second.push_back(op);
  }
  // Финансы и параметры ходов — из паспорта/fin_params.
  try {
    inst.fin = passport::load_fin_params(db);
    const json fj = passport::fin_params_json(db);
    inst.payrollFixedWeekly = num(fj, "payroll_fixed_weekly"); inst.repairBudgetWeekly = num(fj, "repair_budget_weekly");
    inst.otherFixedWeekly = num(fj, "other_fixed_weekly");
    inst.outsourceLeadHours = passport::number(db, "rl.outsource_lead_hours", 72);
    inst.outsourceMarkup = passport::number(db, "rl.outsource_markup", 1.3);
    inst.outsourcePrepay = passport::number(db, "rl.outsource_prepay", 0.5);
  } catch (...) {}
  return inst;
}

Scenario Scenario::from_json(const json& j) {
  Scenario s;
  if (!j.is_object()) return s;
  s.idx = (int)num(j, "idx", 0);
  if (j.contains("key_rate")) s.keyRate = j["key_rate"].get<std::vector<double>>();
  if (j.contains("fx")) s.fx = j["fx"].get<std::vector<double>>();
  if (j.contains("cpi")) s.cpi = j["cpi"].get<std::vector<double>>();
  if (j.contains("regime")) s.regime = j["regime"].get<std::vector<int>>();
  s.defaultWeek = (int)num(j, "default_week", -1); s.lgd = num(j, "lgd", 0);
  s.leadMul = num(j, "lead_mul", 1.0); s.priceMul = num(j, "price_mul", 1.0);
  s.outageAt = num(j, "outage_at", -1); s.outageDur = num(j, "outage_dur", 0);
  s.rushAt = num(j, "rush_at", -1); s.rushQty = num(j, "rush_qty", 0.5); s.rushDue = num(j, "rush_due", 1.5);
  s.rushOrder = (int)num(j, "rush_order", 0); s.supplyDelay = num(j, "supply_delay", 0);
  s.regimeShockWeek = (int)num(j, "regime_shock_week", -1);
  return s;
}

/* ── Конструктор / построение джобов ─────────────────────────────────────── */
SimEnv::SimEnv(Instance inst, EnvConfig cfg) : inst_(std::move(inst)), cfg_(cfg) {
  const Model& m = inst_.model;
  std::vector<std::string> wcts; for (auto& [w, _] : m.machinesOf) wcts.push_back(w);
  std::sort(wcts.begin(), wcts.end());
  for (auto& w : wcts) { wctIdx_[w] = (int)wctIds_.size(); wctIds_.push_back(w); for (auto& mid : m.machinesOf.at(w)) { machineIdx_[mid] = (int)machineIds_.size(); machineIds_.push_back(mid); } }
  nBaseOrders_ = (int)inst_.orders.size();
  ord_.assign(inst_.orders.size(), OrderState{});
  due_.assign(inst_.orders.size(), 0);
  rebuild_jobs();
  // Синтетические сроки (как run_schedule, r1.17) — если в заказе due=0.
  double total = 0; for (auto& j : jobs_) total += j.durMean;
  const int K = (int)inst_.orders.size();
  for (int k = 0; k < K; ++k) {
    due_[k] = inst_.orders[k].dueMin > 0 ? inst_.orders[k].dueMin : total * (0.45 + 0.55 * (k + 1.0) / std::max(1, K));
  }
  for (auto& j : jobs_) j.dueMin = due_[j.orderIdx];
  scaleMoney_ = 0; for (auto& o : inst_.orders) scaleMoney_ += o.price * o.qty;
  if (scaleMoney_ <= 0) scaleMoney_ = 1;
  obsL0_.assign(obs_l0_size(), 0.f); maskL0_.assign(act_l0_size(), 0);
  obsL2_.assign(obs_l2_size(), 0.f); maskL2_.assign(act_l2_size(), 0);
  struct_init();
}

std::mt19937 SimEnv::job_rng(int j, uint32_t stream) const {
  const Job& jb = jobs_[j];
  uint64_t h = mix(seed_ ^ mix(stream));
  h = mix(h ^ (uint64_t)jb.orderIdx) ^ mix(hash_str(jb.opId)) ^ mix(hash_str(jb.productId) + 17);
  h = mix(h ^ ((uint64_t)jb.batchIdx << 32) ^ (uint64_t)jb.nBatchesOf);
  return std::mt19937((uint32_t)(h ^ (h >> 32)));
}

void SimEnv::rebuild_jobs(const std::vector<char>* keepDone) {
  const Model& m = inst_.model;
  // Снимок размещённых джоб по идентичности (структурный ход не трогает начатые заказы).
  std::unordered_map<std::string, int> oldIdx;
  const bool keep = keepDone && !jobs_.empty();
  auto ident = [](const Job& j) { return std::to_string(j.orderIdx) + "|" + j.opId + "|" + j.productId + "|" + std::to_string(j.batchIdx) + "/" + std::to_string(j.nBatchesOf); };
  if (keep) for (size_t i = 0; i < jobs_.size(); ++i) oldIdx[ident(jobs_[i])] = (int)i;
  std::vector<Job> old = keep ? jobs_ : std::vector<Job>{};
  sched::SimState oldSt = keep ? st_ : sched::SimState{};
  std::vector<double> oldDur = keep ? dur_ : std::vector<double>{};
  std::vector<double> oldReady = keep ? readyAt_ : std::vector<double>{}, oldFinish = keep ? finishAt_ : std::vector<double>{};

  jobs_.clear();
  std::vector<std::pair<int,double>> outsrcMark;   // A3: (джоба, работа мин) — субподряд операций
  const int K = (int)inst_.orders.size();
  const int KB = std::min(K, nBaseOrders_);
  auto expandOrder = [&](int k) {
    OrderState& os = ord_[k]; const OrderSpec& o = inst_.orders[k];
    std::unordered_map<std::string,int> batchOv; if (os.nBatches > 0) batchOv[o.productId] = os.nBatches;
    std::unordered_map<std::string,std::vector<Op>> opsOv;
    if (os.routingAlt >= 0 && inst_.altRoutings.count(o.productId) && os.routingAlt < (int)inst_.altRoutings.at(o.productId).size())
      opsOv[o.productId] = inst_.altRoutings.at(o.productId)[os.routingAlt].second;
    std::unordered_map<std::string,std::pair<double,double>> outs;
    for (auto& p : os.outsourced) outs[p] = { inst_.outsourceLeadHours * 60.0 * sc_.leadMul, inst_.outsourceLeadHours * 60.0 * 0.2 };
    std::unordered_map<std::string,std::string> forced(os.forcedType.begin(), os.forcedType.end());
    sched::Expander ex{ m, jobs_ };
    ex.batchOverride = &batchOv; ex.opsOverride = &opsOv; ex.outsourced = &outs; ex.forcedType = &forced;
    os.jobBegin = (int)jobs_.size();
    ex.expand(k, o.productId, o.qty, due_.empty() ? 1e12 : due_[k]);
    os.jobEnd = (int)jobs_.size();
    for (int i = os.jobBegin; i < os.jobEnd; ++i) { jobs_[i].releaseMin = o.releaseMin + os.shiftWeeks * kWeekMin; jobs_[i].dueMin = due_.empty() ? 1e12 : due_[k]; }
    // A3: операции узкого места у субподрядчика — джоба без станка: срок субподрядчика + сама работа.
    for (int i = os.jobBegin; i < os.jobEnd && !os.outsourcedOps.empty(); ++i) {
      Job& jb = jobs_[i];
      if (!os.outsourcedOps.count(jb.opId + "#" + std::to_string(jb.batchIdx))) continue;
      const double work = jb.durMean;
      jb.wcTypes.clear(); jb.wcType.clear(); jb.durByType.clear(); jb.needsWorker = false; jb.setupTime = 0;
      jb.durMean = inst_.outsourceLeadHours * 60.0 + work; jb.sigma = 0.2 * jb.durMean;
      jb.tailWeight = 0.05; jb.tailIndex = 2.5;
      outsrcMark.push_back({ i, work });
    }
  };
  // Дефицит покупного сырья → «поставка» как предшественник заказа (как run_schedule). Потребность —
  // по заказам ЭКЗЕМПЛЯРА: срочный заказ сценария (A2) не меняет поставок плана, получает ту же.
  double supplyLead = 0;
  {
    std::unordered_map<std::string,double> matNeed;
    std::function<void(const std::string&, double, std::unordered_set<std::string>&, int)> reqf =
      [&](const std::string& pid, double mult, std::unordered_set<std::string>& vis, int depth) {
        if (depth > 64 || vis.count(pid)) return; vis.insert(pid);
        if (auto it = m.opsOf.find(pid); it != m.opsOf.end())
          for (auto& o : it->second) for (auto& in : o.inputs) { matNeed[in.first] += mult * in.second; reqf(in.first, mult * in.second, vis, depth + 1); }
        vis.erase(pid);
      };
    for (int k = 0; k < KB; ++k) { std::unordered_set<std::string> vis; reqf(inst_.orders[k].productId, inst_.orders[k].qty, vis, 0); }
    for (auto& [mid, need] : matNeed) { auto pit = m.prods.find(mid); if (pit != m.prods.end() && pit->second.purchased && need > pit->second.stock) supplyLead = std::max(supplyLead, pit->second.leadHours); }
  }
  auto addSupply = [&](int k) {
    Job sj; sj.orderIdx = k; sj.productId = "supply"; sj.opId = "supply"; sj.opName = "Поставка/подготовка сырья";
    sj.durMean = supplyLead * 60.0 * sc_.leadMul; sj.sigma = supplyLead * 60.0 * 0.2; sj.riskCoef = 0.05; sj.tailWeight = 0.12; sj.tailIndex = 2.0;
    sj.hourRate = 0; sj.laborRate = 0; sj.dueMin = due_.empty() ? 1e12 : due_[k]; sj.needsWorker = false;
    sj.releaseMin = inst_.orders[k].releaseMin + ord_[k].shiftWeeks * kWeekMin;
    const int sjIdx = (int)jobs_.size(); jobs_.push_back(sj);
    for (int i = ord_[k].jobBegin; i < ord_[k].jobEnd; ++i) if (jobs_[i].preds.empty()) jobs_[i].preds.push_back(sjIdx);
  };
  for (int k = 0; k < KB; ++k) expandOrder(k);
  if (supplyLead > 0) for (int k = 0; k < KB; ++k) addSupply(k);
  // Срочные заказы сценария — ПОСЛЕ джоб экземпляра: индексы плана (ключи ГА/CP-SAT) не сдвигаются.
  for (int k = KB; k < K; ++k) { expandOrder(k); if (supplyLead > 0) addSupply(k); }
  const size_t J = jobs_.size();
  outsrcJob_.assign(J, 0); outsrcWork_.assign(J, 0.0);
  for (auto& [i, w] : outsrcMark) { outsrcJob_[i] = 1; outsrcWork_[i] = w; }
  // Ключи правил, работа заказов, топологический порядок.
  orderWork_.assign(K, 0); for (auto& j : jobs_) orderWork_[j.orderIdx] += j.durMean;
  keyByRule_.clear();
  for (const char* r : { "EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO" }) keyByRule_[r] = sched::priorities(r, jobs_, orderWork_);
  topo_.clear(); { std::vector<int> left(J, 0); std::vector<std::vector<int>> succ(J); for (size_t i = 0; i < J; ++i) { left[i] = (int)jobs_[i].preds.size(); for (int p : jobs_[i].preds) succ[p].push_back((int)i); }
    std::vector<int> stack; for (size_t i = 0; i < J; ++i) if (left[i] == 0) stack.push_back((int)i);
    while (!stack.empty()) { int v = stack.back(); stack.pop_back(); topo_.push_back(v); for (int s : succ[v]) if (--left[s] == 0) stack.push_back(s); } }
  // Состояние симуляции + перенос размещённых.
  sched::sim_init(st_, m, jobs_);
  st_.mFree = oldSt.mFree; st_.wFree = oldSt.wFree.empty() ? st_.wFree : oldSt.wFree; st_.lastProd = oldSt.lastProd; st_.usage = oldSt.usage;
  st_.out.nSetups = oldSt.out.nSetups; st_.out.setupMinutes = oldSt.out.setupMinutes; st_.out.setupCost = oldSt.out.setupCost;
  st_.out.nBreakdowns = oldSt.out.nBreakdowns; st_.out.breakdownMinutes = oldSt.out.breakdownMinutes; st_.out.maintMinutes = oldSt.out.maintMinutes;
  st_.out.busyByMachine = oldSt.out.busyByMachine; st_.out.busyByWorker = oldSt.out.busyByWorker.empty() ? st_.out.busyByWorker : oldSt.out.busyByWorker;
  st_.out.makespan = oldSt.out.makespan;
  // A3: рабочие экипажей купленных станков (модель могла вырасти после прошлого снимка).
  if (st_.wFree.size() < m.workers.size()) st_.wFree.resize(m.workers.size(), now_);
  if (st_.out.busyByWorker.size() < m.workers.size()) st_.out.busyByWorker.resize(m.workers.size(), 0.0);
  readyAt_.assign(J, 0); finishAt_.assign(J, -1);
  draw_durations();
  if (keep) {
    for (size_t i = 0; i < J; ++i) {
      auto it = oldIdx.find(ident(jobs_[i])); if (it == oldIdx.end()) continue;
      const int o = it->second; if (!oldSt.done[o]) continue;
      st_.done[i] = 1; ++st_.nDone; st_.out.start[i] = oldSt.out.start[o]; st_.out.end[i] = oldSt.out.end[o];
      st_.out.machineId[i] = oldSt.out.machineId[o]; st_.out.worker[i] = oldSt.out.worker[o];
      st_.out.setupJ[i] = oldSt.out.setupJ[o]; st_.out.downJ[i] = oldSt.out.downJ[o]; dur_[i] = oldDur[o];
      readyAt_[i] = oldReady[o]; finishAt_[i] = oldFinish[o];
    }
    for (size_t i = 0; i < J; ++i) {
      int left = 0; double rd = 0; bool allDone = true;
      for (int p : jobs_[i].preds) { if (!st_.done[p]) { ++left; allDone = false; } else rd = std::max(rd, finishAt_[p]); }
      st_.predLeft[i] = left; if (!st_.done[i] && allDone && !jobs_[i].preds.empty()) readyAt_[i] = rd;
    }
    // Перенумеровать события JOB_DONE (по идентичности джобы).
    std::unordered_map<std::string,int> newIdx; for (size_t i = 0; i < J; ++i) newIdx[ident(jobs_[i])] = (int)i;
    std::vector<Event> evs; while (!events_.empty()) { evs.push_back(events_.top()); events_.pop(); }
    for (Event e : evs) {
      if (e.kind == kEvJobDone && e.id >= 0) { auto it = newIdx.find(ident(old[e.id])); if (it == newIdx.end()) continue; e.id = it->second; }
      events_.push(e);
    }
  }
}

void SimEnv::draw_durations() {
  dur_.assign(jobs_.size(), 0);
  for (size_t j = 0; j < jobs_.size(); ++j) {
    if (cfg_.deterministic) { dur_[j] = jobs_[j].durMean; continue; }
    std::mt19937 r = job_rng((int)j, 1); dur_[j] = sched::sample_dur(jobs_[j], inst_.tailWeight, r);
    if (j < outsrcJob_.size() && outsrcJob_[j]) {   // A3: субподряд — свой поток (длительность не связана с цехом)
      std::mt19937 r3 = job_rng((int)j, 3); dur_[j] = sched::sample_dur(jobs_[j], 0.0, r3);
    }
  }
  // A2: срыв поставки критичного входа — задержка раскрывается только по факту (длительность поставки).
  if (supplyExtra_ > 0)
    for (size_t j = 0; j < jobs_.size(); ++j)
      if (jobs_[j].productId == "supply" && supplyShockOrders_.count(jobs_[j].orderIdx)) dur_[j] += supplyExtra_;
}

/* ── Эпизод ──────────────────────────────────────────────────────────────── */
void SimEnv::reset(uint64_t seed, const Scenario& sc) {
  seed_ = seed; sc_ = sc;
  // Срочные заказы прошлого эпизода убираются; шоки разрешаются заново по LB базового плана.
  inst_.orders.resize(nBaseOrders_); ord_.resize(nBaseOrders_); due_.resize(nBaseOrders_);
  outageMi_ = -1; outA_ = outB_ = rushRelease_ = shockT_ = -1; supplyExtra_ = 0; supplyShockOrders_.clear();
  for (auto& o : ord_) o = OrderState{};
  while (!events_.empty()) events_.pop();
  moves_.clear(); moveSeq_ = 0; weekly_.clear(); drawPlan_.clear(); repayPlan_.clear(); cashValid_ = false;
  now_ = 0; done_ = false; level_ = 0; curMachine_ = -1; nDecisions_ = nWait_ = nPlaced_ = 0; week_ = 0; movesThisWeek_ = 0; inL2_ = false;
  pendingReward_ = 0; lastSetup_ = 0;
  struct_reset();                          // A3: базовая модель/календари, статусы ходов (до развёртки)
  rebuild_jobs();
  update_bounds();
  if (sc_.has_shock() || sc_.regimeShockWeek >= 0) {
    resolve_shocks(); rebuild_jobs();
    if (rushRelease_ >= 0) {                 // жёсткий срок срочного заказа: прибытие + rushDue × его цепочка
      const int k = (int)ord_.size() - 1;
      // Цепочка — в рабочих минутах; срок — в календарном времени (смены/выходные общего календаря).
      // Нижняя оценка цикла САМОГО заказа: max(цепочка партии, Σ работы на тип / станков типа) — партии
      // проходят узкое место последовательно; без этого срок был бы невыполним при любой очерёдности.
      std::unordered_map<std::string,double> byType;
      for (int i = ord_[k].jobBegin; i < ord_[k].jobEnd; ++i) if (!jobs_[i].wcType.empty()) byType[jobs_[i].wcType] += jobs_[i].durMean;
      double lbk = order_cycle_min(k);
      for (auto& [t, w] : byType) { auto it = inst_.model.machinesOf.find(t); if (it != inst_.model.machinesOf.end() && !it->second.empty()) lbk = std::max(lbk, w / it->second.size()); }
      due_[k] = inst_.cal.advance(rushRelease_, std::max(0.1, sc_.rushDue) * lbk);
      rebuild_jobs();                        // ключи правил (EDD/CR/MS) видят срок срочного заказа
    }
    update_bounds();
  }
  scaleT_ = std::max(1.0, lbCmax_);
  if (cfg_.mode == EpochMode::Event) init_events();
  for (auto& [c, w] : pendingInvest_) if (w == 0) order_invest(c);   // A3: статические инвестиции недели 0
  if (cfg_.l2Enabled) { inL2_ = true; level_ = 2; movesThisWeek_ = 0; shockEpoch_ = false; build_obs_l2(); return; }
  if (!advance()) finish_episode();
}

void SimEnv::init_events() {
  const int M = (int)machineIds_.size();
  idle_.assign(M, 1); pollPending_.assign(M, 0);
  for (int mi = 0; mi < M; ++mi) { events_.push({ 0.0, kEvMachine, mi }); pollPending_[mi] = 1; }
  for (int w = 1; w <= cfg_.horizonWeeks + kMaxShiftWeeks + 1; ++w) events_.push({ w * kWeekMin, kEvWeek, w });
  events_.push({ 0.0, kEvJobDone, -1 });   // «старт»: поставки без станка размещаются после эпохи L2 недели 0
  // A3: экстренные события открывают внеочередную эпоху L3 (будущее не раскрывается: эпоха — в момент события).
  if (cfg_.structMode && cfg_.l2Enabled) {
    if (outageMi_ >= 0) events_.push({ outA_, kEvShock, 0 });
    if (rushRelease_ >= 0) events_.push({ rushRelease_, kEvShock, 1 });
    if (supplyRevealT_ >= 0) events_.push({ supplyRevealT_, kEvShock, 2 });
  }
}

void SimEnv::auto_place_ready_supply(int j) {
  place_job(j, std::string(), now_);
  events_.push({ st_.out.end[j], kEvJobDone, j });
}

void SimEnv::place_job(int j, const std::string& machineId, double notBefore) {
  const double bdBefore = st_.out.breakdownMinutes;
  std::mt19937 brng = job_rng(j, 2);
  const sched::Placement pl = sched::sim_place(st_, inst_.model, jobs_, j, dur_, inst_.cal, inst_.calByM, {},
                                               cfg_.breakdowns ? &brng : nullptr, machineId, notBefore);
  finishAt_[j] = pl.end; ++nPlaced_;
  if (outageMi_ >= 0 && pl.machineId == machineIds_[outageMi_]) apply_outage(j);
  if (!machineId.empty() && machineIdx_.count(machineId)) idle_[machineIdx_.at(machineId)] = 0;
  const Job& jb = jobs_[j];
  OrderState& os = ord_[jb.orderIdx];
  if (!os.started) { os.started = true; os.startMin = pl.start; book_order_start(jb.orderIdx, pl.start); }
  // A3: субподряд операции — плата субподрядчику в неделю передачи (вместо машино-часов цеха).
  if (j < (int)outsrcJob_.size() && outsrcJob_[j]) {
    const int w = (int)std::floor(pl.start / kWeekMin);
    if ((int)weekly_.size() <= w) weekly_.resize(w + 1);
    const double fee = inst_.outsourceOpMarkup * outsrcWork_[j] / 60.0 * (jb.hourRate + jb.laborRate);
    weekly_[w].otherFixed += fee; feeOutsource_ += fee;
  }
  // Конверсионные затраты недели завершения (машино-часы × ставка, труд × ставка, ремонт).
  else if (jb.productId != "supply" && jb.opId != "outsource") {
    const int w = (int)std::floor(st_.out.end[j] / kWeekMin);
    if ((int)weekly_.size() <= w) weekly_.resize(w + 1);
    const double h = (pl.proc + pl.setup) / 60.0;
    weekly_[w].conversion += h * jb.hourRate; weekly_[w].payrollGross += h * jb.laborRate;
    const double rep = st_.out.breakdownMinutes - bdBefore;
    if (rep > 0) weekly_[w].repairBreakdown += rep / 60.0 * jb.hourRate * cfg_.repairCostMul;
  }
  lastSetup_ = pl.setup;
}

void SimEnv::on_job_done(int j) {
  const Job& jb = jobs_[j];
  OrderState& os = ord_[jb.orderIdx];
  bool all = true; for (int i = os.jobBegin; i < os.jobEnd && all; ++i) if (!st_.done[i] || finishAt_[i] > now_ + 1e-9) all = false;
  if (all && os.finishMin < 0) { os.finishMin = now_; book_order_finish(jb.orderIdx, now_); }
  for (int s : st_.succ[j]) {
    if (st_.done[s]) continue;
    bool ready = true; for (int p : jobs_[s].preds) if (!st_.done[p] || finishAt_[p] > now_ + 1e-9) { ready = false; break; }
    if (!ready) continue;
    readyAt_[s] = now_;
    if (jobs_[s].wcTypes.empty() && jobs_[s].wcType.empty()) { auto_place_ready_supply(s); continue; }
    for (auto& w : jobs_[s].wcTypes) if (inst_.model.machinesOf.count(w))
      for (auto& mid : inst_.model.machinesOf.at(w)) { const int mi = machineIdx_.at(mid); if (idle_[mi] && !pollPending_[mi]) { pollPending_[mi] = 1; events_.push({ now_, kEvMachine, mi }); } }
  }
}

// Кандидаты для станка mi в момент now_: все предшественники завершены к now_, тип допустим,
// есть допущенный рабочий, освобождающийся не позже now_ (иначе — повторный опрос).
void SimEnv::collect_candidates(int mIdx) {
  cands_.clear();
  const Model& m = inst_.model; const std::string& mid = machineIds_[mIdx]; const std::string& wct = m.machineWct.at(mid);
  double nextWorker = std::numeric_limits<double>::infinity(), nextRelease = std::numeric_limits<double>::infinity();
  for (size_t j = 0; j < jobs_.size(); ++j) {
    if (st_.done[j] || st_.predLeft[j] != 0) continue;
    const Job& jb = jobs_[j];
    if (std::find(jb.wcTypes.begin(), jb.wcTypes.end(), wct) == jb.wcTypes.end()) continue;
    bool ready = true; for (int p : jb.preds) if (finishAt_[p] > now_ + 1e-9) { ready = false; break; }
    if (!ready) continue;
    if (jb.releaseMin > now_ + 1e-9) { nextRelease = std::min(nextRelease, jb.releaseMin); continue; }   // сдвиг запуска: опрос в дату запуска
    if (!m.workers.empty() && jb.needsWorker) {
      double best = std::numeric_limits<double>::infinity();
      auto el = m.eligibleWorkers.find(wct);
      if (el != m.eligibleWorkers.end()) { for (int w : el->second) best = std::min(best, st_.wFree[w]); }
      else for (double f : st_.wFree) best = std::min(best, f);
      if (best > now_ + 1e-9) { nextWorker = std::min(nextWorker, best); continue; }
    }
    cands_.push_back((int)j);
  }
  const double repoll = std::min(nextWorker, nextRelease);
  if (cands_.empty() && std::isfinite(repoll) && !pollPending_[mIdx]) { pollPending_[mIdx] = 1; events_.push({ repoll, kEvMachine, mIdx }); }
  std::sort(cands_.begin(), cands_.end(), [&](int a, int b) {
    if (jobs_[a].dueMin != jobs_[b].dueMin) return jobs_[a].dueMin < jobs_[b].dueMin;
    return a < b; });
}

bool SimEnv::advance() {
  if (cfg_.mode == EpochMode::Serial) {
    if (st_.nDone >= jobs_.size()) return false;
    cands_.clear();
    for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && st_.predLeft[j] == 0) cands_.push_back((int)j);
    if (cands_.empty()) { for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j]) { cands_.push_back((int)j); break; } }
    std::sort(cands_.begin(), cands_.end(), [&](int a, int b) { return jobs_[a].dueMin != jobs_[b].dueMin ? jobs_[a].dueMin < jobs_[b].dueMin : a < b; });
    curMachine_ = -1; level_ = 0; build_obs_l0(); return true;
  }
  // Все джобы размещены → дообработать оставшиеся завершения (книга заказов: выручка, окончания),
  // иначе заказы, чьи последние операции размещены последними, никогда не «завершаются».
  auto drain = [&]() {
    while (!events_.empty()) {
      const Event e = events_.top(); events_.pop();
      if (e.kind != kEvJobDone || e.id < 0) continue;
      now_ = std::max(now_, e.t); on_job_done(e.id);
    }
  };
  while (!events_.empty()) {
    if (st_.nDone >= jobs_.size()) { drain(); return false; }
    const Event e = events_.top(); events_.pop();
    now_ = std::max(now_, e.t);
    if (e.kind == kEvJobDone) {
      if (e.id < 0) { for (size_t j = 0; j < jobs_.size(); ++j) if (st_.predLeft[j] == 0 && !st_.done[j] && jobs_[j].wcTypes.empty() && jobs_[j].wcType.empty() && jobs_[j].releaseMin <= now_ + 1e-9) auto_place_ready_supply((int)j); }
      else on_job_done(e.id);
      continue;
    }
    if (e.kind == kEvInvest) { activate_invest(e.id); continue; }
    if (e.kind == kEvShock) {
      if (cfg_.l2Enabled && cfg_.structMode) { inL2_ = true; level_ = 2; movesThisWeek_ = 0; shockEpoch_ = true; build_obs_l2(); return true; }
      continue;
    }
    if (e.kind == kEvWeek) {
      week_ = e.id;
      expire_overtime(e.id);                 // A3: сверхурочные недели e.id−1 закончились
      for (auto& [c, w] : pendingInvest_) if (w == e.id) order_invest(c);
      // Поставки без станка, чей запуск (сдвиг L2) наступил, размещаются на границе недели.
      for (size_t j = 0; j < jobs_.size(); ++j) if (st_.predLeft[j] == 0 && !st_.done[j] && jobs_[j].wcTypes.empty() && jobs_[j].wcType.empty() && jobs_[j].releaseMin <= now_ + 1e-9) auto_place_ready_supply((int)j);
      if (cfg_.l2Enabled && e.id <= cfg_.horizonWeeks) { inL2_ = true; level_ = 2; movesThisWeek_ = 0; shockEpoch_ = false; build_obs_l2(); return true; }
      continue;
    }
    const int mi = e.id; pollPending_[mi] = 0;
    if (!idle_[mi]) { if (st_.mFree.count(machineIds_[mi]) && st_.mFree.at(machineIds_[mi]) <= now_ + 1e-9) idle_[mi] = 1; else continue; }
    if (mi == outageMi_ && now_ >= outA_ - 1e-9 && now_ < outB_ - 1e-9) {   // A2: станок в отказе до outB_
      if (!pollPending_[mi]) { pollPending_[mi] = 1; events_.push({ outB_, kEvMachine, mi }); }
      continue;
    }
    const Calendar& mcal = inst_.calByM.count(machineIds_[mi]) ? inst_.calByM.at(machineIds_[mi]) : inst_.cal;
    const double nw = mcal.nextWork(now_);
    if (nw > now_ + 1e-9) { if (!pollPending_[mi]) { pollPending_[mi] = 1; events_.push({ nw, kEvMachine, mi }); } continue; }
    collect_candidates(mi);
    if (cands_.empty()) continue;
    curMachine_ = mi; level_ = 0; build_obs_l0(); return true;
  }
  // Событий нет, но джобы остались (не должно случаться при корректных масках) —
  // дораз мещаем серийно, чтобы эпизод всегда завершался.
  while (st_.nDone < jobs_.size()) {
    int pick = -1;
    for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && st_.predLeft[j] == 0) { pick = (int)j; break; }
    if (pick < 0) for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j]) { pick = (int)j; break; }
    place_job(pick, std::string(), now_);
    if (jobs_[pick].orderIdx >= 0) { now_ = std::max(now_, st_.out.end[pick]); on_job_done(pick); }
  }
  drain();
  return false;
}

StepResult SimEnv::step_job(int j) {
  StepResult r; if (done_) { r.done = true; r.level = -1; return r; }
  if (level_ != 0) throw std::runtime_error("step_job: текущая эпоха — не L0");
  if (j < 0 || j >= (int)jobs_.size() || st_.done[j] || std::find(cands_.begin(), cands_.end(), j) == cands_.end())
    throw std::runtime_error("step_job: джоба не в списке кандидатов");
  ++nDecisions_;
  if (cfg_.mode == EpochMode::Serial) {
    place_job(j, std::string(), 0.0);
  } else {
    const std::string& mid = machineIds_[curMachine_];
    place_job(j, mid, now_);
    events_.push({ st_.out.end[j], kEvJobDone, j });
    events_.push({ st_.out.end[j], kEvMachine, curMachine_ }); pollPending_[curMachine_] = 1;
  }
  if (cfg_.denseReward) pendingReward_ += dense_delta() - cfg_.cSetup * lastSetup_ / scaleT_;
  if (!advance()) { finish_episode(); r.done = true; r.level = -1; }
  else r.level = level_;
  r.reward = pendingReward_; pendingReward_ = 0; return r;
}

StepResult SimEnv::step(int action) {
  StepResult r; if (done_) { r.done = true; r.level = -1; return r; }
  if (level_ == 2) {
    const bool anyAllowed = std::any_of(maskL2_.begin() + 1, maskL2_.end(), [](uint8_t v) { return v != 0; });
    if (action <= 0 || action >= act_l2_size() || !maskL2_[action] || movesThisWeek_ >= cfg_.maxMovesPerWeek || !anyAllowed) {
      inL2_ = false; level_ = 0;
      if (!advance()) { finish_episode(); r.done = true; r.level = -1; }
      else r.level = level_;
      r.reward = pendingReward_; pendingReward_ = 0; return r;
    }
    std::string why;
    if (cfg_.structMode ? apply_struct(action, why) : apply_move(action, why)) { ++movesThisWeek_; }
    if (cfg_.denseReward) pendingReward_ += dense_delta();
    build_obs_l2(); r.level = 2; r.reward = pendingReward_; pendingReward_ = 0; return r;
  }
  // L0: слот кандидата или WAIT (последний индекс).
  if (action < 0 || action >= act_l0_size() || !maskL0_[action]) throw std::runtime_error("step: действие вне маски");
  if (action == cfg_.kMaxCands) {   // WAIT: станок простаивает до БЛИЖАЙШЕГО завершения операции, затем опрашивается снова
    ++nDecisions_; ++nWait_;
    if (cfg_.mode == EpochMode::Serial) throw std::runtime_error("WAIT недопустим в серийном режиме");
    double nextDone = -1; { auto copy = events_; while (!copy.empty()) { const Event& e = copy.top(); if (e.kind == kEvJobDone && e.t > now_ + 1e-9) { nextDone = e.t; break; } copy.pop(); } }
    if (nextDone >= 0 && curMachine_ >= 0 && !pollPending_[curMachine_]) { pollPending_[curMachine_] = 1; events_.push({ nextDone, kEvMachine, curMachine_ }); }
    const double t0 = now_;
    const bool cont = advance();
    // Цена простоя начисляется САМОМУ действию WAIT (иначе её платит следующее размещение — reward hacking).
    if (cfg_.denseReward) pendingReward_ += dense_delta() - cfg_.cWait * (now_ - t0) / scaleT_;
    if (!cont) { finish_episode(); r.done = true; r.level = -1; } else r.level = level_;
    r.reward = pendingReward_; pendingReward_ = 0; return r;
  }
  return step_job(slotJob_[action]);
}

int SimEnv::rule_choice(const std::string& rule) const {
  if (cands_.empty()) return -1;
  auto it = keyByRule_.find(rule);
  const std::vector<double>* key = it != keyByRule_.end() ? &it->second : nullptr;
  int best = cands_[0];
  for (int j : cands_) { const double a = key ? (*key)[j] : (double)j, b = key ? (*key)[best] : (double)best; if (a < b || (a == b && j < best)) best = j; }
  return best;
}
int SimEnv::key_choice(const std::vector<double>& key) const {
  if (cands_.empty()) return -1;
  // Джобы вне ключа (срочный заказ сценария, A2): статический план о них не знал — диспетчер ставит их
  // первыми по сроку (сильнейшая разумная реакция статического плана, а не «в конец очереди»).
  auto k = [&](int j) { return j < (int)key.size() ? key[j] : -1e18 + jobs_[j].dueMin; };
  int best = cands_[0];
  for (int j : cands_) if (k(j) < k(best) || (k(j) == k(best) && j < best)) best = j;
  return best;
}
int SimEnv::expedite_choice(const std::string& rule, const std::vector<double>& key) const {
  int best = -1;
  for (int j : cands_)
    if (jobs_[j].orderIdx >= nBaseOrders_ && (best < 0 || jobs_[j].dueMin < jobs_[best].dueMin || (jobs_[j].dueMin == jobs_[best].dueMin && j < best))) best = j;
  if (best >= 0) return best;
  return rule.empty() ? key_choice(key) : rule_choice(rule);
}
int SimEnv::rule_slot(const std::string& rule) const {
  const int j = rule_choice(rule);
  for (size_t s = 0; s < slotJob_.size(); ++s) if (slotJob_[s] == j) return (int)s;
  return cfg_.kMaxCands;
}

/* ── Оценки для плотной награды ──────────────────────────────────────────── */
void SimEnv::update_bounds() {
  const size_t J = jobs_.size(); std::vector<double> est(J, 0);
  double lb = st_.out.makespan; std::vector<double> ordEnd(ord_.size(), 0);
  for (int v : topo_) {
    const Job& j = jobs_[v]; double e;
    if (st_.done[v]) e = st_.out.end[v];
    else { double s = std::max(now_, j.releaseMin); for (int p : j.preds) s = std::max(s, est[p]); e = s + j.durMean; }
    est[v] = e; lb = std::max(lb, e); ordEnd[j.orderIdx] = std::max(ordEnd[j.orderIdx], e);
  }
  lbCmax_ = lb; tardEst_ = 0;
  for (size_t k = 0; k < ord_.size(); ++k) tardEst_ += std::max(0.0, ordEnd[k] - due_[k]);
}
double SimEnv::dense_delta() {
  const double lb0 = lbCmax_, t0 = tardEst_;
  update_bounds();
  return -(lbCmax_ - lb0) / scaleT_ - cfg_.cTard * (tardEst_ - t0) / scaleT_;
}

/* ── Наблюдения ──────────────────────────────────────────────────────────── */
void SimEnv::build_obs_l0() {
  std::fill(obsL0_.begin(), obsL0_.end(), 0.f); std::fill(maskL0_.begin(), maskL0_.end(), 0);
  const Model& m = inst_.model; const int K = cfg_.kMaxCands;
  slotJob_.assign(K, -1);
  double maxVal = 1; for (auto& o : inst_.orders) maxVal = std::max(maxVal, o.price * o.qty);
  const std::string mid = curMachine_ >= 0 ? machineIds_[curMachine_] : std::string();
  const std::string wct = mid.empty() ? std::string() : m.machineWct.at(mid);
  const std::string lastP = (!mid.empty() && st_.lastProd.count(mid)) ? st_.lastProd.at(mid) : std::string();
  // Остаточная работа по цепочке (из ключа MWKR: key = −rem).
  const auto& mwkr = keyByRule_.at("MWKR");
  std::vector<int> doneOf(ord_.size(), 0), totOf(ord_.size(), 0);
  for (size_t j = 0; j < jobs_.size(); ++j) { ++totOf[jobs_[j].orderIdx]; if (st_.done[j]) ++doneOf[jobs_[j].orderIdx]; }
  const int n = std::min(K, (int)cands_.size());
  for (int s = 0; s < n; ++s) {
    const int j = cands_[s]; const Job& jb = jobs_[j]; slotJob_[s] = j; maskL0_[s] = 1;
    float* f = &obsL0_[s * kCandFeats];
    double d = jb.durMean; if (!wct.empty()) for (auto& [t, mean] : jb.durByType) if (t == wct) d = mean;
    const double rem = -mwkr[j];
    f[0] = (float)(d / scaleT_); f[1] = (float)(jb.sigma / std::max(1.0, jb.durMean));
    f[2] = (float)std::max(-3.0, std::min(3.0, (jb.dueMin - now_ - rem) / scaleT_));
    f[3] = (jb.setupTime > 0 && lastP != jb.productId) ? 1.f : 0.f;
    f[4] = (float)(jb.nInputs / 5.0); f[5] = (float)(rem / scaleT_);
    const OrderSpec& o = inst_.orders[jb.orderIdx];
    f[6] = (float)(o.price * o.qty / maxVal); f[7] = totOf[jb.orderIdx] > 0 ? (float)doneOf[jb.orderIdx] / totOf[jb.orderIdx] : 0.f;
    f[8] = st_.succ[j].empty() ? 1.f : 0.f; f[9] = (float)jb.batchIdx / std::max(1, jb.nBatchesOf);
    f[10] = (float)std::min(3.0, (now_ - readyAt_[j]) / scaleT_); f[11] = (float)(o.priority / 10.0);
  }
  float* g = &obsL0_[K * kCandFeats];
  if (!mid.empty()) {
    const auto rk = m.wctRisk.find(wct);
    const double usage = st_.usage.count(mid) ? st_.usage.at(mid) : 0;
    g[0] = (rk != m.wctRisk.end() && rk->second.mtbm > 0) ? (float)(std::fmod(usage, rk->second.mtbm * 60.0) / (rk->second.mtbm * 60.0)) : 0.f;
    const double busy = st_.out.busyByMachine.count(mid) ? st_.out.busyByMachine.at(mid) : 0;
    g[1] = now_ > 0 ? (float)std::min(1.0, busy / now_) : 0.f;
    g[2] = (float)std::min(3.0, now_ / (cfg_.horizonWeeks * kWeekMin)); g[3] = now_ > 0 ? (float)std::max(0.0, 1.0 - busy / now_) : 0.f;
    // Пул соседей того же типа (mean-field).
    int peers = 0, idle = 0, same = 0; double remBusy = 0;
    const std::string p0 = n > 0 ? jobs_[cands_[0]].productId : std::string();
    for (auto& pm : m.machinesOf.at(wct)) { if (pm == mid) continue; ++peers; const double fr = st_.mFree.count(pm) ? st_.mFree.at(pm) : 0; if (fr <= now_ + 1e-9) ++idle; else remBusy += fr - now_; if (st_.lastProd.count(pm) && st_.lastProd.at(pm) == p0) ++same; }
    g[4] = peers ? (float)idle / peers : 1.f; g[5] = peers ? (float)(remBusy / peers / scaleT_) : 0.f; g[6] = peers ? (float)same / peers : 0.f; g[7] = (float)(peers / 10.0);
  }
  // Глобальные: режим, флаг кассы, ключевая ставка, доля выполненного.
  const int w = std::min((int)std::floor(now_ / kWeekMin), (int)sc_.regime.size() - 1);
  const int rg = (w >= 0 && w < (int)sc_.regime.size()) ? sc_.regime[w] : 0;
  if (rg >= 0 && rg < 3) g[8 + rg] = 1.f;
  double cashNow = inst_.fin.c0; if (cashValid_ && !cashRes_.periods.empty()) cashNow = cashRes_.periods.back().netCash;
  g[11] = cashNow < kCashRiskShare * scaleMoney_ ? 1.f : 0.f;
  const int wk = std::min((int)std::floor(now_ / kWeekMin), std::max(0, (int)sc_.keyRate.size() - 1));
  g[12] = (float)((!sc_.keyRate.empty() ? sc_.keyRate[wk] : inst_.fin.keyRate) / 0.2);
  g[13] = jobs_.empty() ? 0.f : (float)st_.nDone / jobs_.size();
  // A2: экстренные события, наблюдаемые к моменту now_ (будущее не раскрывается).
  g[14] = (outageMi_ >= 0 && now_ >= outA_ - 1e-9 && now_ < outB_ - 1e-9) ? 1.f : 0.f;
  g[15] = (shockT_ >= 0 && now_ >= shockT_ - 1e-9) ? 1.f : 0.f;
  if (rushRelease_ >= 0 && now_ >= rushRelease_ - 1e-9 && (int)ord_.size() > nBaseOrders_) {
    double rem = 0, tot = 0;
    for (int k = nBaseOrders_; k < (int)ord_.size(); ++k)
      for (int i = ord_[k].jobBegin; i < ord_[k].jobEnd; ++i) { tot += jobs_[i].durMean; if (!st_.done[i]) rem += jobs_[i].durMean; }
    g[16] = tot > 0 ? (float)(rem / tot) : 0.f;
  }
  for (size_t j = 0; j < jobs_.size() && supplyExtra_ > 0; ++j)
    if (jobs_[j].productId == "supply" && st_.done[j] && now_ > st_.out.start[j] + jobs_[j].durMean && now_ < finishAt_[j]) { g[17] = 1.f; break; }
  // WAIT — только если ожидается событие завершения (иначе тупик).
  // WAIT — только если ближайшее завершение операции наступит в окне Δ (§7.3а); иначе тупик/простой.
  bool pending = false; { auto copy = events_; while (!copy.empty()) { const Event& e = copy.top(); if (e.kind == kEvJobDone && e.t > now_ + 1e-9) { pending = e.t - now_ <= cfg_.waitWindowMin; break; } copy.pop(); } }
  maskL0_[K] = (cfg_.mode == EpochMode::Event && pending && n > 0) ? 1 : 0;
}

std::pair<double,double> SimEnv::cash_state() const {
  if (!cashValid_ || cashRes_.periods.empty()) return { inst_.fin.c0, std::max(0.0, inst_.fin.creditLimit - inst_.fin.d0) };
  const auto& p = cashRes_.periods.back(); return { p.netCash, p.undrawn };
}

double SimEnv::order_cycle_min(int k) const {
  // Длина критической цепочки заказа по средним (нижняя оценка цикла).
  double best = 0; const auto& mwkr = keyByRule_.at("MWKR");
  for (int i = ord_[k].jobBegin; i < ord_[k].jobEnd; ++i) best = std::max(best, -mwkr[i]);
  for (size_t i = 0; i < jobs_.size(); ++i) if (jobs_[i].orderIdx == k) best = std::max(best, -mwkr[i]);
  return best;
}
std::string SimEnv::largest_semi_input(int k) const {
  const Model& m = inst_.model; const std::string& pid = inst_.orders[k].productId;
  std::string best; double bw = 0;
  auto it = m.opsOf.find(pid); if (it == m.opsOf.end()) return best;
  for (auto& o : it->second) for (auto& [q, qty] : o.inputs) {
    if (ord_[k].outsourced.count(q)) continue;
    auto oq = m.opsOf.find(q); if (oq == m.opsOf.end() || oq->second.empty()) continue;
    double w = 0; for (auto& o2 : oq->second) w += o2.tExp; w *= qty;
    if (w > bw) { bw = w; best = q; }
  }
  return best;
}
std::string SimEnv::bottleneck_op_of(int k, std::string& altType) const {
  const Model& m = inst_.model; const std::string& pid = inst_.orders[k].productId;
  const std::vector<Op>* ops = nullptr;
  if (ord_[k].routingAlt >= 0 && inst_.altRoutings.count(pid)) ops = &inst_.altRoutings.at(pid)[ord_[k].routingAlt].second;
  else if (m.opsOf.count(pid)) ops = &m.opsOf.at(pid);
  if (!ops) return "";
  std::unordered_map<std::string,double> load;   // тип → незавершённая работа в очереди
  for (size_t i = 0; i < jobs_.size(); ++i) if (!st_.done[i]) load[jobs_[i].wcType] += jobs_[i].durMean;
  std::string best; double bl = -1;
  for (auto& o : *ops) {
    if (o.wcTypes.size() < 2) continue;
    const std::string cur = ord_[k].forcedType.count(o.id) ? ord_[k].forcedType.at(o.id) : o.wcType;
    const double l = load[cur];
    if (l > bl) { bl = l; best = o.id;
      size_t ci = 0; for (size_t t = 0; t < o.wcTypes.size(); ++t) if (o.wcTypes[t] == cur) ci = t;
      altType.clear();
      for (size_t t = 1; t <= o.wcTypes.size(); ++t) { const std::string& cand = o.wcTypes[(ci + t) % o.wcTypes.size()]; if (cand != cur && m.machinesOf.count(cand) && !m.machinesOf.at(cand).empty()) { altType = cand; break; } }
    }
  }
  return altType.empty() ? std::string() : best;
}

bool SimEnv::move_allowed(int kind, int k) const {
  if (k < 0 || k >= (int)ord_.size()) return false;
  const OrderState& os = ord_[k]; const OrderSpec& o = inst_.orders[k];
  if (os.started) return false;
  const double release = o.releaseMin + os.shiftWeeks * kWeekMin, cycle = order_cycle_min(k);
  switch (kind) {
    case 0: return os.shiftWeeks < kMaxShiftWeeks && release + kWeekMin + cycle <= due_[k] + 1e-9;
    case 1: return os.shiftWeeks > 0;
    case 2: { const double sf = std::max(1.0, o.qty / (inst_.model.prods.count(o.productId) ? inst_.model.prods.at(o.productId).batchSize : 1));
              const int N = os.nBatches > 0 ? os.nBatches : sched::Expander::nBatches(sf);
              return N * 2 <= kMaxBatches && N * 2 <= (int)std::ceil(sf); }
    case 3: { const double sf = std::max(1.0, o.qty / (inst_.model.prods.count(o.productId) ? inst_.model.prods.at(o.productId).batchSize : 1));
              const int N = os.nBatches > 0 ? os.nBatches : sched::Expander::nBatches(sf); return N > 1; }
    case 4: { if (inst_.outsourceLeadHours <= 0) return false; const std::string q = largest_semi_input(k); if (q.empty()) return false;
              const auto [c, u] = cash_state(); return c + u >= inst_.outsourcePrepay * o.matCost * o.qty * inst_.outsourceMarkup; }
    case 5: return inst_.altRoutings.count(o.productId) && !inst_.altRoutings.at(o.productId).empty();
    case 6: { std::string alt; return !bottleneck_op_of(k, alt).empty(); }
  }
  return false;
}

bool SimEnv::apply_move(int action, std::string& why) {
  const int K = cfg_.kMaxOrders, base = 1 + kMoveKinds * K;
  MoveLog ml; ml.week = week_; ml.id = "mv-" + std::to_string(++moveSeq_);
  if (action >= base + kFinActs) {   // A3-крючок: invest (мощность типа РЦ) — записывается, эффект — волна A3
    const int wi = action - base - kFinActs;
    if (!invest_allowed(wi)) { why = "маска"; return false; }
    ml.kind = "invest"; ml.before = { {"week", week_} };
    ml.after = { {"wc_type", wctIds_[wi]}, {"capex", inst_.investCapex}, {"lead_weeks", inst_.investLeadWeeks},
                 {"status", "крючок A3: мощность и транш не моделируются"} };
    ml.masksChecked = { "investEnabled", "CAPEX задан", "тип РЦ существует" };
    moves_.push_back(ml); return true;
  }
  if (action >= base) {    // финансовые действия: транш доли невыбранного лимита / погашение
    const int fa = action - base; const auto [c, u] = cash_state();
    if ((int)drawPlan_.size() <= week_) { drawPlan_.resize(week_ + 1, -1); repayPlan_.resize(week_ + 1, -1); }
    const double shares[3] = { 0.25, 0.5, 1.0 };
    ml.kind = "finance"; ml.before = { {"week", week_}, {"cash", c}, {"undrawn", u} };
    if (fa < 3) { drawPlan_[week_] = shares[fa] * u; ml.after = { {"drawdown", drawPlan_[week_]} }; ml.masksChecked = { "d_t ≤ U_t" }; }
    else { const double rep = (fa == 3 ? 0.5 : 1.0) * std::max(0.0, c - inst_.fin.cMin); repayPlan_[week_] = rep; ml.after = { {"repayment", rep} }; ml.masksChecked = { "rep_t ≤ C_t − C_min" }; }
    moves_.push_back(ml); return true;
  }
  const int kind = (action - 1) / K, k = (action - 1) % K;
  if (!move_allowed(kind, k)) { why = "маска"; return false; }
  OrderState& os = ord_[k]; const OrderSpec& o = inst_.orders[k];
  ml.kind = kMoveKindNames[kind]; ml.orderIdx = k;
  ml.before = { {"shift_weeks", os.shiftWeeks}, {"n_batches", os.nBatches}, {"routing_alt", os.routingAlt},
                {"outsourced", std::vector<std::string>(os.outsourced.begin(), os.outsourced.end())}, {"forced_type", os.forcedType} };
  const double sf = std::max(1.0, o.qty / (inst_.model.prods.count(o.productId) ? inst_.model.prods.at(o.productId).batchSize : 1));
  const int N = os.nBatches > 0 ? os.nBatches : sched::Expander::nBatches(sf);
  switch (kind) {
    case 0: os.shiftWeeks += 1; ml.masksChecked = { "запуск + цикл ≤ срок", "сдвиг ≤ 4 нед" }; break;
    case 1: os.shiftWeeks -= 1; ml.masksChecked = { "запуск ≥ release_hours" }; break;
    case 2: os.nBatches = N * 2; ml.masksChecked = { "N' ≤ 16", "N' ≤ объём/партия" }; break;
    case 3: os.nBatches = std::max(1, N / 2); ml.masksChecked = { "N' ≥ 1" }; break;
    case 4: { const std::string q = largest_semi_input(k); os.outsourced.insert(q); ml.after["product"] = q;
              ml.masksChecked = { "предложение [К] существует", "C_t + U_t ≥ предоплата" }; break; }
    case 5: os.routingAlt = (os.routingAlt + 2) % ((int)inst_.altRoutings.at(o.productId).size() + 1) - 1; ml.masksChecked = { "техкарта действует" }; break;
    case 6: { std::string alt; const std::string op = bottleneck_op_of(k, alt); os.forcedType[op] = alt; ml.after["op_id"] = op; ml.after["wc_type"] = alt;
              ml.masksChecked = { "тип допустим (operation_wc_types)", "есть активные станки типа" }; break; }
  }
  ml.after["shift_weeks"] = os.shiftWeeks; ml.after["n_batches"] = os.nBatches; ml.after["routing_alt"] = os.routingAlt;
  std::vector<char> keep(jobs_.size(), 1);
  rebuild_jobs(&keep);
  moves_.push_back(ml);
  return true;
}

std::string SimEnv::describe_l2(int action) const {
  if (action <= 0) return "noop";
  if (cfg_.structMode) return action < kStructActs ? kStructActNames[action] : "?";
  const int K = cfg_.kMaxOrders, base = 1 + kMoveKinds * K;
  if (action >= base + kFinActs) return "invest#" + std::to_string(action - base - kFinActs);   // A3-крючок
  if (action >= base) { static const char* fa[kFinActs] = { "draw25", "draw50", "draw100", "repay50", "repay100" }; return fa[std::min(kFinActs - 1, action - base)]; }
  return std::string(kMoveKindNames[(action - 1) / K]) + "#" + std::to_string((action - 1) % K);
}

void SimEnv::build_obs_l2() {
  if (cfg_.structMode) { build_obs_struct(); return; }
  std::fill(obsL2_.begin(), obsL2_.end(), 0.f); std::fill(maskL2_.begin(), maskL2_.end(), 0);
  maskL2_[0] = 1;
  const int K = cfg_.kMaxOrders, nO = std::min(K, (int)ord_.size());
  if (week_ > 0 && (!cashValid_ || (int)cashRes_.periods.size() != week_)) { cashRes_ = run_cash(week_); cashValid_ = true; }
  double maxVal = 1; for (auto& o : inst_.orders) maxVal = std::max(maxVal, o.price * o.qty);
  std::vector<double> remW(ord_.size(), 0); for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j]) remW[jobs_[j].orderIdx] += jobs_[j].durMean;
  for (int k = 0; k < nO; ++k) {
    const OrderState& os = ord_[k]; const OrderSpec& o = inst_.orders[k]; float* f = &obsL2_[k * kOrderFeats];
    f[0] = (float)std::max(-3.0, std::min(3.0, (due_[k] - now_ - order_cycle_min(k)) / scaleT_));
    f[1] = orderWork_[k] > 0 ? (float)(remW[k] / orderWork_[k]) : 0.f; f[2] = (float)(o.price * o.qty / maxVal); f[3] = os.started ? 1.f : 0.f;
    f[4] = (float)(os.nBatches / 16.0); f[5] = (float)(os.shiftWeeks / 4.0); f[6] = (float)(os.outsourced.size() / 3.0);
    f[7] = (due_[k] - now_ - order_cycle_min(k) < 0) ? 1.f : 0.f;
    for (int kind = 0; kind < kMoveKinds; ++kind) if (move_allowed(kind, k)) maskL2_[1 + kind * K + k] = 1;
  }
  float* q = &obsL2_[K * kOrderFeats];
  for (size_t j = 0; j < jobs_.size(); ++j) if (!st_.done[j] && st_.predLeft[j] == 0 && wctIdx_.count(jobs_[j].wcType)) { const int wi = wctIdx_.at(jobs_[j].wcType); if (wi < cfg_.kMaxWct) q[wi] += 0.1f; }
  float* g = &obsL2_[K * kOrderFeats + cfg_.kMaxWct];
  const auto [c, u] = cash_state(); const double lim = std::max(1.0, inst_.fin.creditLimit);
  g[0] = (float)(c / scaleMoney_); g[1] = (float)((lim - u) / lim); g[2] = (float)(u / lim);
  g[3] = (cashValid_ && cashRes_.breach) ? 1.f : 0.f; g[4] = cashValid_ ? (float)std::min(5.0, cashRes_.minDscr) : 5.f;
  const int wk = std::min(week_, std::max(0, (int)sc_.keyRate.size() - 1));
  g[5] = (float)((!sc_.keyRate.empty() ? sc_.keyRate[wk] : inst_.fin.keyRate) / 0.2);
  g[6] = (!sc_.fx.empty() && sc_.fx[0] > 0) ? (float)(sc_.fx[std::min(week_, (int)sc_.fx.size() - 1)] / sc_.fx[0] - 1.0) : 0.f;
  g[7] = !sc_.cpi.empty() ? (float)(sc_.cpi[std::min(week_, (int)sc_.cpi.size() - 1)] / 20.0) : 0.f;
  const int rg = (week_ < (int)sc_.regime.size()) ? sc_.regime[week_] : 0; if (rg >= 0 && rg < 3) g[8 + rg] = 1.f;
  g[11] = (float)week_ / std::max(1, cfg_.horizonWeeks);
  // Финансовые действия.
  const int base = 1 + kMoveKinds * K;
  for (int i = 0; i < 3; ++i) maskL2_[base + i] = u > 0 ? 1 : 0;
  const bool hasDebt = !(cashValid_ && !cashRes_.periods.empty()) ? inst_.fin.d0 > 0 : cashRes_.periods.back().debt > 0;
  maskL2_[base + 3] = maskL2_[base + 4] = (c - inst_.fin.cMin > 0 && hasDebt) ? 1 : 0;
  if (cfg_.investEnabled)                                   // A3-крючок: invest по типу РЦ
    for (int wi = 0; wi < cfg_.kMaxWct; ++wi) maskL2_[base + kFinActs + wi] = invest_allowed(wi) ? 1 : 0;
}

/* ── Деньги ──────────────────────────────────────────────────────────────── */
void SimEnv::book_order_start(int k, double t) {
  const OrderSpec& o = inst_.orders[k]; const int w = (int)std::floor(t / kWeekMin);
  if ((int)weekly_.size() <= w) weekly_.resize(w + 1);
  double mat = o.matCost * o.qty;
  if (!ord_[k].outsourced.empty()) mat *= inst_.outsourceMarkup;     // закупка полуфабриката дороже [К]
  weekly_[std::max(0, w - inst_.fin.leadWeeks)].orders += mat;
  weekly_[w].rawConsumed += mat;
}
void SimEnv::book_order_finish(int k, double t) {
  const OrderSpec& o = inst_.orders[k]; const int w = (int)std::floor(t / kWeekMin);
  if ((int)weekly_.size() <= w) weekly_.resize(w + 1);
  double val = o.price * o.qty * sc_.priceMul;
  const double lateW = std::max(0.0, t - due_[k]) / kWeekMin;
  const bool rush = k >= nBaseOrders_;
  if (rush && lateW > 0) val *= 1.0 - cfg_.rushLateLoss;      // A2: жёсткий срок срочного заказа сорван
  weekly_[w].revenue += val; weekly_[w].cogs += o.matCost * o.qty * (ord_[k].outsourced.empty() ? 1.0 : inst_.outsourceMarkup);
  if (lateW > 0 && !rush) {   // A3: договорный штраф (доля при любой просрочке + за неделю, потолок); иначе A2
    const double perW = inst_.latePerWeek >= 0 ? inst_.latePerWeek : cfg_.tardPenaltyPerWeek;
    const double cap = inst_.lateCap >= 0 ? inst_.lateCap : cfg_.tardPenaltyCap;
    weekly_[w].otherFixed += std::min(cap, inst_.lateFixed + perW * lateW) * val;
  }
}
cash::ScenarioResult SimEnv::run_cash(int weeks) const {
  cash::ScenarioInput in; in.periods.resize(weeks);
  for (int t = 0; t < weeks; ++t) {
    if (t < (int)weekly_.size()) in.periods[t] = weekly_[t];
    cash::PeriodInput& q = in.periods[t];
    q.payrollGross += inst_.payrollFixedWeekly; q.repairPlanned += inst_.repairBudgetWeekly; q.otherFixed += inst_.otherFixedWeekly;
    if (!sc_.keyRate.empty()) q.keyRate = sc_.keyRate[std::min(t, (int)sc_.keyRate.size() - 1)];
    if (t < (int)drawPlan_.size()) { q.drawdown = drawPlan_[t]; q.repayment = repayPlan_[t]; }
    if (t < (int)drawFloor_.size()) q.drawFloor = drawFloor_[t];   // A3: транши под CAPEX / буфер
  }
  in.defaultWeek = sc_.defaultWeek; in.lgd = sc_.lgd;
  return cash::run(inst_.fin, in);
}

void SimEnv::finish_episode() {
  done_ = true; level_ = -1;
  // Серийный режим (нет событий): завершения заказов по фактическим окончаниям операций.
  for (size_t k = 0; k < ord_.size(); ++k) {
    OrderState& os = ord_[k];
    if (os.finishMin >= 0) continue;
    double fin = -1; bool all = true;
    for (size_t j = 0; j < jobs_.size(); ++j) if (jobs_[j].orderIdx == (int)k) { if (!st_.done[j]) { all = false; break; } fin = std::max(fin, st_.out.end[j]); }
    if (all && fin >= 0) { os.finishMin = fin; book_order_finish((int)k, fin); }
  }
  // Фиксированный горизонт плана (§7.2): выручка заказов, завершённых после горизонта, в эпизод не
  // входит (иначе «позже = меньше налога в последнем неполном периоде» — артефакт). Горизонт
  // округляется вверх до границы налогового периода, чтобы последний период был начислен.
  const int taxP = std::max(1, inst_.fin.taxPeriodWeeks);
  const int TT = ((cfg_.horizonWeeks + taxP - 1) / taxP) * taxP;
  cashRes_ = run_cash(TT); cashValid_ = true;
  const double profit = cashRes_.profit, minCash = cashRes_.minCash;
  pendingReward_ += cfg_.wProfit * profit / scaleMoney_ + cfg_.wCash * std::min(0.0, minCash) / scaleMoney_
                  - cfg_.lambdaBreach * (cashRes_.breach ? 1.0 : 0.0) - 0.5 * cfg_.lambdaBreach * (cashRes_.covenantBreach ? 1.0 : 0.0);
}

/* ── A2: экстренные события (шоки) ───────────────────────────────────────── */
void SimEnv::resolve_shocks() {
  const Model& m = inst_.model;
  // Масштаб времени шоков: календарная нижняя оценка Cmax = max(цепочка, Σ работы типа / станков типа),
  // переведённая через общий календарь (цепочка одна мало что говорит о длительности плана).
  double lbw = lbCmax_;
  {
    std::unordered_map<std::string,double> load;
    for (auto& j : jobs_) if (!j.wcType.empty()) load[j.wcType] += j.durMean;
    for (auto& [t, w] : load) { auto it = m.machinesOf.find(t); if (it != m.machinesOf.end() && !it->second.empty()) lbw = std::max(lbw, w / it->second.size()); }
  }
  const double LB = std::max(1.0, inst_.cal.advance(0.0, lbw));
  const int KB = nBaseOrders_;
  // Отказ станка УЗКОГО МЕСТА: тип с наибольшей работой на станок (по базовому плану).
  if (sc_.outageAt >= 0 && sc_.outageDur > 0) {
    std::unordered_map<std::string,double> load;
    for (auto& j : jobs_) if (!j.wcType.empty()) load[j.wcType] += j.durMean;
    std::string bt; double bl = -1;
    for (auto& [t, w] : load) {
      auto it = m.machinesOf.find(t); if (it == m.machinesOf.end() || it->second.empty()) continue;
      const double per = w / it->second.size();
      if (per > bl || (per == bl && t < bt)) { bl = per; bt = t; }
    }
    if (!bt.empty()) { outageMi_ = machineIdx_.at(m.machinesOf.at(bt).front()); outA_ = sc_.outageAt * LB; outB_ = outA_ + sc_.outageDur * LB; }
  }
  // Срочный заказ: копия заказа-образца (часть объёма), прибывает по ходу, жёсткий срок.
  if (sc_.rushAt >= 0 && KB > 0) {
    const int k0 = ((sc_.rushOrder % KB) + KB) % KB;
    OrderSpec r = inst_.orders[k0];
    r.qty = std::max(1.0, std::round(r.qty * std::max(0.05, sc_.rushQty)));
    r.releaseMin = sc_.rushAt * LB; r.priority = 1; r.price *= cfg_.rushPriceMul;
    // Срок — после развёртки: прибытие + rushDue × критическая цепочка САМОГО срочного заказа (reset).
    inst_.orders.push_back(r); ord_.push_back(OrderState{}); due_.push_back(1e12);
    rushRelease_ = r.releaseMin;
  }
  // Срыв поставки КРИТИЧНОГО покупного входа (наибольшие потребность × срок): заказы с ним в BOM.
  double tSupply = -1;
  if (sc_.supplyDelay > 0) {
    std::function<void(const std::string&, double, std::unordered_map<std::string,double>&, int)> need =
      [&](const std::string& pid, double mult, std::unordered_map<std::string,double>& acc, int depth) {
        if (depth > 64) return;
        if (auto it = m.opsOf.find(pid); it != m.opsOf.end())
          for (auto& o : it->second) for (auto& [q, qty] : o.inputs) { acc[q] += mult * qty; need(q, mult * qty, acc, depth + 1); }
      };
    std::vector<std::unordered_map<std::string,double>> per(KB);
    std::unordered_map<std::string,double> tot;
    for (int k = 0; k < KB; ++k) { need(inst_.orders[k].productId, inst_.orders[k].qty, per[k], 0); for (auto& [q, v] : per[k]) tot[q] += v; }
    std::string crit; double cv = -1;
    for (auto& [q, v] : tot) { auto pit = m.prods.find(q); if (pit == m.prods.end() || !pit->second.purchased) continue;
      const double sc = v * std::max(1.0, pit->second.leadHours); if (sc > cv || (sc == cv && q < crit)) { cv = sc; crit = q; } }
    if (!crit.empty()) {
      for (int k = 0; k < KB; ++k) if (per[k].count(crit)) supplyShockOrders_.insert(k);
      supplyExtra_ = sc_.supplyDelay * LB;
      for (auto& j : jobs_) if (j.productId == "supply" && supplyShockOrders_.count(j.orderIdx)) {
        const double t = j.releaseMin + j.durMean; tSupply = tSupply < 0 ? t : std::min(tSupply, t); }
    }
  }
  supplyRevealT_ = tSupply;                 // A3: срыв поставки вскрывается, когда поставка «должна была» прийти
  // Момент шока = первое из событий (для метрик восстановления).
  for (double t : { outA_, rushRelease_, tSupply, sc_.regimeShockWeek >= 0 ? sc_.regimeShockWeek * kWeekMin : -1.0 })
    if (t >= 0) shockT_ = shockT_ < 0 ? t : std::min(shockT_, t);
}

void SimEnv::apply_outage(int j) {
  const double s = st_.out.start[j], e = st_.out.end[j];
  if (!(e > outA_ && s < outB_)) return;
  const double extra = outB_ - std::max(s, outA_);            // операция стоит на ремонте до outB_
  const double ne = e + extra;
  st_.out.end[j] = ne; finishAt_[j] = ne; st_.out.downJ[j] += extra;
  st_.out.breakdownMinutes += extra; ++st_.out.nBreakdowns;
  const std::string& mid = machineIds_[outageMi_];
  st_.mFree[mid] = ne; st_.out.busyByMachine[mid] += extra; st_.usage[mid] += extra;
  const int w = st_.out.worker[j];
  if (w >= 0 && w < (int)st_.wFree.size()) st_.wFree[w] = std::max(st_.wFree[w], ne);
  st_.out.makespan = std::max(st_.out.makespan, ne);
}

json SimEnv::shock_metrics() const {
  if (shockT_ < 0) return { {"has_shock", false} };
  const double W = std::max(60.0, cfg_.shockWindowMin), t0 = shockT_;
  std::vector<std::pair<double,double>> fin;                  // (окончание, работа) выполненных операций
  for (size_t j = 0; j < jobs_.size(); ++j)
    if (st_.done[j] && jobs_[j].productId != "supply" && jobs_[j].opId != "outsource") fin.push_back({ st_.out.end[j], jobs_[j].durMean });
  std::sort(fin.begin(), fin.end());
  auto work = [&](double a, double b) { double w = 0; for (auto& [t, d] : fin) { if (t >= b) break; if (t >= a) w += d; } return w; };
  const double preSpan = std::min(W, t0);
  const double pre = preSpan > 0 ? work(t0 - preSpan, t0) / preSpan : 0.0;
  double rec = 0; bool ok = true;
  if (pre > 0) {
    ok = false; const double step = 240.0, mk = st_.out.makespan;
    for (double t = t0 + step; t <= mk + step; t += step)
      if (work(std::max(0.0, t - W), t) / std::min(W, t) >= cfg_.recoverShare * pre) { rec = t - t0; ok = true; break; }
    if (!ok) rec = std::max(0.0, mk - t0);
  }
  return { {"has_shock", true}, {"shock_t_h", t0 / 60.0}, {"recovery_h", rec / 60.0}, {"recovered", ok},
           {"pre_rate", pre}, {"outage", outageMi_ >= 0}, {"rush", rushRelease_ >= 0}, {"supply", supplyExtra_ > 0},
           {"regime", sc_.regimeShockWeek >= 0} };
}

bool SimEnv::invest_allowed(int wi) const {
  return cfg_.investEnabled && inst_.investCapex > 0 && wi >= 0 && wi < (int)wctIds_.size();
}

/* ── Выходы ──────────────────────────────────────────────────────────────── */
json SimEnv::summary() const {
  int nLate = 0; const double tard = sched::order_tardiness(jobs_, st_.out, (int)ord_.size(), due_, nLate);
  json mv = json::array();
  for (auto& m : moves_) mv.push_back({ {"id", m.id}, {"kind", m.kind}, {"order_idx", m.orderIdx}, {"week", m.week}, {"before", m.before}, {"after", m.after}, {"masks_checked", m.masksChecked} });
  const int K = (int)ord_.size();
  double revenue = 0, taxPaid = 0; int nFin = 0;
  if (cashValid_) for (auto& ps : cashRes_.periods) { revenue += ps.revenue; taxPaid += ps.tax; }
  for (auto& o : ord_) if (o.finishMin >= 0) ++nFin;
  // A3: запас ликвидности min_t (C_t − просрочка + невыбранный лимит) — непрерывная мера кассового риска.
  double min_liq = 0; bool first = true;
  if (cashValid_) for (auto& ps : cashRes_.periods) { const double l = ps.netCash + ps.undrawn; min_liq = first ? l : std::min(min_liq, l); first = false; }
  return {
    {"scenario", sc_.idx}, {"seed", seed_}, {"n_jobs", (int)jobs_.size()}, {"n_orders", K},
    {"revenue", revenue}, {"tax", taxPaid}, {"n_orders_finished", nFin},
    {"makespan_h", st_.out.makespan / 60.0}, {"tardiness_h", tard / 60.0}, {"n_late", nLate},
    {"otd", K > 0 ? (double)(K - nLate) / K : 1.0},
    {"n_setups", st_.out.nSetups}, {"setup_h", st_.out.setupMinutes / 60.0},
    {"breakdown_h", st_.out.breakdownMinutes / 60.0}, {"maint_h", st_.out.maintMinutes / 60.0},
    {"n_decisions", nDecisions_}, {"n_wait", nWait_}, {"lb_cmax_h", lbCmax_ / 60.0},
    {"profit", cashValid_ ? cashRes_.profit : 0.0}, {"min_cash", cashValid_ ? cashRes_.minCash : 0.0},
    {"min_liquidity", min_liq}, {"npv_owner", cashValid_ ? cashRes_.npvOwner : 0.0},
    {"cash_residual", cashValid_ ? cashRes_.residuals.max() : 0.0},          // тождества водопада §4.6 (тест A3)
    {"end_cash", cashValid_ && !cashRes_.periods.empty() ? cashRes_.periods.back().netCash : 0.0},   // касса − просрочка платежей
    {"end_debt", cashValid_ && !cashRes_.periods.empty() ? cashRes_.periods.back().debt : 0.0},
    {"breach", cashValid_ && cashRes_.breach}, {"t_breach", cashValid_ ? cashRes_.tBreach : -1},
    {"covenant_breach", cashValid_ && cashRes_.covenantBreach}, {"interest", cashValid_ ? cashRes_.totalInterest : 0.0},
    {"max_debt", cashValid_ ? cashRes_.maxDebt : 0.0}, {"dscr", cashValid_ ? cashRes_.dscr : 0.0},
    {"moves", mv}, {"n_moves", (int)moves_.size()}, {"done", done_},
    {"shock", shock_metrics()},
    {"a3", { {"overtime_weeks", otWeeks_}, {"fee_overtime", feeOvertime_}, {"fee_outsource", feeOutsource_},
             {"capex", capexTotal_}, {"invest_week", investWeek_} }},
  };
}
json SimEnv::gantt() const {
  json g = json::array();
  for (size_t i = 0; i < jobs_.size(); ++i) {
    const Job& j = jobs_[i];
    g.push_back({ {"job_idx", (int)i}, {"order_idx", j.orderIdx}, {"product_id", j.productId}, {"op_id", j.opId}, {"op_name", j.opName},
                  {"machine_id", st_.out.machineId[i]}, {"worker", st_.out.worker[i]}, {"start", st_.out.start[i] / 60.0}, {"end", st_.out.end[i] / 60.0},
                  {"batch", j.batchIdx}, {"n_batches", j.nBatchesOf}, {"done", (bool)st_.done[i]}, {"due", j.dueMin / 60.0},
                  {"setup_h", st_.out.setupJ[i] / 60.0}, {"downtime_h", st_.out.downJ[i] / 60.0}, {"proc_h", dur_[i] / 60.0} });
  }
  return g;
}

json evaluate_rule(SimEnv& env, const std::string& rule, uint64_t seed, const Scenario& sc) {
  env.reset(seed, sc);
  int guard = 0;
  while (!env.done() && ++guard < 10'000'000) {
    if (env.level() == 2) env.step(0);
    else env.step_job(env.rule_choice(rule));
  }
  return env.summary();
}


json evaluate_key(SimEnv& env, const std::vector<double>& key, uint64_t seed, const Scenario& sc) {
  env.reset(seed, sc);
  int guard = 0;
  while (!env.done() && ++guard < 10'000'000) {
    if (env.level() == 2) env.step(0);
    else env.step_job(env.key_choice(key));
  }
  return env.summary();
}

json ga_improve(const SimEnv& env0, int generations, int nScen, uint64_t seed0, double timeBudgetSec,
                const std::vector<std::string>& seedRules) {
  const auto& jobs = env0.jobs(); const int K = (int)env0.instance().orders.size();
  std::vector<double> orderWork(K, 0); for (auto& j : jobs) orderWork[j.orderIdx] += j.durMean;
  const std::array<const char*, 5> kCrit = { "due", "rem", "duration", "inputs", "setup" };
  const int C = (int)kCrit.size();
  std::vector<std::vector<double>> norm(C);
  for (int c = 0; c < C; ++c) norm[c] = sched::priorities("CUSTOM", jobs, orderWork, { { kCrit[c], 1.0 } });
  auto decode = [&](const std::vector<double>& g) {
    std::vector<double> k2(jobs.size());
    for (size_t i = 0; i < jobs.size(); ++i) { double v = g[C + jobs[i].orderIdx]; for (int c = 0; c < C; ++c) v += g[c] * norm[c][i]; k2[i] = v; }
    return k2;
  };
  auto genome = [&](std::initializer_list<double> w) { std::vector<double> g(C + K, 0.0); std::copy(w.begin(), w.end(), g.begin()); return g; };
  auto ruleGenome = [&](const std::string& r) {
    if (r == "SPT") return genome({ 0, 0, 1 }); if (r == "LPT") return genome({ 0, 0, -1 });
    if (r == "MWKR") return genome({ 0, -1 }); if (r == "MS") return genome({ 1, -1 }); if (r == "CR") return genome({ 1, -0.5 });
    if (r == "FIFO") { std::vector<double> g(C + K, 0.0); for (int k = 0; k < K; ++k) g[C + k] = (k + 1.0) / std::max(1, K); return g; }
    return genome({ 1 });
  };
  std::vector<std::vector<double>> seeds; for (auto& r : seedRules) seeds.push_back(ruleGenome(r));
  if (seeds.empty()) seeds.push_back(ruleGenome("EDD"));
  // Пул копий среды — пригодность вызывается из нескольких потоков ГА.
  std::mutex mu; std::vector<SimEnv> pool;
  auto fitness = [&](const std::vector<double>& g) {
    SimEnv env = [&] { std::lock_guard<std::mutex> lk(mu); if (pool.empty()) return env0; SimEnv e = std::move(pool.back()); pool.pop_back(); return e; }();
    const std::vector<double> key = decode(g); double sum = 0;
    for (int s = 0; s < nScen; ++s) { const json r = evaluate_key(env, key, seed0 + s, Scenario{}); sum += r.at("makespan_h").get<double>() + 0.5 * r.at("tardiness_h").get<double>(); }
    { std::lock_guard<std::mutex> lk(mu); pool.push_back(std::move(env)); }
    return sum / std::max(1, nScen);
  };
  GaConfig gc; gc.generations = generations; gc.seed = (unsigned)(seed0 + 777); gc.sigma0 = 0.1; gc.mutationRate = 0.15; gc.swapBegin = C; gc.stallGens = 8; gc.timeBudgetSec = timeBudgetSec;
  const GaResult ga = run_key_ga(seeds, fitness, gc);
  json hist = json::array(); for (auto& h : ga.history) hist.push_back({ {"gen", h.gen}, {"best", h.best}, {"mean", h.mean} });
  return { {"best_key", decode(ga.bestKey)}, {"genome", ga.bestKey}, {"best_score", ga.bestScore}, {"seed_score", ga.seedScore},
           {"evaluations", ga.evaluations}, {"generations", (int)ga.history.size() - 1}, {"history", hist},
           {"stopped", ga.stoppedByTime ? "time" : ga.stoppedByStall ? "stall" : "generations"} };
}

/* ── Волна A2: план по ключу с пинами и ГА по операциям (стенд V4/«цена детерминизма») ─────────── */
namespace {
struct PlanCtx {
  const Model& m; const std::vector<Job>& jobs; const Calendar& cal;
  const std::unordered_map<std::string, Calendar>& calByM; std::vector<double> due; int K;
};
PlanCtx plan_ctx(const SimEnv& env) {
  const Instance& in = env.instance(); const int K = (int)in.orders.size();
  std::vector<double> due(K, 1e12);
  for (auto& j : env.jobs()) due[j.orderIdx] = std::min(due[j.orderIdx], j.dueMin);
  return { in.model, env.jobs(), in.cal, in.calByM, due, K };
}
sched::PinMap pins_of(const std::vector<double>& starts, const std::vector<std::string>& machines, size_t J) {
  sched::PinMap pins;
  for (size_t i = 0; i < J; ++i) {
    const double s = i < starts.size() ? starts[i] : -1.0;
    const std::string mc = i < machines.size() ? machines[i] : std::string();
    if (s >= 0 || !mc.empty()) pins[(int)i] = { std::max(0.0, s), mc };
  }
  return pins;
}
// (Cmax, Σ просрочки, опозданий) прогона по длительностям dur; rng = nullptr → без поломок.
std::tuple<double, double, int, sched::SimOut> run_plan(const PlanCtx& c, const std::vector<double>& key,
                                                       const std::vector<double>& dur, const sched::PinMap& pins, std::mt19937* rng) {
  sched::SimOut so = sched::simulate(c.m, c.jobs, key, dur, c.cal, c.calByM, pins, rng);
  int nl = 0; const double t = sched::order_tardiness(c.jobs, so, c.K, c.due, nl);
  return { so.makespan, t, nl, std::move(so) };
}
std::vector<double> mean_durs(const std::vector<Job>& jobs) {
  std::vector<double> d(jobs.size()); for (size_t i = 0; i < jobs.size(); ++i) d[i] = jobs[i].durMean; return d;
}
}  // namespace

json simulate_plan(SimEnv& env, const std::vector<double>& key, const std::vector<double>& starts,
                   const std::vector<std::string>& machines, uint64_t seed) {
  std::vector<double> dur;
  if (seed == 0) { env.reset(1); dur = mean_durs(env.jobs()); }
  else { env.reset(seed); dur = env.durations(); }
  const PlanCtx c = plan_ctx(env);
  if (key.size() != c.jobs.size()) throw std::invalid_argument("simulate_plan: длина ключа ≠ числу джоб");
  std::mt19937 brng((uint32_t)(seed * 7919u + 13u));
  auto [mk, td, nl, so] = run_plan(c, key, dur, pins_of(starts, machines, c.jobs.size()), seed == 0 ? nullptr : &brng);
  json st = json::array(); for (double x : so.start) st.push_back(x / 60.0);
  json mc = so.machineId;
  return { {"makespan_h", mk / 60.0}, {"tardiness_h", td / 60.0}, {"otd", c.K ? (double)(c.K - nl) / c.K : 1.0},
           {"starts_h", st}, {"machines", mc} };
}

json ga_improve_keys(SimEnv& env, const std::vector<std::vector<double>>& seeds, const std::vector<std::string>& machines,
                     int generations, int nScen, uint64_t seed0, double timeBudgetSec, unsigned gaSeed, int stallGens) {
  // Розыгрыши обучающих сценариев (CRN) — заранее; nScen = 0 → средние без поломок.
  std::vector<std::vector<double>> durs; std::vector<uint64_t> sseed;
  for (int s = 0; s < nScen; ++s) { env.reset(seed0 + s); durs.push_back(env.durations()); sseed.push_back(seed0 + s); }
  env.reset(1);
  if (nScen <= 0) { durs.push_back(mean_durs(env.jobs())); sseed.push_back(0); }
  const PlanCtx c = plan_ctx(env);
  const sched::PinMap pins = pins_of({}, machines, c.jobs.size());
  auto fitness = [&](const std::vector<double>& g) {
    double sum = 0;
    for (size_t s = 0; s < durs.size(); ++s) {
      std::mt19937 brng((uint32_t)(sseed[s] * 7919u + 13u));
      auto [mk, td, nl, so] = run_plan(c, g, durs[s], pins, sseed[s] == 0 ? nullptr : &brng);
      (void)nl; (void)so;
      sum += (mk + 0.5 * td) / 60.0;
    }
    return sum / (double)durs.size();
  };
  GaConfig gc; gc.generations = generations; gc.seed = gaSeed; gc.sigma0 = 0.05;
  gc.mutationRate = std::min(0.1, 20.0 / std::max<size_t>(1, c.jobs.size())); gc.swapBegin = 0; gc.stallGens = stallGens; gc.timeBudgetSec = timeBudgetSec;
  const GaResult ga = run_key_ga(seeds, fitness, gc);
  json hist = json::array(); for (auto& h : ga.history) hist.push_back({ {"gen", h.gen}, {"best", h.best}, {"mean", h.mean} });
  return { {"best_key", ga.bestKey}, {"best_score", ga.bestScore}, {"seed_score", ga.seedScore}, {"evaluations", ga.evaluations},
           {"generations", (int)ga.history.size() - 1}, {"history", hist}, {"improvements", ga.improvements},
           {"stopped", ga.stoppedByTime ? "time" : ga.stoppedByStall ? "stall" : "generations"} };
}

}  // namespace maos::env
