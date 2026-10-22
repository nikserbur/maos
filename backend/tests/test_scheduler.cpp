// Стадия 1 (Scheduler) — регрессионные тесты на маленьких, проверяемых вручную
// экземплярах: B1, B2, B3, B4, B5, B9, B10 + санитарный Cmax = Σp.
// БД — SQLite в памяти с минимальной схемой (только столбцы, которые читает планировщик).
#include "Scheduler.h"
#include <gtest/gtest.h>
#include <algorithm>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace {

const char* kSchema = R"SQL(
CREATE TABLE work_center_types(id TEXT PRIMARY KEY, name TEXT, hour_rate REAL DEFAULT 0,
  mtbf_hours REAL DEFAULT 0, repair_hours REAL DEFAULT 0, mtbm_hours REAL DEFAULT 0,
  maintenance_hours REAL DEFAULT 0);
CREATE TABLE machines(id TEXT PRIMARY KEY, name TEXT, wc_type_id TEXT, schedule TEXT,
  status TEXT DEFAULT 'active');
CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, batch_size REAL DEFAULT 1,
  stock REAL DEFAULT 0, purchased INTEGER DEFAULT 0, lead_time_hours REAL DEFAULT 0);
CREATE TABLE workers(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, skills TEXT,
  cost_per_hour REAL DEFAULT 0);
CREATE TABLE operation_wc_types(operation_id TEXT, wc_type_id TEXT);
CREATE TABLE operation_inputs(operation_id TEXT, product_id TEXT, qty REAL);
CREATE TABLE time_norms(operation_id TEXT, wc_type_id TEXT, t_opt REAL, t_norm REAL,
  t_pess REAL, setup_time REAL);
CREATE TABLE routings(id TEXT PRIMARY KEY, product_id TEXT, is_default INTEGER DEFAULT 1);
CREATE TABLE operations(id TEXT PRIMARY KEY, routing_id TEXT, name TEXT, t_opt REAL,
  t_norm REAL, t_pess REAL, setup_time REAL DEFAULT 0, risk_coef REAL DEFAULT 0,
  tail_weight REAL DEFAULT 0, tail_index REAL DEFAULT 2.5, order_no INTEGER DEFAULT 10,
  labor_rate REAL DEFAULT 0);
CREATE TABLE schedules(id TEXT PRIMARY KEY, is_default INTEGER);
CREATE TABLE shifts(schedule_id TEXT, day_of_week INTEGER, start_min INTEGER, end_min INTEGER);
CREATE TABLE stage1_feedback(product_id TEXT PRIMARY KEY, hours_per_unit REAL,
  naive_hours REAL, factor REAL, updated_at TEXT);
CREATE TABLE demand_orders(product_id TEXT, quantity REAL, due_hours REAL, status TEXT,
  priority INTEGER);
)SQL";

std::string d2s(double v) { return std::to_string(v); }

struct Fixture {
  Database db{ ":memory:" };
  Fixture() { db.exec(kSchema); }

  void wct(const std::string& id, double mtbmH = 0, double maintH = 0) {
    db.exec("INSERT INTO work_center_types(id,name,mtbm_hours,maintenance_hours) VALUES(?,?,?,?)",
            { id, id, d2s(mtbmH), d2s(maintH) });
  }
  void machine(const std::string& id, const std::string& wct, const std::string& schedule = "") {
    db.exec("INSERT INTO machines(id,name,wc_type_id,schedule) VALUES(?,?,?,NULLIF(?,''))",
            { id, id, wct, schedule });
  }
  void product(const std::string& id, double batch = 1, bool purchased = false,
               double stock = 0, double leadH = 0) {
    db.exec("INSERT INTO products(id,name,batch_size,stock,purchased,lead_time_hours) VALUES(?,?,?,?,?,?)",
            { id, id, d2s(batch), d2s(stock), purchased ? "1" : "0", d2s(leadH) });
  }
  void worker(const std::string& id) {
    db.exec("INSERT INTO workers(id,first_name,last_name,skills) VALUES(?,?,?,'')", { id, id, id });
  }
  // Операция маршрута изделия: t — минуты на партию; spread — полуширина PERT (t±spread).
  void op(const std::string& product, const std::string& opId, int orderNo, const std::string& wct,
          double tMin, double setupMin = 0,
          const std::vector<std::pair<std::string,double>>& inputs = {}, double spread = 0) {
    db.exec("INSERT OR IGNORE INTO routings(id,product_id) VALUES(?,?)", { "r-" + product, product });
    db.exec("INSERT INTO operations(id,routing_id,name,t_opt,t_norm,t_pess,setup_time,order_no) "
            "VALUES(?,?,?,?,?,?,?,?)",
            { opId, "r-" + product, opId, d2s(tMin - spread), d2s(tMin), d2s(tMin + spread),
              d2s(setupMin), std::to_string(orderNo) });
    db.exec("INSERT INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,?)", { opId, wct });
    for (auto& [pid, q] : inputs)
      db.exec("INSERT INTO operation_inputs(operation_id,product_id,qty) VALUES(?,?,?)", { opId, pid, d2s(q) });
  }
  // Общий календарь: пн–пт 08:00–16:00.
  void calendar8x5() {
    db.exec("INSERT INTO schedules(id,is_default) VALUES('s1',1)");
    for (int d = 1; d <= 5; ++d)
      db.exec("INSERT INTO shifts(schedule_id,day_of_week,start_min,end_min) VALUES('s1',?,480,960)",
              { std::to_string(d) });
  }
};

maos::ScheduleParams params(std::vector<maos::OrderLine> program, const std::string& rule = "FIFO") {
  maos::ScheduleParams p;
  p.program = std::move(program);
  p.rule = rule;
  p.samples = 60;
  p.tailWeight = 0;          // без тяжёлого хвоста
  p.useCalendar = false;     // 24×7, если тест не говорит иного
  p.improveIters = 0;
  p.seed = 42;
  return p;
}

// Джобы Ганта изделия в порядке создания (job_idx).
std::vector<json> jobsOf(const json& r, const std::string& product) {
  std::vector<json> v;
  for (auto& g : r.at("gantt")) if (g.at("product_id") == product) v.push_back(g);
  std::sort(v.begin(), v.end(), [](const json& a, const json& b) { return a.at("job_idx") < b.at("job_idx"); });
  return v;
}

const json& machineLoad(const json& r, const std::string& mid) {
  for (auto& e : r.at("machine_load")) if (e.at("machine_id") == mid) return e;
  throw std::runtime_error("machine not found: " + mid);
}

constexpr double kEps = 1e-6;

}  // namespace

// Санитарный случай (ГОСТ Р 57700.37 V&V): один станок, без наладок и календаря ⇒ Cmax = Σp.
TEST(Scheduler, SingleMachineMakespanEqualsSumOfProcessingTimes) {
  Fixture f;
  f.wct("A"); f.machine("m1", "A");
  f.product("p1"); f.product("p2"); f.product("p3");
  f.op("p1", "o1", 10, "A", 60); f.op("p2", "o2", 10, "A", 120); f.op("p3", "o3", 10, "A", 180);
  const json r = maos::run_schedule(f.db, params({ {"p1", 1, 0}, {"p2", 1, 0}, {"p3", 1, 0} }));
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 6.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("utilization").get<double>(), 1.0, kEps);
}

// B1: потребитель с бо́льшей партией ждёт ПОСЛЕДНЮЮ нужную входную партию.
TEST(Scheduler, B1_LotStreamingConsumerWaitsForLastNeededInputSublot) {
  Fixture f;
  f.wct("A"); f.wct("B"); f.machine("ma", "A"); f.machine("mb", "B");
  f.product("S", 1);                 // полуфабрикат: партия 1 → 8 transfer-партий по 1 ч
  f.product("P", 4);                 // изделие: партия 4 → 2 transfer-партии по 1 ч
  f.op("S", "os", 10, "A", 60);
  f.op("P", "op", 10, "B", 60, 0, { {"S", 1} });
  const json r = maos::run_schedule(f.db, params({ {"P", 8, 0} }));
  const auto s = jobsOf(r, "S"), p = jobsOf(r, "P");
  ASSERT_EQ(s.size(), 8u);
  ASSERT_EQ(p.size(), 2u);
  // Партия P#0 = 4 шт. ⇒ нужны S#0..S#3 (готова к 4 ч); P#1 ⇒ S#7 (8 ч).
  EXPECT_GE(p[0].at("start").get<double>() + kEps, s[3].at("end").get<double>());
  EXPECT_GE(p[1].at("start").get<double>() + kEps, s[7].at("end").get<double>());
  EXPECT_NEAR(p[0].at("start").get<double>(), 4.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 9.0, kEps);   // было 8 ч (P стартовал раньше входа)
}

// B2: полуфабрикат, потребляемый в заказе дважды, раскрывается на ОБА объёма.
TEST(Scheduler, B2_SemiConsumedTwiceInOneOrderIsExpandedForBothQuantities) {
  Fixture f;
  f.wct("A"); f.wct("B"); f.machine("ma", "A"); f.machine("mb", "B");
  f.product("S", 1); f.product("P", 1);
  f.op("S", "os", 10, "A", 60);
  f.op("P", "op1", 10, "B", 30, 0, { {"S", 1} });   // 1 × S
  f.op("P", "op2", 20, "B", 30, 0, { {"S", 2} });   // ещё 2 × S
  const json r = maos::run_schedule(f.db, params({ {"P", 1, 0} }));
  double sSpan = 0;                                   // без наладок/календаря: длина = обработка
  for (auto& g : jobsOf(r, "S")) sSpan += g.at("end").get<double>() - g.at("start").get<double>();
  EXPECT_NEAR(sSpan, 3.0, kEps);                      // 1 + 2 единицы по 1 ч (было 1 ч)
  double sProc = 0;
  for (auto& g : jobsOf(r, "S")) sProc += g.at("proc_hours").get<double>();
  EXPECT_NEAR(sProc, 3.0, kEps);
}

// B3: «поставка» (lead time поставщика) не занимает рабочего.
TEST(Scheduler, B3_SupplyPseudoJobDoesNotReserveWorker) {
  Fixture f;
  f.wct("A"); f.wct("B"); f.machine("ma", "A"); f.machine("mb", "B");
  f.worker("w1");
  f.product("R", 1, /*purchased*/ true, /*stock*/ 0, /*lead*/ 10);
  f.product("P"); f.product("Q");
  f.op("P", "op", 10, "A", 60, 0, { {"R", 1} });
  f.op("Q", "oq", 10, "B", 60);
  const json r = maos::run_schedule(f.db, params({ {"P", 1, 0}, {"Q", 1, 0} }));
  int nSupply = 0;
  for (auto& g : r.at("gantt"))
    if (g.at("product_id") == "supply") { ++nSupply; EXPECT_EQ(g.at("worker").get<int>(), -1); }
  EXPECT_EQ(nSupply, 2);
  // Поставки параллельно [0,10]; затем единственный рабочий: P [10,11], Q [11,12].
  // С ошибкой рабочий «стоял» на поставках по 10 ч подряд → 22 ч.
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 12.0, kEps);
  ASSERT_EQ(r.at("worker_plan").size(), 1u);
  EXPECT_NEAR(r.at("worker_plan")[0].at("busy_hours").get<double>(), 2.0, kEps);
}

// B4: станок '24x7' работает круглосуточно, а не по общему сменному календарю.
TEST(Scheduler, B4_RoundTheClockMachineIgnoresShiftCalendar) {
  Fixture f;
  f.calendar8x5();
  f.wct("A"); f.machine("m24", "A", "24x7");
  f.product("P"); f.op("P", "op", 10, "A", 1440);    // 24 ч работы
  auto p = params({ {"P", 1, 0} }); p.useCalendar = true;
  const json r = maos::run_schedule(f.db, p);
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 24.0, kEps);
  const json& ml = machineLoad(r, "m24");
  EXPECT_NEAR(ml.at("fund_hours").get<double>(), 24.0, kEps);   // фонд по ЕГО календарю
  EXPECT_NEAR(ml.at("utilization").get<double>(), 1.0, kEps);
}

TEST(Scheduler, B4_MachineWithoutScheduleFollowsShiftCalendar) {
  Fixture f;
  f.calendar8x5();
  f.wct("A"); f.machine("m", "A");
  f.product("P"); f.op("P", "op", 10, "A", 1440);
  auto p = params({ {"P", 1, 0} }); p.useCalendar = true;
  const json r = maos::run_schedule(f.db, p);
  // Пн 08:00 → 3 смены по 8 ч → Ср 16:00 = 64 ч от Пн 00:00.
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 64.0, kEps);
  EXPECT_NEAR(machineLoad(r, "m").at("utilization").get<double>(), 1.0, kEps);  // 24 ч / фонд 24 ч
}

// B5: риск-KPI Монте-Карло относятся к ИТОГОВОМУ (после локального поиска) ключу.
// Двухстаночный flow shop (Джонсон): EDD ставит «длинный A» первым (21 ч), а
// локальный поиск находит порядок на 12 ч. Шум длительностей ничтожен (t ± 0.1 мин),
// поэтому E[Cmax] итогового плана должно совпасть с его детерминированным Cmax.
TEST(Scheduler, B5_MonteCarloKpisComeFromFinalImprovedSchedule) {
  Fixture f;
  f.wct("A"); f.wct("B"); f.wct("C");
  f.machine("ma", "A"); f.machine("mb", "B"); f.machine("mc", "C");
  f.product("X"); f.product("Y"); f.product("Z");
  f.op("X", "x1", 10, "A", 600, 0, {}, 0.1); f.op("X", "x2", 20, "B", 60, 0, {}, 0.1);
  f.op("Y", "y1", 10, "A", 60, 0, {}, 0.1);  f.op("Y", "y2", 20, "B", 600, 0, {}, 0.1);
  f.op("Z", "z1", 10, "C", 6, 0, {}, 0.1);
  auto p = params({ {"X", 1, 100.0}, {"Y", 1, 100.1}, {"Z", 1, 1000.0} }, "EDD");
  p.improveIters = 30;
  const json r = maos::run_schedule(f.db, p);
  ASSERT_TRUE(r.at("improver").is_object());
  ASSERT_GT(r.at("improver").at("accepted").get<int>(), 0) << "instance must exercise the local search";
  const double det = r.at("kpi").at("makespan").get<double>();
  EXPECT_NEAR(det, 12.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("makespan_mean").get<double>(), det, 0.05);    // было ≈21 ч (правило до поиска)
  EXPECT_LE(r.at("kpi").at("makespan_cvar").get<double>(), det + 0.05);
  EXPECT_LE(r.at("kpi").at("makespan_worst").get<double>(), det + 0.05);
  EXPECT_NEAR(r.at("improver").at("makespan_mean_rule").get<double>(), 21.0, 0.05);
  EXPECT_NEAR(r.at("improver").at("makespan_mean_final").get<double>(), det, 0.05);
}

// ГА Стадии 1: улучшение принимается только при выигрыше на ОТЛОЖЕННЫХ сценариях;
// отчёт содержит проверку вне выборки и кривую сходимости (рекорд не ухудшается).
TEST(Scheduler, GA_AdoptsOnlyWithOutOfSampleGainAndReportsConvergence) {
  Fixture f;
  f.wct("A"); f.wct("B"); f.wct("C");
  f.machine("ma", "A"); f.machine("mb", "B"); f.machine("mc", "C");
  f.product("X"); f.product("Y"); f.product("Z");
  f.op("X", "x1", 10, "A", 600, 0, {}, 0.1); f.op("X", "x2", 20, "B", 60, 0, {}, 0.1);
  f.op("Y", "y1", 10, "A", 60, 0, {}, 0.1);  f.op("Y", "y2", 20, "B", 600, 0, {}, 0.1);
  f.op("Z", "z1", 10, "C", 6, 0, {}, 0.1);
  auto p = params({ {"X", 1, 100.0}, {"Y", 1, 100.1}, {"Z", 1, 1000.0} }, "auto");
  p.improveIters = 20;
  const json r = maos::run_schedule(f.db, p);
  const json& imp = r.at("improver");
  ASSERT_TRUE(imp.is_object());
  EXPECT_EQ(imp.at("method"), "ga");
  EXPECT_EQ(imp.at("seeds").get<int>(), 7);                  // все 7 правил — затравки
  EXPECT_EQ(imp.at("train_scenarios").get<int>(), 30);
  const json& val = imp.at("validation");
  EXPECT_EQ(val.at("scenarios").get<int>(), 30);              // N=60: 30 обучение + 30 проверка
  if (imp.at("adopted").get<bool>()) {
    EXPECT_LT(val.at("score_ga").get<double>(), val.at("score_rule").get<double>());
    EXPECT_LT(imp.at("score_after").get<double>(), imp.at("score_before").get<double>());
  } else {
    EXPECT_EQ(imp.at("accepted").get<int>(), 0);
    EXPECT_DOUBLE_EQ(imp.at("improvement_pct").get<double>(), 0.0);
  }
  const json& h = imp.at("history");
  ASSERT_GE(h.size(), 2u);
  for (size_t g = 1; g < h.size(); ++g)
    EXPECT_LE(h[g].at("best").get<double>(), h[g - 1].at("best").get<double>());
  EXPECT_LE(r.at("kpi").at("makespan").get<double>(), 12.0 + kEps);   // лучший порядок найден
}

// B9: загрузка = обработка / календарный фонд; наладка — отдельно (setup_share).
TEST(Scheduler, B9_SetupIsNotProductiveTimeAndHasOwnShare) {
  Fixture f;
  f.wct("A"); f.machine("m", "A");
  f.product("P1"); f.product("P2");
  f.op("P1", "o1", 10, "A", 60, 30); f.op("P2", "o2", 10, "A", 60, 30);
  const json r = maos::run_schedule(f.db, params({ {"P1", 1, 0}, {"P2", 1, 0} }));
  // [наладка 0.5 + обработка 1] × 2 = 3 ч.
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 3.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("utilization").get<double>(), 2.0 / 3.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("setup_share").get<double>(), 1.0 / 3.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("availability").get<double>(), 1.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("machine_fund_hours").get<double>(), 3.0, kEps);
  const json& ml = machineLoad(r, "m");
  EXPECT_NEAR(ml.at("busy_hours").get<double>(), 2.0, kEps);
  EXPECT_NEAR(ml.at("setup_hours").get<double>(), 1.0, kEps);
  EXPECT_NEAR(ml.at("idle_hours").get<double>(), 0.0, kEps);
}

// B9: плановое ТО — простой, а не занятость; готовность = 1 − простой / фонд.
TEST(Scheduler, B9_MaintenanceDowntimeIsNotCountedAsBusy) {
  Fixture f;
  f.wct("A", /*mtbm*/ 1, /*maint*/ 1); f.machine("m", "A");
  f.product("P"); f.op("P", "o", 10, "A", 120);
  const json r = maos::run_schedule(f.db, params({ {"P", 1, 0} }));
  // Обработка 2 ч пересекает границу наработки 1 ч → ТО 1 ч ⇒ Cmax = 3 ч.
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 3.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("maintenance_hours").get<double>(), 1.0, kEps);
  EXPECT_NEAR(r.at("kpi").at("utilization").get<double>(), 2.0 / 3.0, kEps);   // было 1.0
  EXPECT_NEAR(r.at("kpi").at("availability").get<double>(), 2.0 / 3.0, kEps);
  const json& ml = machineLoad(r, "m");
  EXPECT_NEAR(ml.at("busy_hours").get<double>(), 2.0, kEps);
  EXPECT_NEAR(ml.at("downtime_hours").get<double>(), 1.0, kEps);
}

// B9: загрузка рабочего — к ЕГО календарному фонду, а не к календарной длине плана.
TEST(Scheduler, B9_WorkerUtilizationAgainstCalendarFund) {
  Fixture f;
  f.calendar8x5();
  f.wct("A"); f.machine("m", "A"); f.worker("w1");
  f.product("P"); f.op("P", "o", 10, "A", 960);      // 16 ч работы = 2 смены
  auto p = params({ {"P", 1, 0} }); p.useCalendar = true;
  const json r = maos::run_schedule(f.db, p);
  EXPECT_NEAR(r.at("kpi").at("makespan").get<double>(), 40.0, kEps);  // Пн 08:00 → Вт 16:00
  ASSERT_EQ(r.at("worker_plan").size(), 1u);
  const json& w = r.at("worker_plan")[0];
  EXPECT_NEAR(w.at("busy_hours").get<double>(), 16.0, kEps);
  EXPECT_NEAR(w.at("utilization").get<double>(), 1.0, kEps);        // было 16/40 = 0.4
  EXPECT_NEAR(w.at("fund_hours").get<double>(), 16.0, kEps);
}

// B10: закон Литтла L = λ·W на сгенерированном плане; L считается независимо — по
// развёртке числа заказов в системе N(t) по Ганту.
TEST(Scheduler, B10_LittlesLawHoldsOnGeneratedPlan) {
  Fixture f;
  f.wct("A"); f.wct("B"); f.machine("ma", "A"); f.machine("mb", "B");
  f.product("X"); f.product("Y");
  f.op("X", "x1", 10, "A", 60); f.op("X", "x2", 20, "B", 30);
  f.op("Y", "y1", 10, "B", 90); f.op("Y", "y2", 20, "A", 45);
  const json r = maos::run_schedule(f.db, params(
    { {"X", 2, 0}, {"Y", 1, 0}, {"X", 3, 0}, {"Y", 2, 0}, {"X", 1, 0} }));
  const json& k = r.at("kpi");
  std::map<int, std::pair<double,double>> iv;     // заказ → (запуск, выпуск), ч
  for (auto& g : r.at("gantt")) {
    const int o = g.at("order_idx").get<int>();
    auto it = iv.find(o);
    const double s = g.at("start").get<double>(), e = g.at("end").get<double>();
    if (it == iv.end()) iv[o] = { s, e };
    else { it->second.first = std::min(it->second.first, s); it->second.second = std::max(it->second.second, e); }
  }
  ASSERT_EQ(iv.size(), 5u);
  const double T = k.at("makespan").get<double>();
  std::vector<std::pair<double,double>> v;
  double flowSum = 0;
  for (auto& [o, se] : iv) { v.push_back(se); flowSum += se.second - se.first; }
  double area = 0;                                 // ∫ N(t) dt — разверткой событий
  {
    std::vector<std::pair<double,int>> ev;
    for (auto& [s, e] : v) { ev.push_back({ s, +1 }); ev.push_back({ e, -1 }); }
    std::sort(ev.begin(), ev.end());
    double prev = 0; int n = 0;
    for (auto& [t, d] : ev) { area += n * (t - prev); prev = t; n += d; }
  }
  const double L = area / T;
  const double lambdaPerH = k.at("orders_per_day").get<double>() / 24.0;
  const double W = k.at("flow_time_mean_h").get<double>();
  EXPECT_NEAR(L, lambdaPerH * W, 1e-9);                 // L = λ·W
  EXPECT_NEAR(k.at("wip_avg").get<double>(), L, 1e-9);     // wip_avg — заказов в системе
  EXPECT_NEAR(W, flowSum / 5.0, 1e-9);
  // Темп выпуска — ЕДИНИЦ продукции в сутки: Σqty = 9 шт.
  EXPECT_NEAR(k.at("throughput_per_day").get<double>(), 9.0 / (T / 24.0), 1e-9);
  EXPECT_NEAR(k.at("orders_per_day").get<double>(), 5.0 / (T / 24.0), 1e-9);
}
