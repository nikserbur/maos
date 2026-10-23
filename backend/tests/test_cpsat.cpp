// Волна A2: правило «CP-SAT» (sidecar) — пины воспроизводят решение солвера, фолбэк при
// недоступном sidecar, режим ГА «ключи по операциям» (затравка CP-SAT) и детерминизм по seed.
#include "CpSatRule.h"
#include "Scheduler.h"
#include <gtest/gtest.h>
#include <algorithm>
#include <cstdlib>
#include <numeric>

namespace {

const char* kSchema = R"SQL(
CREATE TABLE work_center_types(id TEXT PRIMARY KEY, name TEXT, hour_rate REAL DEFAULT 0, mtbf_hours REAL DEFAULT 0, repair_hours REAL DEFAULT 0, mtbm_hours REAL DEFAULT 0, maintenance_hours REAL DEFAULT 0);
CREATE TABLE machines(id TEXT PRIMARY KEY, name TEXT, wc_type_id TEXT, schedule TEXT, status TEXT DEFAULT 'active');
CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, batch_size REAL DEFAULT 1, stock REAL DEFAULT 0, purchased INTEGER DEFAULT 0, lead_time_hours REAL DEFAULT 0, base_cost REAL DEFAULT 0, base_price REAL DEFAULT 0);
CREATE TABLE workers(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, skills TEXT, cost_per_hour REAL DEFAULT 0);
CREATE TABLE operation_wc_types(operation_id TEXT, wc_type_id TEXT);
CREATE TABLE operation_inputs(operation_id TEXT, product_id TEXT, qty REAL);
CREATE TABLE time_norms(operation_id TEXT, wc_type_id TEXT, t_opt REAL, t_norm REAL, t_pess REAL, setup_time REAL);
CREATE TABLE routings(id TEXT PRIMARY KEY, product_id TEXT, is_default INTEGER DEFAULT 1);
CREATE TABLE operations(id TEXT PRIMARY KEY, routing_id TEXT, name TEXT, t_opt REAL, t_norm REAL, t_pess REAL, setup_time REAL DEFAULT 0, risk_coef REAL DEFAULT 0, tail_weight REAL DEFAULT 0, tail_index REAL DEFAULT 2.5, order_no INTEGER DEFAULT 10, labor_rate REAL DEFAULT 0);
CREATE TABLE schedules(id TEXT PRIMARY KEY, is_default INTEGER);
CREATE TABLE shifts(schedule_id TEXT, day_of_week INTEGER, start_min INTEGER, end_min INTEGER);
CREATE TABLE stage1_feedback(product_id TEXT PRIMARY KEY, hours_per_unit REAL, naive_hours REAL, factor REAL, updated_at TEXT);
CREATE TABLE demand_orders(product_id TEXT, quantity REAL, due_hours REAL, status TEXT, priority INTEGER);
INSERT INTO work_center_types(id,name) VALUES('A','A');
INSERT INTO machines(id,name,wc_type_id) VALUES('a1','a1','A'),('a2','a2','A');
INSERT INTO products(id,name) VALUES('P','P'),('Q','Q');
INSERT INTO routings(id,product_id) VALUES('rP','P'),('rQ','Q');
INSERT INTO operations(id,routing_id,name,t_opt,t_norm,t_pess,order_no) VALUES
  ('p1','rP','p1',60,60,60,10),('p2','rP','p2',30,30,30,20),('q1','rQ','q1',45,45,45,10);
INSERT INTO operation_wc_types VALUES('p1','A'),('p2','A'),('q1','A');
)SQL";

// «Солвер»-подмена: все станочные джобы на a2 подряд в индексном (топологическом) порядке
// с умышленными зазорами 10 мин — правило так не поставит, значит план задают именно пины.
json fake_solver(const json& payload) {
  const auto& jobs = payload.at("jobs");
  std::vector<double> starts(jobs.size(), 0), ends(jobs.size(), 0);
  std::vector<std::string> machines(jobs.size(), "");
  double t = 0;
  for (size_t i = 0; i < jobs.size(); ++i) {
    double ready = 0;
    for (auto& q : jobs[i].at("preds")) ready = std::max(ready, ends[q.get<int>()]);
    starts[i] = std::max(t, ready) + 10;
    ends[i] = starts[i] + jobs[i].at("dur").get<double>();
    machines[i] = jobs[i].at("wc_types").empty() ? "" : "a2";
    t = ends[i];
  }
  return { {"status", "OPTIMAL"}, {"objective", t}, {"makespan", t}, {"bound", t}, {"time_s", 0.01},
           {"starts", starts}, {"machines", machines}, {"setup_mode", "circuit"} };
}

maos::ScheduleParams params(const std::string& rule) {
  maos::ScheduleParams p;
  p.program = { {"P", 1, 0}, {"Q", 1, 0} };
  p.samples = 60; p.improveIters = 0; p.useCalendar = false; p.rule = rule; p.seed = 7;
  return p;
}

struct OverrideGuard {
  explicit OverrideGuard(maos::cpsat::SolverFn f) { maos::cpsat::set_solver_override(std::move(f)); }
  ~OverrideGuard() { maos::cpsat::set_solver_override(nullptr); }
};

}  // namespace

TEST(CpSat, PinsReproduceSolverPlanAndPipelineRuns) {
  Database db(":memory:"); db.exec(kSchema);
  OverrideGuard g(fake_solver);
  const json r = maos::run_schedule(db, params("CP-SAT"));
  ASSERT_FALSE(r.value("error_soft", false)) << r.dump();
  EXPECT_EQ(r.at("rule"), "CP-SAT");
  // Ожидаемые старты — те же, что вернул «солвер» на ту же развёртку джобов.
  double t = 0;
  std::vector<std::pair<int,double>> expect;
  for (auto& gj : r.at("gantt")) {                         // job_idx в индексном порядке
    t += 10.0 / 60.0;
    expect.push_back({ gj.at("job_idx").get<int>(), t });
    t += gj.at("proc_hours").get<double>();
  }
  for (size_t i = 0; i < expect.size(); ++i) {
    const json& gj = r.at("gantt")[i];
    EXPECT_NEAR(gj.at("start").get<double>(), expect[i].second, 1e-9) << "job " << i;
    EXPECT_EQ(gj.at("machine_id"), "a2");
  }
  const json& cp = r.at("cpsat");
  EXPECT_EQ(cp.at("status"), "OPTIMAL");
  EXPECT_NEAR(cp.at("makespan_replay_h").get<double>(), cp.at("makespan_solver_h").get<double>(), 1e-9);
  bool found = false;
  for (auto& row : r.at("rules")) if (row.at("rule") == "CP-SAT") { found = true; EXPECT_TRUE(row.at("chosen").get<bool>()); }
  EXPECT_TRUE(found);
  EXPECT_EQ(r.at("rules").size(), 8u);                    // CP-SAT + 7 правил для сравнения
  EXPECT_GT(cp.at("gap_to_rule").get<double>(), 0.0);     // зазоры → хуже правила, честно показано
  EXPECT_GT(r.at("kpi").at("makespan_mean").get<double>(), 0.0);
}

TEST(CpSat, SidecarDownIsSoftErrorAndRulesUntouched) {
  setenv("MAOS_CPSAT_URL", "http://127.0.0.1:1", 1);
  Database db(":memory:"); db.exec(kSchema);
  const json r = maos::run_schedule(db, params("CP-SAT"));
  EXPECT_TRUE(r.value("error_soft", false));
  EXPECT_FALSE(r.at("warnings").empty());
  EXPECT_EQ(r.at("cpsat").at("status"), "UNAVAILABLE");
  const json e = maos::run_schedule(db, params("EDD"));
  EXPECT_FALSE(e.value("error_soft", false));
  EXPECT_TRUE(e.at("cpsat").is_null());
  unsetenv("MAOS_CPSAT_URL");
}

TEST(CpSat, OpKeySeedReproducesSolverOrderWhenUnperturbed) {
  // Модель вручную: 2 станка одного типа, 4 джобы с цепочкой 0→1.
  maos::sched::Model m;
  m.machinesOf["A"] = { "a1", "a2" };
  m.machineWct["a1"] = "A"; m.machineWct["a2"] = "A";
  std::vector<maos::sched::Job> jobs(4);
  const double d[4] = { 30, 20, 50, 40 };
  for (int i = 0; i < 4; ++i) {
    auto& j = jobs[i];
    j.orderIdx = i == 1 ? 0 : i; j.productId = "X"; j.opId = "o" + std::to_string(i); j.wcType = "A"; j.wcTypes = { "A" };
    j.durMean = d[i]; j.sigma = 0; j.riskCoef = 0; j.tailWeight = 0; j.tailIndex = 2.5; j.hourRate = 0; j.laborRate = 0; j.dueMin = 1e9;
  }
  jobs[1].preds = { 0 };
  // Решение «солвера»: a1: 2 [0,50) → 0 [50,80) → 1 [80,100); a2: 3 [0,40).
  maos::cpsat::Solution s; s.ok = true; s.status = "OPTIMAL";
  s.starts = { 50, 80, 0, 0 }; s.machines = { "a1", "a1", "a1", "a2" };
  const std::vector<double> key = maos::cpsat::opkey_from_starts(s.starts);
  const auto pins = maos::cpsat::machine_pins_from(s, {});
  std::vector<double> dur(d, d + 4);
  const auto out = maos::sched::simulate(m, jobs, key, dur, maos::sched::Calendar{}, {}, pins);
  for (int i = 0; i < 4; ++i) {
    EXPECT_NEAR(out.start[i], s.starts[i], 1e-9) << i;
    EXPECT_EQ(out.machineId[i], s.machines[i]) << i;
  }
  EXPECT_NEAR(out.makespan, 100.0, 1e-9);
  // Ранги: порядок ключа правила сохраняется, значения в [0, 1].
  const auto rk = maos::cpsat::opkey_from_key({ 5, 1, 5, 0 });
  EXPECT_LT(rk[3], rk[1]); EXPECT_LT(rk[1], rk[0]); EXPECT_LT(rk[0], rk[2]);
  EXPECT_DOUBLE_EQ(rk[3], 0.0); EXPECT_DOUBLE_EQ(rk[2], 1.0);
}

TEST(CpSat, WarmStartedGaIsDeterministicBySeedAndReportsModes) {
  Database db(":memory:"); db.exec(kSchema);
  OverrideGuard g(fake_solver);
  maos::ScheduleParams p = params("CP-SAT");
  p.improveIters = 4;
  const json a = maos::run_schedule(db, p), b = maos::run_schedule(db, p);
  ASSERT_FALSE(a.value("error_soft", false));
  const json& imp = a.at("improver");
  ASSERT_FALSE(imp.is_null());
  EXPECT_EQ(imp.at("seed_source"), "cpsat");
  EXPECT_EQ(imp.at("mode"), "both");
  EXPECT_TRUE(imp.at("modes").contains("structured"));
  EXPECT_TRUE(imp.at("modes").contains("op_keys"));
  EXPECT_EQ(a.at("improver").dump(), b.at("improver").dump());
  EXPECT_EQ(a.at("gantt").dump(), b.at("gantt").dump());
  EXPECT_EQ(a.at("cpsat").dump(), b.at("cpsat").dump());
  // Зазоры «солвера» убираются робастной очередностью: ГА принят, цена детерминизма > 0.
  EXPECT_TRUE(imp.at("adopted").get<bool>());
  const json& pod = a.at("cpsat").at("price_of_determinism");
  EXPECT_TRUE(pod.at("held_out").get<bool>());
  EXPECT_LT(pod.at("makespan_delta").at("delta_mean").get<double>(), 0.0);
  // Без CP-SAT режим ключей по операциям засевается правилами.
  maos::ScheduleParams q = params("EDD");
  q.improveIters = 4; q.gaMode = "both";
  const json c = maos::run_schedule(db, q);
  EXPECT_EQ(c.at("improver").at("seed_source"), "rules");
  EXPECT_TRUE(c.at("cpsat").is_null());
}
