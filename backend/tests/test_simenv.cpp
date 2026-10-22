// Волна A (METHODOLOGY-V2 §11.5): событийная среда SimEnv — эквивалентность с simulate()
// при фиксированном правиле (серийный режим), маски запрещают недопустимые ходы,
// материальный баланс/предшествование по построению, детерминизм по seed, CRN по
// идентичности джобы (структурный ход одного заказа не меняет розыгрыши других).
#include "SimEnv.h"
#include "Scheduler.h"
#include <gtest/gtest.h>
#include <cmath>
#include <set>
#include <string>
#include <vector>

namespace {

using maos::env::EnvConfig;
using maos::env::EpochMode;
using maos::env::Instance;
using maos::env::Scenario;
using maos::env::SimEnv;
using nlohmann::json;

// Маленький завод: 2 типа × 2 станка, 3 изделия с полуфабрикатом, 1 рабочий-универсал.
json small_instance(bool altRouting = false, double outsourceLeadH = 0) {
  json ops_s = json::array({ { {"id","os"}, {"name","os"}, {"wc_types", json::array({"A"})}, {"t_exp",60}, {"sigma",6}, {"inputs", json::array()} } });
  json ops_p = json::array({
    { {"id","op1"}, {"name","op1"}, {"wc_types", json::array({"A","B"})}, {"t_exp",90}, {"sigma",9}, {"setup",15}, {"inputs", json::array({ json::array({"S", 1.0}) })} },
    { {"id","op2"}, {"name","op2"}, {"wc_types", json::array({"B"})}, {"t_exp",45}, {"sigma",4}, {"inputs", json::array()} },
  });
  json alts = json::array();
  if (altRouting) alts.push_back({ {"id","r-alt"}, {"ops", json::array({ { {"id","op1a"}, {"name","op1a"}, {"wc_types", json::array({"B"})}, {"t_exp",70}, {"sigma",7}, {"inputs", json::array({ json::array({"S", 1.0}) })} } })} });
  return {
    {"name", "small"},
    {"wc_types", json::array({ { {"id","A"}, {"name","A"} }, { {"id","B"}, {"name","B"} } })},
    {"machines", json::array({ { {"id","a1"}, {"wct","A"} }, { {"id","a2"}, {"wct","A"} }, { {"id","b1"}, {"wct","B"} }, { {"id","b2"}, {"wct","B"} } })},
    {"products", json::array({
      { {"id","S"}, {"batch_size",1}, {"ops", ops_s} },
      { {"id","P"}, {"batch_size",2}, {"ops", ops_p}, {"alt_routings", alts} },
      { {"id","R"}, {"batch_size",1}, {"purchased", true}, {"stock", 0}, {"lead_hours", 4} },
    })},
    {"workers", json::array({ { {"id","w1"}, {"name","w1"}, {"skills", json::array()} } })},
    {"orders", json::array({
      { {"product_id","P"}, {"qty",4}, {"due_h",40}, {"price",1000}, {"mat_cost",100} },
      { {"product_id","P"}, {"qty",2}, {"due_h",60}, {"price",500}, {"mat_cost",100} },
      { {"product_id","S"}, {"qty",3}, {"due_h",30}, {"price",200}, {"mat_cost",10} },
    })},
    {"outsource", { {"lead_h", outsourceLeadH}, {"markup", 1.3}, {"prepay", 0.5} }},
    {"fin", { {"c0", 1000}, {"credit_limit", 5000} }},
    {"tail_weight", 0.0},
  };
}

EnvConfig cfg(EpochMode mode, bool l2 = false) {
  EnvConfig c; c.mode = mode; c.l2Enabled = l2; c.breakdowns = false; return c;
}

// Прогон правила до конца эпизода.
json run_rule(SimEnv& env, const std::string& rule, uint64_t seed) {
  env.reset(seed);
  while (!env.done()) {
    if (env.level() == 2) env.step(0); else env.step_job(env.rule_choice(rule));
  }
  return env.summary();
}

}  // namespace

// Серийный режим + ключ правила ⇒ тот же Cmax, что simulate() в run_schedule (без ГА, детерминированно).
TEST(SimEnv, SerialReplayMatchesRunScheduleMakespan) {
  Database db(":memory:");
  db.exec(R"SQL(
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
    INSERT INTO work_center_types(id,name) VALUES('A','A'),('B','B');
    INSERT INTO machines(id,name,wc_type_id) VALUES('a1','a1','A'),('a2','a2','A'),('b1','b1','B');
    INSERT INTO products(id,name,batch_size) VALUES('S','S',1),('P','P',2),('Q','Q',1);
    INSERT INTO workers(id,first_name,last_name,skills) VALUES('w1','w','1',''),('w2','w','2','');
    INSERT INTO routings(id,product_id) VALUES('rS','S'),('rP','P'),('rQ','Q');
    INSERT INTO operations(id,routing_id,name,t_opt,t_norm,t_pess,setup_time,order_no) VALUES
      ('os','rS','os',50,60,70,0,10),('op1','rP','op1',80,90,100,15,10),('op2','rP','op2',40,45,50,0,20),('oq','rQ','oq',30,35,40,10,10);
    INSERT INTO operation_wc_types VALUES('os','A'),('op1','A'),('op1','B'),('op2','B'),('oq','B');
    INSERT INTO operation_inputs VALUES('op1','S',1);
  )SQL");
  std::vector<std::pair<std::string,double>> prog = { {"P", 4}, {"Q", 3}, {"S", 2} };
  std::vector<double> dueH = { 40, 20, 30 };
  for (const char* rule : { "EDD", "SPT", "MWKR", "FIFO", "LPT", "CR", "MS" }) {
    maos::ScheduleParams sp; sp.program = { {"P",4,40}, {"Q",3,20}, {"S",2,30} };
    sp.rule = rule; sp.samples = 60; sp.tailWeight = 0; sp.useCalendar = false; sp.improveIters = 0;
    const json ref = maos::run_schedule(db, sp);
    Instance inst = maos::env::instance_from_db(db, prog, dueH, false);
    inst.tailWeight = 0;
    EnvConfig c = cfg(EpochMode::Serial); c.deterministic = true;
    SimEnv env(inst, c);
    const json s = run_rule(env, rule, 1);
    EXPECT_NEAR(s.at("makespan_h").get<double>(), ref.at("kpi").at("makespan").get<double>(), 1e-6) << rule;
    EXPECT_NEAR(s.at("tardiness_h").get<double>(), ref.at("kpi").at("tardiness").get<double>(), 1e-6) << rule;
  }
}

// Маски L0: каждый слот — готовая джоба допустимого типа; действия вне маски отвергаются.
TEST(SimEnv, L0MaskValidityAndPrecedenceByConstruction) {
  Instance inst = maos::env::instance_from_json(small_instance());
  SimEnv env(inst, cfg(EpochMode::Event));
  env.reset(7);
  int epochs = 0;
  while (!env.done()) {
    ASSERT_EQ(env.level(), 0);
    const auto& mask = env.mask_l0();
    const auto& jobs = env.jobs();
    const auto& gantt = env.gantt();
    const std::string mid = (env.epoch_machine() >= 0) ? gantt[0].value("machine_id", "") : "";
    (void)mid;
    const std::string wct = inst.model.machineWct.at(std::vector<std::string>{"a1","a2","b1","b2"}[env.epoch_machine()]);
    int nValid = 0;
    for (int s = 0; s < env.config().kMaxCands; ++s) {
      if (!mask[s]) continue;
      ++nValid;
      const int j = env.candidates()[s];
      EXPECT_NE(std::find(jobs[j].wcTypes.begin(), jobs[j].wcTypes.end(), wct), jobs[j].wcTypes.end());
      for (int p : jobs[j].preds) EXPECT_TRUE(gantt[p].at("done").get<bool>()) << "предшественник не завершён";
      for (int p : jobs[j].preds) EXPECT_LE(gantt[p].at("end").get<double>() * 60.0, env.now() + 1e-6);
    }
    EXPECT_GE(nValid, 1);
    EXPECT_THROW(env.step(env.config().kMaxCands + 5), std::runtime_error);
    int firstFree = -1; for (int s = 0; s < env.config().kMaxCands + 1; ++s) if (!mask[s]) { firstFree = s; break; }
    if (firstFree >= 0) EXPECT_THROW(env.step(firstFree), std::runtime_error);
    env.step_job(env.rule_choice("EDD"));
    ++epochs;
  }
  EXPECT_GT(epochs, 0);
  // Все джобы размещены, порядок по предшествованию соблюдён (материальный баланс по построению).
  const auto g = env.gantt(); const auto& jobs = env.jobs();
  for (size_t j = 0; j < jobs.size(); ++j) {
    EXPECT_TRUE(g[j].at("done").get<bool>());
    for (int p : jobs[j].preds) EXPECT_GE(g[j].at("start").get<double>() + 1e-9, g[p].at("end").get<double>());
  }
}

// Детерминизм по seed: один сценарий, одна политика → побитово те же KPI; другой seed → другие длительности.
TEST(SimEnv, DeterministicBySeed) {
  Instance inst = maos::env::instance_from_json(small_instance());
  inst.tailWeight = 0.1;
  SimEnv a(inst, cfg(EpochMode::Event)), b(inst, cfg(EpochMode::Event));
  const json s1 = run_rule(a, "SPT", 123), s2 = run_rule(b, "SPT", 123), s3 = run_rule(b, "SPT", 124);
  EXPECT_EQ(s1.at("makespan_h").get<double>(), s2.at("makespan_h").get<double>());
  EXPECT_EQ(s1.at("profit").get<double>(), s2.at("profit").get<double>());
  EXPECT_NE(s1.at("makespan_h").get<double>(), s3.at("makespan_h").get<double>());
}

// Сохранение: Σ обработки по Ганту = Σ розыгрышей; число джоб не зависит от правила;
// структурный ход одного заказа не меняет розыгрыши других (CRN по идентичности).
TEST(SimEnv, ConservationAndCrnByIdentity) {
  Instance inst = maos::env::instance_from_json(small_instance(true, 48));
  EnvConfig c = cfg(EpochMode::Event, true);
  SimEnv env(inst, c);
  env.reset(5);
  ASSERT_EQ(env.level(), 2);
  // Розыгрыши заказа 2 до хода.
  std::vector<double> before;
  for (auto& g : env.gantt()) if (g.at("order_idx") == 2) before.push_back(g.at("proc_h").get<double>());
  const size_t nJobsBefore = env.jobs().size();
  // Ходы: слияние партий заказа 0 (N 2→1), затем обратное дробление (1→2) — заказ не начат.
  const int merge0 = 1 + 3 * c.kMaxOrders + 0, split0 = 1 + 2 * c.kMaxOrders + 0;
  ASSERT_TRUE(env.mask_l2()[merge0]);
  EXPECT_FALSE(env.mask_l2()[split0]);                // по умолчанию партии уже по batch_size
  env.step(merge0);
  EXPECT_EQ(env.moves().size(), 1u);
  EXPECT_LT(env.jobs().size(), nJobsBefore);
  ASSERT_TRUE(env.mask_l2()[split0]);
  env.step(split0);
  EXPECT_EQ(env.moves().size(), 2u);
  EXPECT_EQ(env.jobs().size(), nJobsBefore);
  std::vector<double> after;
  for (auto& g : env.gantt()) if (g.at("order_idx") == 2) after.push_back(g.at("proc_h").get<double>());
  EXPECT_EQ(before, after);
  // Ход «запуск раньше release» запрещён (shift−1 при shift=0), «сдвиг позже» для срочного заказа 2 — по сроку.
  EXPECT_FALSE(env.mask_l2()[1 + 1 * c.kMaxOrders + 0]);
  // Аутсорсинг полуфабриката заказа 1 — допустим (есть предложение [К]), затем доигрываем.
  const int out1 = 1 + 4 * c.kMaxOrders + 1;
  EXPECT_TRUE(env.mask_l2()[out1]);
  env.step(out1);
  EXPECT_EQ(env.moves().size(), 3u);
  env.step(0);
  while (!env.done()) { if (env.level() == 2) env.step(0); else env.step_job(env.rule_choice("EDD")); }
  const json s = env.summary();
  EXPECT_EQ(s.at("n_moves").get<int>(), 3);
  double proc = 0; for (auto& g : env.gantt()) if (g.at("machine_id") != "") proc += g.at("proc_h").get<double>();
  double busy = 0; for (auto& g : env.gantt()) if (g.at("machine_id") != "") busy += g.at("end").get<double>() - g.at("start").get<double>() - g.at("setup_h").get<double>() - g.at("downtime_h").get<double>();
  EXPECT_NEAR(proc, busy, 1e-6);                     // без календаря занятость = обработка
  EXPECT_TRUE(s.at("profit").get<double>() != 0.0);  // водопад посчитан
}

// Финансовая маска: транш не больше невыбранного лимита; без лимита — транш запрещён.
TEST(SimEnv, FinanceMaskRespectsCreditLimit) {
  json j = small_instance(); j["fin"]["credit_limit"] = 0;
  Instance inst = maos::env::instance_from_json(j);
  EnvConfig c = cfg(EpochMode::Event, true);
  SimEnv env(inst, c); env.reset(3);
  const int base = 1 + SimEnv::kMoveKinds * c.kMaxOrders;
  EXPECT_FALSE(env.mask_l2()[base]);
  j["fin"]["credit_limit"] = 5000;
  SimEnv env2(maos::env::instance_from_json(j), c); env2.reset(3);
  EXPECT_TRUE(env2.mask_l2()[base]);
  env2.step(base + 2);                                // 100 % лимита на неделе 0
  ASSERT_EQ(env2.moves().size(), 1u);
  EXPECT_NEAR(env2.moves()[0].after.at("drawdown").get<double>(), 5000, 1e-9);
}

// Экспорт/импорт экземпляра — круговой.
TEST(SimEnv, InstanceJsonRoundTrip) {
  Instance a = maos::env::instance_from_json(small_instance(true, 48));
  const json ja = maos::env::instance_to_json(a);
  Instance b = maos::env::instance_from_json(ja);
  EXPECT_EQ(a.orders.size(), b.orders.size());
  EXPECT_EQ(a.model.opsOf.at("P").size(), b.model.opsOf.at("P").size());
  EXPECT_EQ(a.altRoutings.at("P").size(), b.altRoutings.at("P").size());
  SimEnv ea(a, cfg(EpochMode::Event)), eb(b, cfg(EpochMode::Event));
  EXPECT_EQ(run_rule(ea, "EDD", 9).at("makespan_h"), run_rule(eb, "EDD", 9).at("makespan_h"));
}

// Книга заказов: все заказы завершены ⇒ выручка эпизода = Σ цена × объём (в горизонте), в обоих режимах.
TEST(SimEnv, AllOrdersFinishedRevenueEqualsPortfolioValue) {
  Instance inst = maos::env::instance_from_json(small_instance());
  double value = 0; for (auto& o : inst.orders) value += o.price * o.qty;
  for (EpochMode mode : { EpochMode::Event, EpochMode::Serial }) {
    SimEnv env(inst, cfg(mode));
    const json s = run_rule(env, "EDD", 3);
    EXPECT_EQ(s.at("n_orders_finished").get<int>(), (int)inst.orders.size());
    EXPECT_NEAR(s.at("revenue").get<double>(), value, 1e-6);
  }
}
