// Волна A3 (PLAN-V2 §9): структурный режим SimEnv (сверхурочные, субподряд операций, инвестиции L3 с траншем) и
// оценка инвестпроекта на CRN (InvestEval): тождества ЧДД с Finance.h, водопад с CAPEX-траншами, ручные случаи
// «станок окупается» / «станок не окупается».
#include "Finance.h"
#include "InvestEval.h"
#include "SimEnv.h"
#include <gtest/gtest.h>
#include <cmath>
#include <set>
#include <string>
#include <vector>

namespace {

using maos::env::EnvConfig;
using maos::env::Instance;
using maos::env::Scenario;
using maos::env::SimEnv;
using nlohmann::json;

// Цех: тип A (2 станка) → тип B (1 станок, узкое место); 8 заказов по неделям, календарь Пн–Пт 06–22.
json a3_instance(double qty, double capex) {
  json cal = json::array();
  for (int d = 0; d < 7; ++d) cal.push_back(d < 5 ? json::array({ json::array({ 360, 1320 }) }) : json::array());
  json ops = json::array({
    { {"id","p1"}, {"name","p1"}, {"wc_types", json::array({"A"})}, {"t_exp",60}, {"sigma",6}, {"hour_rate",1000}, {"labor_rate",0}, {"inputs", json::array()} },
    { {"id","p2"}, {"name","p2"}, {"wc_types", json::array({"B"})}, {"t_exp",120}, {"sigma",12}, {"hour_rate",2000}, {"labor_rate",0}, {"inputs", json::array()} },
  });
  json orders = json::array();
  for (int k = 0; k < 8; ++k)
    orders.push_back({ {"product_id","P"}, {"qty",qty}, {"release_h", 168.0 * k}, {"due_h", 168.0 * (k + 1.5)}, {"price",4000}, {"mat_cost",500} });
  json cands = json::array({
    { {"id","mB"}, {"kind","machine"}, {"wct","B"}, {"capex",capex}, {"lead_weeks",2}, {"opex_weekly",0.001 * capex}, {"life_weeks",520}, {"prepay_share",0.3}, {"source","toc"} },
    { {"id","modB"}, {"kind","modernize"}, {"wct","B"}, {"capex",0.2 * capex}, {"lead_weeks",1}, {"mtbf_mul",2.0}, {"repair_mul",0.7}, {"life_weeks",520} },
  });
  return {
    {"name","a3-hand"},
    {"wc_types", json::array({ { {"id","A"}, {"name","A"} }, { {"id","B"}, {"name","B"}, {"mtbf", 200}, {"repair_h", 6} } })},
    {"machines", json::array({ { {"id","a1"}, {"wct","A"} }, { {"id","a2"}, {"wct","A"} }, { {"id","b1"}, {"wct","B"} } })},
    {"products", json::array({ { {"id","P"}, {"batch_size",1}, {"ops", ops} } })},
    {"workers", json::array()}, {"orders", orders}, {"calendar", { {"any", true}, {"days", cal} }},
    {"outsource", { {"lead_h", 24}, {"markup", 1.3}, {"prepay", 0.5} }},
    {"fin", { {"c0", 2e6}, {"credit_limit", 5e6}, {"tax_cumulative", true} }},
    {"tail_weight", 0.0},
    {"a3", { {"late_fixed",0.05}, {"late_per_week",0.05}, {"late_cap",0.5}, {"overtime_hours_week",16}, {"overtime_cost_mul",0.6},
             {"outsource_op_markup",1.6}, {"outsource_op_share",0.5}, {"invest_cands", cands} }},
  };
}

EnvConfig det_cfg(bool structMode) {
  EnvConfig c; c.deterministic = true; c.breakdowns = false; c.denseReward = false;
  c.l2Enabled = structMode; c.structMode = structMode; return c;
}

// Эпизод: на эпохах L3 — действие act (если допустимо, ≤ 1 раз за эпоху), иначе noop; L0 — чемпион (rule).
json run_struct(SimEnv& e, uint64_t seed, int act, const std::string& rule) {
  e.set_dispatch(rule, {});
  e.reset(seed);
  int lastWeek = -1;
  while (!e.done()) {
    if (e.level() == 2) {
      const int w = (int)std::floor(e.now() / maos::env::kWeekMin);
      const bool can = act > 0 && e.mask_l2()[act] && w != lastWeek;
      if (can) lastWeek = w;
      e.step(can ? act : 0);
    } else e.run_l0();
  }
  return e.summary();
}

}  // namespace

// Структурный режим с noop на всех эпохах совпадает с прогоном правила (CRN, тот же Ганта).
TEST(InvestA3, StructNoopEqualsRuleBaseline) {
  const Instance inst = maos::env::instance_from_json(a3_instance(50, 5e5));
  SimEnv plain(inst, det_cfg(false)), st(inst, det_cfg(true));
  ASSERT_EQ(st.obs_l2_size(), SimEnv::kStructObs);
  ASSERT_EQ(st.act_l2_size(), SimEnv::kStructActs);
  const json a = maos::env::evaluate_rule(plain, "EDD", 7, Scenario{});
  const json b = run_struct(st, 7, 0, "EDD");
  EXPECT_DOUBLE_EQ(a.at("profit").get<double>(), b.at("profit").get<double>());
  EXPECT_DOUBLE_EQ(a.at("makespan_h").get<double>(), b.at("makespan_h").get<double>());
  EXPECT_EQ(b.at("n_moves").get<int>(), 0);
  EXPECT_LE(b.at("cash_residual").get<double>(), 1e-6 * 2e6);
}

// Сверхурочные: суббота на станках узкого места — Cmax не больше, плата начислена, работа в субботу есть.
TEST(InvestA3, OvertimeAddsSaturdayCapacityAndCharges) {
  const Instance inst = maos::env::instance_from_json(a3_instance(50, 5e5));
  SimEnv st(inst, det_cfg(true));
  const json base = run_struct(st, 3, 0, "EDD");
  const json ot = run_struct(st, 3, SimEnv::kSOvertime, "EDD");
  EXPECT_GT(ot.at("a3").at("overtime_weeks").get<int>(), 0);
  EXPECT_GT(ot.at("a3").at("fee_overtime").get<double>(), 0.0);
  EXPECT_LT(ot.at("makespan_h").get<double>(), base.at("makespan_h").get<double>());
  EXPECT_LT(ot.at("tardiness_h").get<double>(), base.at("tardiness_h").get<double>());
  bool saturday = false;
  for (auto& g : st.gantt()) {
    if (g.at("machine_id") != "b1") continue;
    const double s = g.at("start").get<double>() * 60.0;
    if ((int)std::floor(s / 1440.0) % 7 == 5) saturday = true;
  }
  EXPECT_TRUE(saturday);
  // Следующий эпизод без хода — календарь восстановлен (тот же результат, что база).
  const json again = run_struct(st, 3, 0, "EDD");
  EXPECT_DOUBLE_EQ(again.at("makespan_h").get<double>(), base.at("makespan_h").get<double>());
}

// Субподряд операций узкого места: джобы без станка (срок + работа), плата > 0, все джобы завершены.
TEST(InvestA3, OutsourceOpMovesBottleneckJobsToSubcontractor) {
  const Instance inst = maos::env::instance_from_json(a3_instance(50, 5e5));
  SimEnv st(inst, det_cfg(true));
  const json s = run_struct(st, 5, SimEnv::kSOutsource, "EDD");
  EXPECT_GT(s.at("a3").at("fee_outsource").get<double>(), 0.0);
  int noMachineP2 = 0;
  for (auto& g : st.gantt()) {
    EXPECT_TRUE(g.at("done").get<bool>());
    if (g.at("op_id") == "p2" && g.at("machine_id").get<std::string>().empty()) ++noMachineP2;
  }
  EXPECT_GT(noMachineP2, 0);
  for (auto& mv : s.at("moves")) EXPECT_EQ(mv.at("kind"), "outsource_op");
}

// Инвестиция: новый станок работает только после ввода; CAPEX — транши (долг растёт), амортизация в прибыли;
// тождества водопада держатся.
TEST(InvestA3, InvestMachineAddsCapacityAfterLeadWithTranche) {
  const Instance inst = maos::env::instance_from_json(a3_instance(50, 5e5));
  SimEnv st(inst, det_cfg(true));
  const json base = run_struct(st, 9, 0, "EDD");
  const json inv = run_struct(st, 9, SimEnv::kSInvest0, "EDD");
  EXPECT_NEAR(inv.at("a3").at("capex").get<double>(), 5e5, 1e-6);
  EXPECT_EQ(inv.at("a3").at("invest_week")[0].get<int>(), 0);
  const double delivery = 2 * maos::env::kWeekMin;
  bool used = false;
  for (auto& g : st.gantt()) if (g.at("machine_id") == "inv-mB") { used = true; EXPECT_GE(g.at("start").get<double>() * 60.0, delivery - 1e-6); }
  EXPECT_TRUE(used);
  EXPECT_LT(inv.at("tardiness_h").get<double>(), base.at("tardiness_h").get<double>());
  EXPECT_LE(inv.at("cash_residual").get<double>(), 1e-6 * 2e6);
  // A4: по умолчанию излишек кассы гасит линию — CAPEX покрывается свободной кассой (c0 = 2 млн), долг не копится.
  EXPECT_LT(inv.at("end_debt").get<double>(), 1.0);
  // Транши видны в долге при выключенном погашении (fin.auto_repay = false, режим до A4).
  json jNo = a3_instance(50, 5e5); jNo["fin"]["auto_repay"] = false;
  SimEnv stNo(maos::env::instance_from_json(jNo), det_cfg(true));
  const json baseNo = run_struct(stNo, 9, 0, "EDD");
  const json invNo = run_struct(stNo, 9, SimEnv::kSInvest0, "EDD");
  EXPECT_GT(invNo.at("max_debt").get<double>(), baseNo.at("max_debt").get<double>() + 4.9e5);
  EXPECT_LE(invNo.at("cash_residual").get<double>(), 1e-6 * 2e6);
  EXPECT_GT(inv.at("profit").get<double>(), invNo.at("profit").get<double>());   // проценты по траншам сэкономлены
  // Статическая покупка до эпизода (schedule_invest) = ход invest на эпохе недели 0.
  SimEnv st2(inst, det_cfg(false));
  st2.schedule_invest(0, 0);
  const json inv2 = maos::env::evaluate_rule(st2, "EDD", 9, Scenario{});
  EXPECT_DOUBLE_EQ(inv2.at("profit").get<double>(), inv.at("profit").get<double>());
}

// Тождества ЧДД с Finance.h: −CAPEX + cf·a(r, n) = finance::npv; срок окупаемости — тот же алгоритм.
TEST(InvestA3, NpvAndPaybackIdentitiesMatchFinance) {
  namespace fin = maos::finance;
  for (double r : { 0.0, 0.004, 0.012 })
    for (int n : { 1, 12, 60 }) {
      EXPECT_NEAR(-1000.0 + 37.0 * maos::invest::annuity(r, n), fin::npv(1000.0, 37.0, n, r), 1e-9);
      const auto dpp = fin::discounted_payback_months(1000.0, 37.0, n, r);
      const double w = maos::invest::discounted_payback_weeks(1000.0, 37.0, 1, n, r);
      if (dpp) EXPECT_NEAR(w, *dpp, 1e-9); else EXPECT_LT(w, 0.0);
    }
  EXPECT_NEAR(maos::invest::weekly(0.18), std::pow(1.18, 1.0 / 52.0) - 1.0, 1e-15);
}

// Ручные случаи правила применения: перегруженное узкое место и высокая маржа — станок окупается (ЧДД > 0,
// ДИ > 0, ликвидность не хуже порога); без перегрузки — не окупается.
TEST(InvestA3, MachinePaysOnlyWhenBottleneckBinds) {
  std::vector<Scenario> sc(8); std::vector<uint64_t> seeds;
  for (int i = 0; i < 8; ++i) seeds.push_back(100 + i);
  maos::invest::EvalCfg ec; ec.rule = "EDD"; ec.threads = 2; ec.bootB = 200;
  EnvConfig cfg; cfg.breakdowns = true; cfg.denseReward = false;
  const json pays = maos::invest::evaluate(maos::env::instance_from_json(a3_instance(50, 5e5)), cfg, 0, sc, seeds, ec);
  EXPECT_GT(pays.at("npv_mean").get<double>(), 0.0);
  EXPECT_GT(pays.at("npv_ci95")[0].get<double>(), 0.0);
  EXPECT_TRUE(pays.at("apply").get<bool>());
  ASSERT_FALSE(pays.at("payback_weeks").is_null());
  EXPECT_GT(pays.at("payback_weeks").get<double>(), 2.0);              // не раньше ввода
  const json nopay = maos::invest::evaluate(maos::env::instance_from_json(a3_instance(10, 5e5)), cfg, 0, sc, seeds, ec);
  EXPECT_LT(nopay.at("npv_mean").get<double>(), 0.0);
  EXPECT_FALSE(nopay.at("apply").get<bool>());
  EXPECT_TRUE(nopay.at("payback_weeks").is_null());
  // Кандидаты: TOC-узкое место — B; модернизация того же типа.
  const auto cands = maos::invest::candidates(maos::env::instance_from_json(a3_instance(50, 5e5)), "EDD", {}, 0.0);
  ASSERT_GE(cands.size(), 2u);
  EXPECT_EQ(cands[0].wct, "B");
  EXPECT_EQ(cands[1].kind, "modernize");
}

// Волна A4: наблюдение 80 = 48 признаков A3 (без изменений) + последствия ходов (сверхурочные: чистая выгода =
// Δштрафов + Δпотерь маржи − плата) + таблица взгляда вперёд инвестиций (a3.invest_la) + дескрипторы экземпляра.
TEST(InvestA4, StructObsA4ExtendsA3AndPricesMoves) {
  json j = a3_instance(60, 5e5);
  std::vector<std::vector<double>> row(26, std::vector<double>(4, 0.0));
  row[0] = { 0.5, 0.2, -0.1, 3.0 };
  j["a3"]["invest_la"] = json::array({ row });
  const Instance inst = maos::env::instance_from_json(j);
  EnvConfig c3 = det_cfg(true), c4 = det_cfg(true); c4.structObsA4 = true;
  SimEnv e3(inst, c3), e4(inst, c4);
  ASSERT_EQ(e4.obs_l2_size(), SimEnv::kStructObsA4);
  for (SimEnv* e : { &e3, &e4 }) { e->set_dispatch("EDD", {}); e->reset(5); while (e->level() == 0 && !e->done()) e->run_l0(); }
  const auto& o3 = e3.obs_l2(); const auto& o4 = e4.obs_l2();
  for (int i = 0; i < SimEnv::kStructObs; ++i) EXPECT_FLOAT_EQ(o3[i], o4[i]) << i;
  ASSERT_TRUE(e4.mask_l2()[SimEnv::kSOvertime]);
  EXPECT_GT(o4[50], 0.f);                                              // плата за смену
  EXPECT_NEAR(o4[51], o4[48] + o4[49] - o4[50], 1e-4);
  EXPECT_FLOAT_EQ(o4[56], 0.5f); EXPECT_FLOAT_EQ(o4[58], -0.1f);       // таблица инвестиций, неделя 0
  EXPECT_FLOAT_EQ(o4[72] + o4[73] + o4[74], 1.f);                      // класс — one-hot
}
