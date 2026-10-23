// Волна A: правило «RL» без политики — понятная ошибка, путь EDD не затронут; act() без политики —
// первый допустимый слот маски (фолбэк), чтобы вызывающий код не получал −1 на непустой маске.
#include "RlRule.h"
#include "Scheduler.h"
#include <gtest/gtest.h>
#include <cstdlib>

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
INSERT INTO machines(id,name,wc_type_id) VALUES('a1','a1','A');
INSERT INTO products(id,name) VALUES('P','P');
INSERT INTO routings(id,product_id) VALUES('rP','P');
INSERT INTO operations(id,routing_id,name,t_opt,t_norm,t_pess) VALUES('op','rP','op',60,60,60);
INSERT INTO operation_wc_types VALUES('op','A');
)SQL";
}  // namespace

TEST(RlRule, WithoutPolicyRuleRlIsSoftErrorAndEddUntouched) {
  setenv("MAOS_RL_POLICY_DIR", "/nonexistent-maos-rl-dir", 1);
  Database db(":memory:"); db.exec(kSchema);
  maos::ScheduleParams p; p.program = { {"P", 1, 0} }; p.samples = 60; p.improveIters = 0; p.useCalendar = false;
  p.rule = "RL";
  const json r = maos::run_schedule(db, p);
  EXPECT_TRUE(r.value("error_soft", false));
  EXPECT_FALSE(r.at("warnings").empty());
  EXPECT_FALSE(maos::rl::status().value("available", true));
  p.rule = "EDD";
  const json e = maos::run_schedule(db, p);
  EXPECT_FALSE(e.value("error_soft", false));
  EXPECT_NEAR(e.at("kpi").at("makespan").get<double>(), 1.0, 1e-9);
  EXPECT_TRUE(e.at("moves").is_null());
}

TEST(RlRule, ActWithoutPolicyFallsBackToFirstAllowedSlot) {
  setenv("MAOS_RL_POLICY_DIR", "/nonexistent-maos-rl-dir", 1);
  std::vector<float> obs(206, 0.f);
  std::vector<uint8_t> mask(17, 0); mask[3] = 1; mask[5] = 1;
  EXPECT_EQ(maos::rl::act(0, obs, mask), 3);
  std::vector<uint8_t> none(17, 0);
  EXPECT_EQ(maos::rl::act(0, obs, none), -1);
}

TEST(RlRule, RuleSelectActionsMapToRulesInPythonOrder) {
  // A2: порядок = rl/env/l0_env.py:RULES; вне диапазона — EDD (безопасный фолбэк).
  const char* want[] = { "EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO" };
  for (int a = 0; a < maos::rl::kNumRules; ++a) EXPECT_STREQ(maos::rl::rule_for_action(a), want[a]);
  EXPECT_STREQ(maos::rl::rule_for_action(-1), "EDD");
  EXPECT_STREQ(maos::rl::rule_for_action(7), "EDD");
}
