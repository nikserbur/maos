// Блок контрагентского риска (CPR) — гейт побитовости (T3 а, T5, T6): ответы денежного слоя Стадии 2,
// расписания Стадии 1 и эпизодов SimEnv/InvestEval при выключенном CPR совпадают с эталоном, снятым
// бинарём ДО изменений (tests/fixtures/cpr_golden/*.json). Канонический JSON: без ключей времени
// (solve_ms, total_ms, time_s) и без блоков "counterparty"; сравнение — полное равенство строк
// (сильнее совпадения sha256). Перезапись эталона — только явно: MAOS_WRITE_GOLDEN=1.
#include "InvestEval.h"
#include "MacroSampler.h"
#include "Optimizer.h"
#include "Passport.h"
#include "Scheduler.h"
#include "SimEnv.h"
#include <gtest/gtest.h>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

namespace {

using nlohmann::json;

const char* kOptSchema = R"SQL(
CREATE TABLE work_center_types(id TEXT PRIMARY KEY, name TEXT, hour_rate REAL DEFAULT 0, efficiency REAL DEFAULT 1.0);
CREATE TABLE machines(id TEXT PRIMARY KEY, wc_type_id TEXT, status TEXT DEFAULT 'active');
CREATE TABLE products(id TEXT PRIMARY KEY, parent_id TEXT, qty_in_parent REAL DEFAULT 1, batch_size REAL DEFAULT 1,
  purchased INTEGER DEFAULT 0, sellable INTEGER DEFAULT 0, base_cost REAL DEFAULT 0, base_price REAL DEFAULT 0,
  demand_max REAL DEFAULT 0, market_capacity REAL DEFAULT 0, price_elasticity REAL DEFAULT 0.5, competitor_supply REAL DEFAULT 0);
CREATE TABLE operation_wc_types(operation_id TEXT, wc_type_id TEXT);
CREATE TABLE operation_inputs(operation_id TEXT, product_id TEXT, qty REAL);
CREATE TABLE time_norms(operation_id TEXT, wc_type_id TEXT, t_opt REAL, t_norm REAL, t_pess REAL, setup_time REAL);
CREATE TABLE routings(id TEXT PRIMARY KEY, product_id TEXT, is_default INTEGER DEFAULT 1);
CREATE TABLE operations(id TEXT PRIMARY KEY, routing_id TEXT, t_opt REAL, t_norm REAL, t_pess REAL, cost REAL DEFAULT 0,
  risk_coef REAL DEFAULT 0.05, tail_weight REAL DEFAULT 0.08, tail_index REAL DEFAULT 2.5, setup_required INTEGER DEFAULT 0,
  setup_time REAL DEFAULT 0, setup_cost REAL DEFAULT 0, labor_rate REAL DEFAULT 0, order_no INTEGER DEFAULT 10);
CREATE TABLE schedules(id TEXT PRIMARY KEY, is_default INTEGER);
CREATE TABLE shifts(schedule_id TEXT, day_of_week INTEGER, start_min INTEGER, end_min INTEGER);
CREATE TABLE stage1_feedback(product_id TEXT PRIMARY KEY, hours_per_unit REAL, naive_hours REAL, factor REAL, updated_at TEXT);
CREATE TABLE price_distributions(scenario_id TEXT, product_id TEXT, dist_type TEXT, mean REAL, stddev REAL, min_val REAL, max_val REAL, mode_val REAL, beta REAL);
CREATE TABLE scenario_overrides(scenario_id TEXT, product_id TEXT, base_price REAL, base_cost REAL);
CREATE TABLE plan_tasks(plan_id TEXT, operation_id TEXT, machine_id TEXT, qty REAL, end_min REAL, order_idx INTEGER);
)SQL";

/* Два товарных изделия на общем станке; два покупных материала (поставщики) с разными долями. */
struct OptFixture {
  Database db{ ":memory:" };
  OptFixture() {
    db.exec(kOptSchema);
    maos::passport::migrate(db);
    db.exec("INSERT INTO work_center_types(id,name,hour_rate,efficiency) VALUES('w1','w1',100,1.0)");
    db.exec("INSERT INTO machines(id,wc_type_id) VALUES('m1','w1')");
    db.exec("INSERT INTO products(id,purchased,base_cost) VALUES('raw',1,40)");
    db.exec("INSERT INTO products(id,purchased,base_cost) VALUES('rod',1,15)");
    for (const char* pid : { "A", "B" }) {
      const std::string id = pid;
      db.exec("INSERT INTO products(id,sellable,base_price,demand_max,batch_size) VALUES(?,1,?,?,1)",
              { id, id == "A" ? "300" : "260", "1000" });
      db.exec("INSERT INTO routings(id,product_id) VALUES(?,?)", { "r" + id, id });
      db.exec("INSERT INTO operations(id,routing_id,t_opt,t_norm,t_pess) VALUES(?,?,50,60,80)", { "op" + id, "r" + id });
      db.exec("INSERT INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,'w1')", { "op" + id });
      db.exec("INSERT INTO operation_inputs(operation_id,product_id,qty) VALUES(?,'raw',1)", { "op" + id });
      if (id == "A") db.exec("INSERT INTO operation_inputs(operation_id,product_id,qty) VALUES('opA','rod',2)");
    }
    maos::passport::save_fin_params(db, json{ {"credit_limit", 20000}, {"c0", 0}, {"beta", 0.1}, {"lead_weeks", 1},
                                              {"dpo_weeks", 1}, {"cash_samples", 60}, {"prepay_share", 0.3} });
  }
  maos::OptimizeParams params(unsigned seed) const {
    maos::OptimizeParams p;
    p.samples = 300; p.seed = seed; p.horizonHours = 1400; p.objective = "cvar"; p.cash = true; p.polCurve = true;
    return p;
  }
};

/* Канонический JSON: без ключей времени и без блоков "counterparty" (рекурсивно). */
json canonical(const json& j) {
  if (j.is_object()) {
    json out = json::object();
    for (auto& [k, v] : j.items()) {
      if (k == "solve_ms" || k == "total_ms" || k == "time_s" || k == "counterparty" || k == "fin_override") continue;
      out[k] = canonical(v);
    }
    return out;
  }
  if (j.is_array()) { json out = json::array(); for (auto& v : j) out.push_back(canonical(v)); return out; }
  return j;
}

std::string golden_dir() { return std::string(MAOS_TEST_FIXTURES) + "/cpr_golden"; }
bool write_mode() { const char* v = std::getenv("MAOS_WRITE_GOLDEN"); return v && std::string(v) == "1"; }

/* Сверка с эталоном (или запись при MAOS_WRITE_GOLDEN=1). */
void check_golden(const std::string& name, const json& value) {
  const std::string text = canonical(value).dump();
  const std::string path = golden_dir() + "/" + name + ".json";
  if (write_mode()) {
    std::filesystem::create_directories(golden_dir());
    std::ofstream(path) << text;
    return;
  }
  std::ifstream in(path);
  ASSERT_TRUE(in.good()) << "нет эталона " << path << " (снять: MAOS_WRITE_GOLDEN=1 до изменений)";
  std::stringstream ss; ss << in.rdbuf();
  EXPECT_TRUE(ss.str() == text) << name << ": ответ отличается от эталона (длина " << text.size() << " против " << ss.str().size() << ")";
}

const char* kSchedSchema = R"SQL(
CREATE TABLE work_center_types(id TEXT PRIMARY KEY, name TEXT, hour_rate REAL DEFAULT 0,
  mtbf_hours REAL DEFAULT 0, repair_hours REAL DEFAULT 0, mtbm_hours REAL DEFAULT 0, maintenance_hours REAL DEFAULT 0);
CREATE TABLE machines(id TEXT PRIMARY KEY, name TEXT, wc_type_id TEXT, schedule TEXT, status TEXT DEFAULT 'active');
CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, batch_size REAL DEFAULT 1,
  stock REAL DEFAULT 0, purchased INTEGER DEFAULT 0, lead_time_hours REAL DEFAULT 0);
CREATE TABLE workers(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, skills TEXT, cost_per_hour REAL DEFAULT 0);
CREATE TABLE operation_wc_types(operation_id TEXT, wc_type_id TEXT);
CREATE TABLE operation_inputs(operation_id TEXT, product_id TEXT, qty REAL);
CREATE TABLE time_norms(operation_id TEXT, wc_type_id TEXT, t_opt REAL, t_norm REAL, t_pess REAL, setup_time REAL);
CREATE TABLE routings(id TEXT PRIMARY KEY, product_id TEXT, is_default INTEGER DEFAULT 1);
CREATE TABLE operations(id TEXT PRIMARY KEY, routing_id TEXT, name TEXT, t_opt REAL, t_norm REAL, t_pess REAL,
  setup_time REAL DEFAULT 0, risk_coef REAL DEFAULT 0, tail_weight REAL DEFAULT 0, tail_index REAL DEFAULT 2.5,
  order_no INTEGER DEFAULT 10, labor_rate REAL DEFAULT 0);
CREATE TABLE schedules(id TEXT PRIMARY KEY, is_default INTEGER);
CREATE TABLE shifts(schedule_id TEXT, day_of_week INTEGER, start_min INTEGER, end_min INTEGER);
CREATE TABLE stage1_feedback(product_id TEXT PRIMARY KEY, hours_per_unit REAL, naive_hours REAL, factor REAL, updated_at TEXT);
CREATE TABLE demand_orders(product_id TEXT, quantity REAL, due_hours REAL, status TEXT, priority INTEGER);
)SQL";

/* Стадия 1: два станка, дефицитные покупные материалы (поставка — подготовительная джоба). */
struct SchedFixture {
  Database db{ ":memory:" };
  SchedFixture() {
    db.exec(kSchedSchema);
    db.exec("INSERT INTO work_center_types(id,name) VALUES('A','A'),('B','B')");
    db.exec("INSERT INTO machines(id,name,wc_type_id) VALUES('ma','ma','A'),('mb','mb','B')");
    db.exec("INSERT INTO products(id,name,purchased,stock,lead_time_hours) VALUES('R','R',1,0,200),('Q','Q',1,0,400),('K','K',1,100,50)");
    db.exec("INSERT INTO products(id,name) VALUES('P','P'),('S','S')");
    db.exec("INSERT INTO routings(id,product_id) VALUES('rP','P'),('rS','S')");
    db.exec("INSERT INTO operations(id,routing_id,name,t_opt,t_norm,t_pess,risk_coef,tail_weight,order_no) VALUES"
            "('p1','rP','p1',50,60,90,0.05,0.08,10),('p2','rP','p2',20,30,45,0.05,0.08,20),('s1','rS','s1',40,45,70,0.05,0.08,10)");
    db.exec("INSERT INTO operation_wc_types(operation_id,wc_type_id) VALUES('p1','A'),('p2','B'),('s1','B')");
    db.exec("INSERT INTO operation_inputs(operation_id,product_id,qty) VALUES('p1','R',1),('p2','K',1),('s1','Q',2)");
  }
  maos::ScheduleParams params(unsigned seed, int improve) const {
    maos::ScheduleParams p;
    p.program = { { "P", 3, 0 }, { "S", 2, 0 }, { "P", 1, 0 } };
    p.rule = "auto"; p.samples = 80; p.seed = seed; p.useCalendar = false; p.improveIters = improve;
    return p;
  }
};

json small_env_instance() {
  json ops_s = json::array({ { {"id","os"}, {"name","os"}, {"wc_types", json::array({"A"})}, {"t_exp",60}, {"sigma",6},
                               {"inputs", json::array({ json::array({"R", 1.0}) })} } });
  json ops_p = json::array({
    { {"id","op1"}, {"name","op1"}, {"wc_types", json::array({"A","B"})}, {"t_exp",90}, {"sigma",9}, {"setup",15}, {"inputs", json::array({ json::array({"S", 1.0}) })} },
    { {"id","op2"}, {"name","op2"}, {"wc_types", json::array({"B"})}, {"t_exp",45}, {"sigma",4}, {"inputs", json::array({ json::array({"Q", 1.0}) })} },
  });
  return {
    {"name", "cpr-golden"},
    {"wc_types", json::array({ { {"id","A"}, {"name","A"} }, { {"id","B"}, {"name","B"} } })},
    {"machines", json::array({ { {"id","a1"}, {"wct","A"} }, { {"id","b1"}, {"wct","B"} } })},
    {"products", json::array({
      { {"id","S"}, {"batch_size",1}, {"ops", ops_s} },
      { {"id","P"}, {"batch_size",2}, {"ops", ops_p} },
      { {"id","R"}, {"batch_size",1}, {"purchased", true}, {"stock", 0}, {"lead_hours", 60} },
      { {"id","Q"}, {"batch_size",1}, {"purchased", true}, {"stock", 0}, {"lead_hours", 200} },
    })},
    {"workers", json::array()},
    {"orders", json::array({
      { {"product_id","P"}, {"qty",4}, {"due_h",240}, {"price",1000}, {"mat_cost",100} },
      { {"product_id","S"}, {"qty",3}, {"due_h",300}, {"price",200}, {"mat_cost",10} },
      { {"product_id","P"}, {"qty",2}, {"release_h",168}, {"due_h",500}, {"price",500}, {"mat_cost",100} },
    })},
    {"fin", { {"c0", 1000}, {"credit_limit", 5000}, {"prepay_share", 0.3}, {"lead_weeks", 1} }},
    {"tail_weight", 0.1},
  };
}

}  // namespace

// T3 (а): CashOptimize при выключенном CPR (по умолчанию) — тот же ответ, что до изменений; сиды 1, 42, 7,
// без макро-генератора (iid_v063) и с ним (малая фикстура параметров).
TEST(CprGolden, CashOptimizeDisabledReproducesGolden) {
  const maos::macro::MacroSampler ms = maos::macro::MacroSampler::load(std::string(MAOS_TEST_FIXTURES) + "/macro_params_small.json");
  for (unsigned seed : { 1u, 42u, 7u })
    for (int withMacro = 0; withMacro < 2; ++withMacro) {
      OptFixture f;
      maos::OptimizeParams p = f.params(seed);
      if (withMacro) p.macro = &ms;
      const json r = maos::run_optimization(f.db, p);
      ASSERT_TRUE(r.contains("cash_lp")) << r.dump();
      check_golden("optimize_seed" + std::to_string(seed) + (withMacro ? "_macro" : "_iid"), r);
    }
}

// T3 (б): CPR включён при нулевых вероятностях ≡ выключен при fin.pd = 0 (legacy-розыгрыш не выполняется при
// enabled = 1 — без двойного счёта) по всем полям, кроме блоков counterparty; блок counterparty — есть.
TEST(CprGolden, CashOptimizeEnabledZeroRiskEqualsDisabledWithoutLegacyPd) {
  const maos::macro::MacroSampler ms = maos::macro::MacroSampler::load(std::string(MAOS_TEST_FIXTURES) + "/macro_params_small.json");
  const json zero = { {"enabled", true}, {"buyer_pd_annual", 0}, {"supplier_pd_annual", 0}, {"late_share", 0}, {"disrupt_share", 0} };
  for (unsigned seed : { 1u, 42u, 7u })
    for (int withMacro = 0; withMacro < 2; ++withMacro) {
      OptFixture f;
      maos::OptimizeParams off = f.params(seed), on = f.params(seed);
      if (withMacro) { off.macro = &ms; on.macro = &ms; }
      off.finOverride = { {"pd", 0} };
      on.counterparty = zero;
      const json r0 = maos::run_optimization(f.db, off), r1 = maos::run_optimization(f.db, on);
      ASSERT_TRUE(r1["cash_lp"].contains("counterparty")) << r1["cash_lp"].dump();
      EXPECT_TRUE(r1["cash_lp"]["counterparty"]["enabled"].get<bool>());
      EXPECT_EQ(r1["cash_lp"]["counterparty"]["p_buyer_default"].get<double>(), 0.0);
      EXPECT_FALSE(r0["cash_lp"].contains("counterparty"));
      EXPECT_TRUE(canonical(r0).dump() == canonical(r1).dump()) << "seed " << seed << " macro " << withMacro;
    }
}

// T5: Стадия 1 без CPR — то же расписание, правило и ключ ГА.
TEST(CprGolden, ScheduleDisabledReproducesGolden) {
  for (unsigned seed : { 1u, 42u })
    for (int improve : { 0, 6 }) {
      SchedFixture f;
      const json r = maos::run_schedule(f.db, f.params(seed, improve));
      ASSERT_FALSE(r.value("error_soft", false)) << r.dump();
      check_golden("schedule_seed" + std::to_string(seed) + "_ga" + std::to_string(improve), r);
    }
}

// T5 (вкл.): CPR Стадии 1 включён при нулевых вероятностях (и явно выключен) — то же расписание, что до изменений
// (durMC, правило, ключ ГА); при высокой вероятности срыва Монте-Карло-Cmax растёт (правило «auto» может смениться —
// выбор по МК), блок counterparty заполнен.
TEST(CprGolden, ScheduleCounterpartyZeroRiskKeepsGolden) {
  const json zero = { {"buyer_pd_annual", 0}, {"supplier_pd_annual", 0}, {"late_share", 0}, {"disrupt_share", 0} };
  for (unsigned seed : { 1u, 42u })
    for (int improve : { 0, 6 })
      for (int mode : { 0, 1 }) {
        SchedFixture f;
        maos::ScheduleParams p = f.params(seed, improve);
        p.counterparty = mode; p.counterpartyOverride = zero;
        const json r = maos::run_schedule(f.db, p);
        EXPECT_EQ(r.contains("counterparty"), mode == 1);
        check_golden("schedule_seed" + std::to_string(seed) + "_ga" + std::to_string(improve), r);
      }
  SchedFixture f;
  maos::ScheduleParams p = f.params(42, 0);
  const json off = maos::run_schedule(f.db, p);
  p.counterparty = 1; p.counterpartyOverride = { {"disrupt_share", 0.9}, {"disrupt_scale_weeks", 2.0} };
  const json on = maos::run_schedule(f.db, p);
  ASSERT_TRUE(on.contains("counterparty"));
  EXPECT_GT(on["counterparty"]["share_scenarios_delayed"].get<double>(), 0.5);
  EXPECT_GT(on["kpi"]["makespan_mean"].get<double>(), off["kpi"]["makespan_mean"].get<double>() + 100.0);
}

// T6: эпизоды SimEnv (с шоком срыва поставки A2 и без) и оценка инвестпроекта — те же, что до изменений.
TEST(CprGolden, SimEnvAndInvestDisabledReproduceGolden) {
  using namespace maos::env;
  const Instance inst = instance_from_json(small_env_instance());
  EnvConfig c; c.mode = EpochMode::Serial; c.breakdowns = true;
  SimEnv env(inst, c);
  json out = json::array();
  for (uint64_t seed : { 3ull, 11ull }) {
    for (int shock = 0; shock < 2; ++shock) {
      Scenario sc; sc.idx = (int)seed; sc.keyRate = { 0.16, 0.17, 0.18 };
      if (shock) { sc.supplyDelay = 0.15; sc.defaultWeek = 2; sc.lgd = 0.45; }
      env.reset(seed, sc);
      while (!env.done()) { if (env.level() == 2) env.step(0); else env.step_job(env.rule_choice("EDD")); }
      out.push_back(env.summary());
    }
  }
  check_golden("simenv_small", out);
  // InvestEval: кандидат «станок» на трёх сценариях с шоком поставки (CRN «база»/«с проектом»).
  json inv = small_env_instance();
  inv["a3"] = { {"invest_cands", json::array({ { {"id","mB"}, {"kind","machine"}, {"wct","B"}, {"capex",3000}, {"lead_weeks",1},
                                                 {"opex_weekly",3}, {"life_weeks",520}, {"prepay_share",0.3} } })} };
  std::vector<Scenario> scen(3); std::vector<uint64_t> seeds{ 21, 22, 23 };
  scen[1].supplyDelay = 0.1; scen[2].defaultWeek = 1; scen[2].lgd = 0.45;
  maos::invest::EvalCfg ec; ec.rule = "EDD"; ec.threads = 1; ec.bootB = 100;
  EnvConfig ci; ci.breakdowns = true; ci.denseReward = false;
  check_golden("invest_small", maos::invest::evaluate(instance_from_json(inv), ci, 0, scen, seeds, ec));
}

// Гейт 0 (б) эксперимента CR-E1: /api/optimize (cash=true) на копии демо-БД с обученным генератором — тот же
// ответ, что у бинаря до изменений (сиды 1, 42, 7). Только по явному запросу: MAOS_DEMO_DB=<копия БД>,
// MAOS_DEMO_GOLDEN=<каталог эталона> (вне репозитория: демо-БД меняется).
TEST(CprGolden, DemoDbOptimizeGate) {
  const char* dbPath = std::getenv("MAOS_DEMO_DB");
  const char* dir = std::getenv("MAOS_DEMO_GOLDEN");
  if (!dbPath || !dir) GTEST_SKIP() << "MAOS_DEMO_DB / MAOS_DEMO_GOLDEN не заданы";
  const maos::macro::MacroSampler ms = maos::macro::MacroSampler::load(maos::macro::MacroSampler::default_path());
  for (unsigned seed : { 1u, 42u, 7u }) {
    Database db(dbPath);
    maos::OptimizeParams p; p.seed = seed; p.cash = true; p.macro = &ms;
    const json r = maos::run_optimization(db, p);
    const std::string text = canonical(r).dump();
    const std::string path = std::string(dir) + "/demo_seed" + std::to_string(seed) + ".json";
    if (write_mode()) { std::filesystem::create_directories(dir); std::ofstream(path) << text; continue; }
    std::ifstream in(path);
    ASSERT_TRUE(in.good()) << path;
    std::stringstream ss; ss << in.rdbuf();
    EXPECT_TRUE(ss.str() == text) << "seed " << seed;
  }
}

// CPR по умолчанию паспорта (enabled = 1): LP оптимальна, тождества водопада держатся, сводка заполнена.
TEST(CprGolden, CashOptimizeEnabledDefaultsSmoke) {
  const maos::macro::MacroSampler ms = maos::macro::MacroSampler::load(std::string(MAOS_TEST_FIXTURES) + "/macro_params_small.json");
  OptFixture f;
  maos::OptimizeParams p = f.params(42); p.macro = &ms;
  p.counterparty = { {"enabled", true} };
  p.finOverride = { {"cash_samples", 200} };
  const json r = maos::run_optimization(f.db, p);
  const json& c = r["cash_lp"];
  ASSERT_EQ(c.value("status", std::string()), "optimal") << c.dump();
  const json& cp = c["counterparty"];
  EXPECT_TRUE(c["waterfall"]["rule"].contains("counterparty"));
  EXPECT_GE(cp["ecl_pct_revenue"].get<double>(), 0.0);
  EXPECT_EQ(cp["stream"][1].get<int>(), 915);
  EXPECT_EQ(cp["param_status"].value("buyer_pd_annual", std::string()), "К");      // статусы — из паспорта
  EXPECT_EQ(cp["param_status"].value("rho", std::string()), "НОРМ");
  for (const char* k : { "lp_recourse", "rule" }) EXPECT_LE(c["waterfall"][k]["identities_max_residual"].get<double>(), 1e-6) << k;
  EXPECT_GT(cp["p_buyer_default"].get<double>(), 0.0);
  EXPECT_LT(cp["p_buyer_default"].get<double>(), 0.6);
}

// POST /api/schedule: недопустимые fin.cp.* запроса — исключение (обработчик → 400), а не тихий расчёт; БД без
// таблицы fin_params (фикстура Стадии 1) — умолчания паспорта.
TEST(CprStage1, InvalidOverrideRejected) {
  for (const json& bad : { json{ {"rho", 5} }, json{ {"buyer_pd_annual", 2} }, json{ {"late_max_weeks", 1e6} },
                           json{ {"no_such_key", 1} }, json{ {"disrupt_share", "0.5"} } }) {
    SchedFixture f;
    maos::ScheduleParams p = f.params(42, 0);
    p.counterparty = 1; p.counterpartyOverride = bad;
    EXPECT_THROW(maos::run_schedule(f.db, p), std::runtime_error) << bad.dump();
  }
  SchedFixture f;
  maos::ScheduleParams p = f.params(42, 0);
  p.counterparty = 1; p.counterpartyOverride = { {"disrupt_share", 0.3} };
  const json r = maos::run_schedule(f.db, p);
  ASSERT_TRUE(r.contains("counterparty"));
  EXPECT_EQ(r["counterparty"]["lead_weeks"].get<int>(), 1);         // умолчание fin.lead_weeks без таблицы fin_params
}

// d_φ — во всех сценариях прогона с CPR: при нулевом риске (событий нет ни в одном сценарии) скидка за предоплату
// снижает материальные затраты водопада; решение LP (скидку не видит) — то же.
TEST(CprGolden, PrepayDiscountAppliesWithoutEvents) {
  const json zero = { {"enabled", true}, {"buyer_pd_annual", 0}, {"supplier_pd_annual", 0}, {"late_share", 0}, {"disrupt_share", 0} };
  OptFixture f;
  maos::OptimizeParams a = f.params(7), b = f.params(7);
  a.counterparty = zero;
  json zd = zero; zd["prepay_discount"] = 0.05; b.counterparty = zd;
  const json ra = maos::run_optimization(f.db, a)["cash_lp"], rb = maos::run_optimization(f.db, b)["cash_lp"];
  ASSERT_EQ(ra.value("status", std::string()), "optimal");
  EXPECT_EQ(ra["portfolio"], rb["portfolio"]);
  EXPECT_GT(rb["waterfall"]["rule"]["profit_mean"].get<double>(), ra["waterfall"]["rule"]["profit_mean"].get<double>());
}

// OOS при CPR: из валовой OOS-прибыли вычитаются проценты, налог И средние потери CPR in-sample — разность
// «валовая − чистая» одинакова in-sample и OOS.
TEST(CprGolden, OosSubtractsCounterpartyLoss) {
  const maos::macro::MacroSampler ms = maos::macro::MacroSampler::load(std::string(MAOS_TEST_FIXTURES) + "/macro_params_small.json");
  OptFixture f;
  maos::OptimizeParams p = f.params(42); p.macro = &ms;
  p.counterparty = { {"enabled", true}, {"buyer_pd_annual", 0.5}, {"late_share", 0.3} };
  const json c = maos::run_optimization(f.db, p)["cash_lp"];
  ASSERT_EQ(c.value("status", std::string()), "optimal") << c.dump();
  const json& o = c["oos"];
  const double gap = o["gap_expected"].get<double>(), gOos = o["gross_expected"].get<double>();
  ASSERT_GT(gOos, 0.0);
  const double grossIn = gOos / (1.0 - gap);                         // gap = (g_in − g_oos)/|g_in|, g_in > 0
  const double net = c["expected"].get<double>();
  EXPECT_NEAR(gOos - o["expected"].get<double>(), grossIn - net, 1e-6 * std::max(1.0, std::fabs(grossIn)));
  EXPECT_GT(grossIn - net, 0.0);
}
