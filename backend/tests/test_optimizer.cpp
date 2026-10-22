// Стадия 2 (Optimizer) — волна F: R5 (воспроизводимость по seed независимо от истории
// расписаний / stage1_feedback), R4 (хвостовая поправка мощности), связка с кассой
// (cash_lp: статус, тождества водопада) на крошечной БД в памяти.
#include "Optimizer.h"
#include "Passport.h"
#include <gtest/gtest.h>
#include <cmath>
#include <string>

namespace {

const char* kSchema = R"SQL(
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

std::string d2s(double v) { return std::to_string(v); }

struct Fixture {
  Database db{ ":memory:" };
  Fixture() {
    db.exec(kSchema);
    maos::passport::migrate(db);                      // fin_params + паспорт
    db.exec("INSERT INTO work_center_types(id,name,hour_rate,efficiency) VALUES('w1','w1',100,1.0)");
    db.exec("INSERT INTO machines(id,wc_type_id) VALUES('m1','w1')");
    db.exec("INSERT INTO products(id,purchased,base_cost) VALUES('raw',1,40)");
    // Два товарных изделия: 1 операция по 60 мин на w1, сырьё 1 ед. (40) → себестоимость ≈ 140.
    for (const char* pid : { "A", "B" }) {
      const std::string id = pid;
      db.exec("INSERT INTO products(id,sellable,base_price,demand_max,batch_size) VALUES(?,1,?,?,1)",
              { id, id == "A" ? "300" : "260", "1000" });
      db.exec("INSERT INTO routings(id,product_id) VALUES(?,?)", { "r" + id, id });
      db.exec("INSERT INTO operations(id,routing_id,t_opt,t_norm,t_pess) VALUES(?,?,60,60,60)", { "op" + id, "r" + id });
      db.exec("INSERT INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,'w1')", { "op" + id });
      db.exec("INSERT INTO operation_inputs(operation_id,product_id,qty) VALUES(?,'raw',1)", { "op" + id });
    }
  }
  maos::OptimizeParams params() const {
    maos::OptimizeParams p;
    p.samples = 300; p.seed = 7; p.horizonHours = 400; p.objective = "cvar";
    return p;
  }
};

double load_per_unit(const json& r) {
  double load = 0, qty = 0;
  for (auto& l : r["robust"]["resource_load"]) load += l.value("load_hours", 0.0);
  for (auto& it : r["robust"]["items"]) qty += it.value("qty", 0.0);
  return qty > 0 ? load / qty : 0;
}

}  // namespace

TEST(Optimizer, R5_SameSeedGivesIdenticalResultRegardlessOfScheduleHistory) {
  Fixture f;
  const json r1 = maos::run_optimization(f.db, f.params());
  ASSERT_FALSE(r1.value("error_soft", false));
  EXPECT_EQ(r1["feedback"]["rows"].get<int>(), 0);
  EXPECT_EQ(r1["feedback"]["hash"].get<std::string>(), "none");
  // «История расписаний»: в stage1_feedback появились поправки — без apply_feedback ответ тот же.
  f.db.exec("INSERT INTO stage1_feedback(product_id,hours_per_unit,naive_hours,factor) VALUES('A',1.5,1.0,1.5)");
  f.db.exec("INSERT INTO stage1_feedback(product_id,hours_per_unit,naive_hours,factor) VALUES('B',1.2,1.0,1.2)");
  const json r2 = maos::run_optimization(f.db, f.params());
  EXPECT_EQ(r2["feedback"]["rows"].get<int>(), 2);
  EXPECT_FALSE(r2["feedback"]["applied"].get<bool>());
  EXPECT_NE(r2["feedback"]["hash"].get<std::string>(), "none");
  EXPECT_EQ(r1["robust"].dump(), r2["robust"].dump());
  EXPECT_EQ(r1["expected"].dump(), r2["expected"].dump());
  EXPECT_EQ(r1["histogram"].dump(), r2["histogram"].dump());
  EXPECT_EQ(r1["stage1_calibrated"].get<int>(), 0);
  // Явное применение меняет потребление мощности (и фиксируется в ответе).
  maos::OptimizeParams pa = f.params(); pa.applyFeedback = true;
  const json r3 = maos::run_optimization(f.db, pa);
  EXPECT_TRUE(r3["feedback"]["applied"].get<bool>());
  EXPECT_EQ(r3["stage1_calibrated"].get<int>(), 2);
  EXPECT_NE(r1["robust"]["resource_load"].dump(), r3["robust"]["resource_load"].dump());
  EXPECT_EQ(r3["feedback"]["hash"].get<std::string>(), r2["feedback"]["hash"].get<std::string>());
}

TEST(Optimizer, R4_Stage2CapacityCarriesTailAndReworkUplift) {
  Fixture f;
  // Норма 60 мин, w=0.08, ξ=2.5, risk=0.05: E[d]/mean = 1 + 0.08·(1−9^−1.5)/1.5 + 0.025 ≈ 1.0764.
  const double uplift = 1.0 + 0.08 * (1.0 - std::pow(9.0, -1.5)) / 1.5 + 0.5 * 0.05;
  const json r = maos::run_optimization(f.db, f.params());
  EXPECT_NEAR(load_per_unit(r), uplift, 1e-9);
  EXPECT_TRUE(r["tail_uplift"].get<bool>());
  maos::OptimizeParams p0 = f.params(); p0.tailUplift = false;
  const json r0 = maos::run_optimization(f.db, p0);
  EXPECT_NEAR(load_per_unit(r0), 1.0, 1e-9);
}

TEST(Optimizer, CashLpOnTinyDbIsOptimalAndWaterfallIdentitiesHold) {
  Fixture f;
  maos::passport::save_fin_params(f.db, json{ {"credit_limit", 20000}, {"c0", 0}, {"beta", 0.1},
                                              {"lead_weeks", 0}, {"dpo_weeks", 1}, {"cash_samples", 60} });
  maos::OptimizeParams p = f.params(); p.cash = true; p.polCurve = true;
  const json r = maos::run_optimization(f.db, p);
  ASSERT_TRUE(r.contains("cash_lp")) << r.dump();
  const json& c = r["cash_lp"];
  ASSERT_EQ(c.value("status", std::string()), "optimal") << c.dump();
  EXPECT_EQ(c["n_scenarios"].get<int>(), 60);
  EXPECT_EQ(c["horizon_weeks"].get<int>(), 3);                 // ⌈400/168⌉
  EXPECT_GE(c["cfar"].get<double>(), -1e-6);                   // L_min = 0 выполнено
  EXPECT_LE(c["expected"].get<double>(), c["unconstrained"]["expected"].get<double>() + 1e-6);
  EXPECT_GE(c["price_of_liquidity"]["value"].get<double>(), -1e-6);
  EXPECT_GE(c["pol_curve"].size(), 2u);
  for (const char* k : { "lp_recourse", "rule" }) {
    const json& w = c["waterfall"][k];
    EXPECT_LE(w["identities_max_residual"].get<double>(), 1e-6) << k;
    EXPECT_GE(w["p_breach"].get<double>(), 0.0);
    EXPECT_LE(w["p_breach_ci"][1].get<double>(), 1.0);
  }
  // Воспроизводимость: тот же seed → тот же ответ денежного слоя.
  const json r2 = maos::run_optimization(f.db, p);
  EXPECT_EQ(r["cash_lp"]["portfolio"].dump(), r2["cash_lp"]["portfolio"].dump());
  EXPECT_EQ(r["cash_lp"]["waterfall"].dump(), r2["cash_lp"]["waterfall"].dump());
}

TEST(Optimizer, PassportForbidsEstimateStatusWithoutData) {
  Fixture f;
  EXPECT_THROW(maos::passport::passport_update(f.db, "fin.tau_v", json{ {"status", "О"} }), std::runtime_error);
  EXPECT_THROW(maos::passport::passport_update(f.db, "fin.tau_v", json{ {"status", "оценено"} }), std::runtime_error);
  const json ok = maos::passport::passport_update(f.db, "fin.dso_kernel",
                                                  json{ {"status", "О"}, {"source", "реестр дебиторки 2026"}, {"n_obs", 120} });
  EXPECT_EQ(ok.value("status", std::string()), "О");
  EXPECT_THROW(maos::passport::save_fin_params(f.db, json{ {"tau_v", 1.5} }), std::runtime_error);
  const json fp = maos::passport::fin_params_json(f.db);
  EXPECT_NEAR(fp["tau_p"].get<double>(), 0.25, 1e-12);
  EXPECT_NEAR(fp["tau_v"].get<double>(), 0.22, 1e-12);
}
