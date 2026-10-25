// Блок контрагентского риска (CPR) в расчёте: CVaR-LP с данными сценариев (T4, T17, T18), паспорт и проверка
// диапазонов fin_params.counterparty (T22). METHODOLOGY-V2 §2.6в, §5.2б.
#include "CashLp.h"
#include "CashWaterfall.h"
#include "CounterpartyRisk.h"
#include "InvestApi.h"
#include "InvestEval.h"
#include "SimEnv.h"
#include "MacroSampler.h"
#include "Passport.h"
#include <gtest/gtest.h>
#include <cmath>
#include <limits>
#include <random>
#include <set>
#include <string>

namespace ex = maos::exact;
namespace cl = maos::cashlp;
namespace cw = maos::cash;
namespace cr = maos::cpr;
using nlohmann::json;

namespace {

/* Экземпляр как test_cashlp: S = 2, мощность 100 ч (1 ч/ед.), без рынка (линейная g). */
cl::Problem tiny(int N, int T, unsigned seed, double cv, int runoff = 2) {
  cl::Problem P;
  ex::Problem& b = P.base;
  std::mt19937 rng(seed);
  std::normal_distribution<double> n01(0, 1);
  const int S = 2;
  b.price.assign(N, std::vector<double>(S)); b.cost.assign(N, std::vector<double>(S));
  for (int i = 0; i < N; ++i) { b.price[i] = { 10.0 * (1 + cv * n01(rng)), 8.0 * (1 + cv * n01(rng)) }; b.cost[i] = { 6.0, 5.0 }; }
  b.market.assign(S, ex::Market{});
  b.upper = { 1e9, 1e9 }; b.batch = { 1, 1 }; b.capacity = { 100 };
  b.usage = { { { 0, 1.0 } }, { { 0, 1.0 } } };
  b.alpha = 0.5; b.criterion = ex::Criterion::Cvar;
  P.T = T; P.cp.runoffWeeks = runoff;
  const int TT = T + runoff;
  for (int s = 0; s < S; ++s) {
    P.ship.push_back(cl::uniform_profile(T));
    P.pay.push_back(cl::payment_profile(cl::uniform_profile(T), 0.3, 1, 1, TT));
    P.vatCostShare.push_back(0.4);
  }
  P.fixed.assign(N, std::vector<double>(TT, 20.0));
  P.rate.assign(N, std::vector<double>(TT, 0.003));
  P.cp.tauV = 0.22; P.cp.tauP = 0.25; P.cp.dsoKernel = { 0.0, 0.5, 0.5 }; P.cp.vatPeriodWeeks = 4; P.cp.taxPeriodWeeks = 2;
  P.cp.creditLimit = 500; P.cp.c0 = 50; P.cp.liquidityConstraint = true; P.cp.beta = 0.25; P.cp.lMin = 0;
  return P;
}

/* Данные CPR сценария i из событий (одна сторона или обе). */
void attach(cl::Problem& P, size_t i, const cr::CpEvents& e, const cr::CpParams& p) {
  const size_t N = P.base.price.size();
  const int TT = P.T + P.cp.runoffWeeks;
  if (P.collectI.empty()) { P.collectI.assign(N, {}); P.writeOffI.assign(N, {}); P.payI.assign(N, {}); P.matLossI.assign(N, {}); P.shipI.assign(N, {}); }
  cw::CounterpartyFlows f;
  cr::buyer_flows(e, p, P.cp.dsoKernel, P.cp.tauV, TT, f);
  const cr::LpScenario d = cr::lp_data(e, p, f, P.ship, { { 0.6, 0.4 }, { 1.0, 0.0 } }, { 1, 1 }, 0.3, 1, 1, P.cp.tauV, TT);
  for (const auto& x : d.collect) P.collectI[i].push_back({ x.from, x.to, x.share });
  for (const auto& x : d.writeOff) P.writeOffI[i].push_back({ x.from, x.to, x.share });
  P.payI[i] = d.pay; P.matLossI[i] = d.matLoss; P.shipI[i] = d.ship;
}

cr::CpEvents rich_events(int TT) {
  cr::CpEvents e; e.T = TT;
  e.buyers.resize(2); e.buyers[0].late.assign(TT, 0); e.buyers[1].late.assign(TT, 0);
  e.buyers[0].late[1] = 2; e.buyers[1].defaultWeek = 3;
  e.suppliers.resize(2); e.suppliers[0].disrupt.assign(TT, 0); e.suppliers[1].disrupt.assign(TT, 0);
  e.suppliers[0].disrupt[0] = 2; e.suppliers[1].defaultWeek = 2;
  return e;
}

}  // namespace

// T4: пустые данные CPR → то же решение побитово; события в части сценариев → строки остальных сценариев побайтно те же.
TEST(CashLp, CpEmptyScenarioDataIsBitIdentical) {
  cl::Problem P = tiny(8, 6, 3, 0.2);
  cl::ModelDump d0;
  const cl::Result r0 = cl::solve(P, &d0);
  ASSERT_EQ(r0.status, "optimal") << r0.reason;
  cl::Problem Pe = P;
  Pe.collectI.assign(8, {}); Pe.writeOffI.assign(8, {}); Pe.payI.assign(8, {}); Pe.matLossI.assign(8, {}); Pe.shipI.assign(8, {});
  const cl::Result r1 = cl::solve(Pe);
  EXPECT_EQ(r0.objective, r1.objective); EXPECT_EQ(r0.lpObjective, r1.lpObjective);
  EXPECT_EQ(r0.x, r1.x); EXPECT_EQ(r0.cash, r1.cash); EXPECT_EQ(r0.debt, r1.debt); EXPECT_EQ(r0.profit, r1.profit);
  EXPECT_EQ(r0.liquidityDual, r1.liquidityDual); EXPECT_EQ(r0.creditLimitDual, r1.creditLimitDual);
  ASSERT_EQ(r0.duals.size(), r1.duals.size());
  for (size_t w = 0; w < r0.duals.size(); ++w) EXPECT_EQ(r0.duals[w].shadowPrice, r1.duals[w].shadowPrice);
  // Смешанный случай: события только в сценариях 1 и 5.
  cl::Problem Pm = P;
  cr::CpParams p; p.nBuyers = 2;
  attach(Pm, 1, rich_events(8), p); attach(Pm, 5, rich_events(8), p);
  cl::ModelDump dm;
  const cl::Result rm = cl::solve(Pm, &dm);
  ASSERT_EQ(rm.status, "optimal") << rm.reason;
  ASSERT_EQ(dm.scenarioRows.size(), d0.scenarioRows.size());
  for (size_t i = 0; i < 8; ++i) {
    if (i == 1 || i == 5) EXPECT_NE(dm.scenarioRows[i], d0.scenarioRows[i]) << i;
    else EXPECT_TRUE(dm.scenarioRows[i] == d0.scenarioRows[i]) << "сценарий " << i;
  }
  EXPECT_GT(rm.nCols, r0.nCols);                               // R_{i,t} за горизонтом — только у сценариев со сдвигом
}

// T17: малый экземпляр без налогов, НДС, процентов и разрыва; сценарий с просрочкой и дефолтом покупателя.
// Транши LP передаются в водопад: инкассация (с взысканиями), списания и касса по неделям совпадают с LP.
TEST(CashLp, ConsistentWithWaterfallUnderCounterpartyData) {
  const int N = 4, T = 6, R = 4, TT = T + R;
  cl::Problem P = tiny(N, T, 9, 0.15, R);
  P.cp.tauV = 0; P.cp.tauP = 0; P.cp.c0 = 1e5; P.cp.creditLimit = 0; P.cp.liquidityConstraint = false;
  P.fixed.assign(N, std::vector<double>(TT, 0.0)); P.rate.assign(N, std::vector<double>(TT, 0.0));
  for (auto& v : P.vatCostShare) v = 0.0;                         // все затраты — конверсия при выпуске
  cr::CpParams p; p.nBuyers = 2; p.recoveryLag = 2; p.stopLag = 1; p.replaceLag = 1;
  cr::CpEvents e = rich_events(TT); e.suppliers.clear();          // только покупатели
  std::vector<cw::CounterpartyFlows> fl(N);
  P.collectI.assign(N, {}); P.writeOffI.assign(N, {});
  for (int i = 0; i < N; ++i) {
    cr::buyer_flows(e, p, P.cp.dsoKernel, 0.0, TT, fl[i]);
    for (const auto& x : fl[i].buyerCollect) P.collectI[i].push_back({ x.from, x.to, x.share });
    for (const auto& x : fl[i].buyerWriteOff) P.writeOffI[i].push_back({ x.from, x.to, x.share });
  }
  const cl::Result r = cl::solve(P);
  ASSERT_EQ(r.status, "optimal") << r.reason;
  cw::FinParams fp;
  fp.c0 = 1e5; fp.creditLimit = 0; fp.keyRate = 0; fp.spread = 0; fp.tauV = 0; fp.tauP = 0; fp.tauSoc = 0;
  fp.dsoKernel = P.cp.dsoKernel; fp.leadWeeks = 0; fp.dpoWeeks = 0; fp.payrollWeeks.clear(); fp.autoRepay = false;
  for (int i = 0; i < N; ++i) {
    cw::ScenarioInput in; in.periods.resize(TT); in.cp = fl[i];
    for (int t = 0; t < T; ++t)
      for (int s = 0; s < 2; ++s) {
        in.periods[t].revenue += P.base.price[i][s] * P.ship[s][t] * r.x[s];
        in.periods[t].conversion += P.base.cost[i][s] * r.x[s] * P.ship[s][t];
      }
    for (int t = 0; t < TT; ++t) { in.periods[t].drawdown = r.draw[i][t]; in.periods[t].repayment = r.repay[i][t]; }
    const cw::ScenarioResult w = cw::run(fp, in);
    double wo = 0;
    for (int t = 0; t < TT; ++t) {
      EXPECT_NEAR(w.periods[t].cash, r.cash[i][t], 1e-6 * std::max(1.0, std::fabs(r.cash[i][t]))) << i << " t" << t;
      EXPECT_FALSE(w.periods[t].breach);
      wo += w.periods[t].badDebt + w.periods[t].cpDiscount;
    }
    double lpWo = 0;
    for (const auto& f : P.writeOffI[i])
      if (f.from < T) for (int s = 0; s < 2; ++s) lpWo += f.share * P.base.price[i][s] * P.ship[s][f.from] * r.x[s];
    EXPECT_NEAR(wo, lpWo, 1e-6 * std::max(1.0, lpWo)) << i;
    EXPECT_GT(wo, 0.0);
  }
  // Монотонность: только потери (списания) → цель LP не выше.
  cl::Problem Pn = P; Pn.writeOffI.assign(N, {});
  const cl::Result rn = cl::solve(Pn);
  ASSERT_EQ(rn.status, "optimal");
  EXPECT_LE(r.objective, rn.objective + 1e-9 * std::fabs(rn.objective));
}

// T18: лексикографическая фаза 2 при неединственном CVaR-оптимуме: E[Π] не ниже фазы 1, CVaR в пределах ε;
// PoL_CVaR(L) ≥ 0 и монотонна по L.
TEST(CashLp, LexicographicStep) {
  const int N = 10, T = 4;
  cl::Problem P = tiny(N, T, 1, 0.0);
  P.cp.tauV = 0; P.cp.tauP = 0; P.cp.liquidityConstraint = false;
  P.fixed.assign(N, std::vector<double>(T + 2, 0.0)); P.rate.assign(N, std::vector<double>(T + 2, 0.0));
  for (int i = 0; i < N; ++i) { P.base.price[i] = { 10.0, i == 0 ? 10.0 : 14.0 }; P.base.cost[i] = { 6.0, 6.0 }; }
  P.base.alpha = 0.1;                                             // k = 1: худший сценарий — 4·(x_A + x_B) = 400 при любом x
  const cl::Result ph1 = cl::solve(P);
  cl::Problem Pl = P; Pl.cp.lexicographic = true;
  const cl::Result ph2 = cl::solve(Pl);
  ASSERT_EQ(ph2.status, "optimal"); ASSERT_EQ(ph2.lexStatus, "optimal");
  EXPECT_NEAR(ph2.cvarPhase1, ph1.lpObjective, 1e-6 * std::fabs(ph1.lpObjective));
  EXPECT_GE(ph2.metrics.expected, ph1.metrics.expected - 1e-9);
  EXPECT_NEAR(ph2.metrics.cvar, ph1.metrics.cvar, 1e-6 * std::fabs(ph1.metrics.cvar) + 1e-7 * std::max(1.0, std::fabs(ph1.metrics.cvar)));
  EXPECT_NEAR(ph2.x[1], 100.0, 1e-6);                            // E[Π] выбирает изделие B
  // Цена ликвидности по CVaR на сетке L (лексикографически): ≥ 0 и не убывает.
  cl::Problem Pc = tiny(N, T, 5, 0.2);
  Pc.cp.lexicographic = true; Pc.cp.c0 = 0; Pc.cp.creditLimit = 0; Pc.cp.dsoKernel = { 0.0, 0.0, 1.0 };
  Pc.cp.liquidityConstraint = false; Pc.fixed.assign(N, std::vector<double>(T + 2, 0.0));
  const cl::Result free = cl::solve(Pc);
  ASSERT_EQ(free.status, "optimal");
  double prev = -1e-9;
  for (double L : { free.cfar, free.cfar * 0.5, free.cfar * 0.25, 0.0 }) {
    cl::Problem Pk = Pc; Pk.cp.liquidityConstraint = true; Pk.cp.lMin = L;
    const cl::Result rk = cl::solve(Pk);
    ASSERT_EQ(rk.status, "optimal") << L;
    const double pol = free.cvarPhase1 - rk.cvarPhase1;
    EXPECT_GE(pol, -1e-6 * std::max(1.0, std::fabs(free.cvarPhase1))) << L;
    EXPECT_GE(pol, prev - 1e-6 * std::max(1.0, std::fabs(free.cvarPhase1))) << L;
    prev = pol;
  }
  EXPECT_GT(prev, 0.0);                                           // при L = 0 ограничение действует (C_min < 0 без него)
}

// T22: у каждого ключа CpParams — строка паспорта fin.cp.* с допустимым статусом, источником и местом в коде;
// PUT /api/fin_params (save_fin_params) отклоняет значения вне диапазонов.
TEST(Passport, CounterpartyRowsAndValidation) {
  Database db(":memory:");
  db.exec("CREATE TABLE optimization_runs(id TEXT PRIMARY KEY)");
  maos::passport::migrate(db);
  const std::set<std::string> ok = { "Н", "О", "К", "НОРМ", "техн." };
  std::set<std::string> codes;
  for (auto& r : maos::passport::passport_list(db)) codes.insert(r.value("code", std::string()));
  for (auto& [k, v] : cr::CpParams{}.to_json().items()) {
    const std::string code = "fin.cp." + k;
    ASSERT_TRUE(codes.count(code)) << "нет строки паспорта " << code;
    const json row = db.query_one("SELECT status, source, file_ref FROM param_passport WHERE code=?", { code });
    EXPECT_TRUE(ok.count(row.value("status", std::string()))) << code << " " << row.dump();
    EXPECT_FALSE(row.value("source", std::string()).empty()) << code;
    EXPECT_FALSE(row.value("file_ref", std::string()).empty()) << code;
  }
  EXPECT_TRUE(codes.count("rl.cp.enabled"));
  EXPECT_TRUE(codes.count("fin.cp.suppliers"));
  // Значения по умолчанию: выключено; GET отдаёт действующие значения.
  json fin = maos::passport::fin_params_json(db);
  ASSERT_TRUE(fin["counterparty"].is_object());
  EXPECT_FALSE(fin["counterparty"]["enabled"].get<bool>());
  EXPECT_NEAR(fin["counterparty"]["buyer_pd_annual"].get<double>(), 0.04, 1e-15);
  const std::vector<json> bad = {
    { {"buyer_pd_annual", 1.5} }, { {"supplier_pd_annual", -0.1} }, { {"rho", 1.2} }, { {"late_rho", 0.995} },
    { {"recovery_lag_weeks", 600} }, { {"stop_lag_weeks", -1} }, { {"late_tail_alpha", 0} }, { {"disrupt_tail_alpha", -2} },
    { {"late_share", 1.2} }, { {"buyer_lgd", -0.1} }, { {"buyer_shares", { 0.5, 0.3 }} }, { {"theta_min", 2} },
    // неизвестный ключ, неверный тип, переполнение целого, кризисный режим вне [0, k), > 1000 покупателей,
    // излеченная просрочка выше D_def, нестроковая группа поставщика
    { {"buyer_pd", 0.5} }, { {"buyer_pd_annual", "0.5"} }, { {"enabled", "yes"} }, { {"recovery_lag_weeks", 4294967296.0} },
    { {"late_max_weeks", 1e9} }, { {"crisis_regime", 5} }, { {"buyer_shares", std::vector<double>(1001, 1.0 / 1001)} },
    { {"late_max_weeks", 20} }, { {"default_dpd_weeks", 0} }, { {"supplier_groups", { {"raw-00", 1} }} },
    { {"disrupt_rho", 1.5} }, { {"late_buyer_loading", 1.2} }, { {"tax_bad_debt", "deferred"} } };
  for (const json& b : bad)
    EXPECT_THROW(maos::passport::save_fin_params(db, json{ {"counterparty", b} }), std::runtime_error) << b.dump();
  EXPECT_THROW(maos::passport::counterparty_params(maos::passport::fin_params_json(db), json{ {"rho", 5} }), std::runtime_error);
  // Допустимо: булево числом 0/1, группировка позиций, «stream» из GET (только чтение) игнорируется.
  fin = maos::passport::save_fin_params(db, json{ {"counterparty", { {"lexicographic", 0}, {"supplier_groups", { {"raw-00", "V1"} }},
                                                                      {"stream", 999} }} });
  EXPECT_EQ(fin["counterparty"]["supplier_groups"]["raw-00"], "V1");
  EXPECT_EQ(fin["counterparty"]["stream"].get<int>(), 915);
  fin = maos::passport::save_fin_params(db, json{ {"counterparty", { {"enabled", true}, {"buyer_shares", { 0.5, 0.3, 0.2 }} }} });
  EXPECT_TRUE(fin["counterparty"]["enabled"].get<bool>());
  EXPECT_EQ(fin["counterparty"]["buyer_shares"].size(), 3u);
  fin = maos::passport::save_fin_params(db, json{ {"counterparty", { {"late_share", 0.2} }} });   // частичное — поверх сохранённого
  EXPECT_TRUE(fin["counterparty"]["enabled"].get<bool>());
  EXPECT_NEAR(fin["counterparty"]["late_share"].get<double>(), 0.2, 1e-15);
  // fin_override на запрос: проверка диапазонов и неизвестных ключей, БД не меняется.
  EXPECT_THROW(maos::passport::fin_params_with_override(db, json{ {"pd", 2} }), std::runtime_error);
  EXPECT_THROW(maos::passport::fin_params_with_override(db, json{ {"no_such", 1} }), std::runtime_error);
  const json ov = maos::passport::fin_params_with_override(db, json{ {"pd", 0}, {"counterparty", { {"enabled", false} }} });
  EXPECT_NEAR(ov["pd"].get<double>(), 0.0, 1e-15);
  EXPECT_FALSE(ov["counterparty"]["enabled"].get<bool>());
  EXPECT_TRUE(maos::passport::fin_params_json(db)["counterparty"]["enabled"].get<bool>());
}

// T19: перебой на плановом приходе (τ_o + L) по материалу j в сценарии s — durMC[s][supply_k] растёт на задержку сверх
// запаса до срока supply-джобы (доля срока материала): ровно 20160 мин при доле 1; остальные джобы и сценарии не
// меняются; дефолт поставщика до прихода — задержка τ_j + ℓ_rep − τ_o.
TEST(Scheduler, SupplyDelayInjection) {
  cr::CpParams p; p.replaceSupplierLag = 2;
  const int N = 3, J = 12, L = 1;
  std::vector<std::vector<double>> dur(N, std::vector<double>(J));
  for (int s = 0; s < N; ++s) for (int j = 0; j < J; ++j) dur[s][j] = 100.0 + 7 * s + j;
  const auto base = dur;
  std::vector<cr::CpEvents> ev(N);
  for (auto& e : ev) { e.T = 10; e.suppliers.resize(2); for (auto& sp : e.suppliers) sp.disrupt.assign(10, 0); }
  ev[1].suppliers[0].disrupt[1] = 2; ev[1].suppliers[0].disrupt[2] = 1;   // перебой [1, 3) у материала j0 в сценарии 1
  ev[2].suppliers[1].defaultWeek = 1;                             // дефолт j1 до прихода (τ_o + L = 1) → τ_j + 2 − 0 = 3
  ev[0].suppliers[0].disrupt[4] = 4;                              // перебой у прихода недели 4 — заказы недели 0 не задеты
  const std::vector<std::vector<int>> mats{ { 0 }, { 1 }, { 0, 1 }, {} };
  const std::vector<std::vector<double>> share{ { 1.0 }, { 1.0 }, { 0.5, 1.0 }, {} };
  const std::vector<int> supplyJob{ 5, 9, 11, -1 };
  const auto X = cr::stage1_apply(ev, p, mats, share, std::vector<int>(4, 0), L, supplyJob, dur);
  EXPECT_EQ(X[1][0], 20160.0); EXPECT_EQ(X[1][1], 0.0); EXPECT_EQ(X[1][2], 20160.0 - 0.5 * base[1][11]);
  EXPECT_EQ(X[2][1], 30240.0); EXPECT_EQ(X[2][2], 30240.0); EXPECT_EQ(X[2][0], 0.0);
  EXPECT_EQ(X[0][0], 0.0);
  for (int s = 0; s < N; ++s)
    for (int j = 0; j < J; ++j) {
      double add = 0;
      if (s == 1 && j == 5) add = 20160;
      if (s == 1 && j == 11) add = 20160.0 - 0.5 * base[1][11];
      if (s == 2 && (j == 9 || j == 11)) add = 3 * 10080;
      EXPECT_EQ(dur[s][j], base[s][j] + add) << s << " " << j;
    }
  for (int s = 0; s < N; ++s) EXPECT_EQ(cr::stage1_delay(ev[s], p, { 0, 1 }, L, 0), s == 0 ? 0 : (s == 1 ? 2 : 3));
}

// T20: одни и те же события поставщиков для сценария id в Стадии 1 и Стадии 2 — путь режимов MacroSampler по id
// не зависит от числа путей и горизонта (префикс), розыгрыш — от числа покупателей и горизонта событий.
TEST(CrossStage, SameEventsForScenarioId) {
  const auto ms = maos::macro::MacroSampler::load(std::string(MAOS_TEST_FIXTURES) + "/macro_params_small.json");
  cr::CpParams p; p.disruptShare = 0.3; p.supplierPd = 0.3;
  p.apply_generator(ms.params());
  const auto r1 = ms.sample(40, 42, 9);                            // Стадия 2: N = 40, горизонт 9 недель
  const auto r2 = ms.sample(7, 42, 26);                            // Стадия 1: N = 7, горизонт 26 недель
  const auto m1 = cr::resolve_regimes(r1.paths.regime, r1.paths.blockId, ms.params(), p.crisisIndex);
  const auto m2 = cr::resolve_regimes(r2.paths.regime, r2.paths.blockId, ms.params(), p.crisisIndex);
  const std::vector<uint32_t> ent{ cr::entity_of("raw-00"), cr::entity_of("raw-01"), cr::entity_of("rod") };
  for (int s = 0; s < 7; ++s) {
    for (size_t m = 0; m < m1[s].size(); ++m) ASSERT_EQ(m1[s][m], m2[s][m]) << s << " month " << m;
    const cr::CpEvents a = cr::draw(p, 42, s, m1[s], 0, 12, 10, ent);   // TT Стадии 2, покупатели есть
    const cr::CpEvents b = cr::draw(p, 42, s, m2[s], 0, 52, 0, ent);    // Стадия 1: только поставщики
    for (size_t j = 0; j < ent.size(); ++j) {
      EXPECT_TRUE(std::equal(a.suppliers[j].disrupt.begin(), a.suppliers[j].disrupt.end(), b.suppliers[j].disrupt.begin())) << s;
      EXPECT_EQ(a.suppliers[j].defaultWeek, b.suppliers[j].defaultWeek < 12 ? b.suppliers[j].defaultWeek : -1) << s;
    }
    EXPECT_EQ(a.z, b.z);
  }
}

namespace {

/* Цех для SimEnv: P ← (Q покупной, дефицит, срок 200 ч; цена 30) и S ← (R покупной, срок 60 ч; цена 10). */
json cp_env_instance() {
  json ops_s = json::array({ { {"id","os"}, {"name","os"}, {"wc_types", json::array({"A"})}, {"t_exp",60}, {"sigma",6},
                               {"inputs", json::array({ json::array({"R", 1.0}) })} } });
  json ops_p = json::array({ { {"id","op1"}, {"name","op1"}, {"wc_types", json::array({"B"})}, {"t_exp",90}, {"sigma",9},
                               {"inputs", json::array({ json::array({"Q", 1.0}) })} } });
  return {
    {"name", "cp-env"},
    {"wc_types", json::array({ { {"id","A"}, {"name","A"} }, { {"id","B"}, {"name","B"} } })},
    {"machines", json::array({ { {"id","a1"}, {"wct","A"} }, { {"id","b1"}, {"wct","B"} } })},
    {"products", json::array({
      { {"id","S"}, {"batch_size",1}, {"ops", ops_s} }, { {"id","P"}, {"batch_size",1}, {"ops", ops_p} },
      { {"id","R"}, {"batch_size",1}, {"purchased", true}, {"stock", 0}, {"lead_hours", 60}, {"base_cost", 10} },
      { {"id","Q"}, {"batch_size",1}, {"purchased", true}, {"stock", 0}, {"lead_hours", 200}, {"base_cost", 30} } })},
    {"workers", json::array()},
    {"orders", json::array({ { {"product_id","P"}, {"qty",4}, {"due_h",500}, {"price",1000}, {"mat_cost",30} },
                             { {"product_id","S"}, {"qty",3}, {"due_h",500}, {"price",200}, {"mat_cost",10} } })},
    {"fin", { {"c0", 5000}, {"credit_limit", 5000}, {"prepay_share", 0.5}, {"lead_weeks", 1}, {"dpo_weeks", 1} }},
    {"tail_weight", 0.0},
  };
}

/* Сценарий с событиями: покупатель 0 — дефолт в неделю 1; поставщик Q — перебой [1, 3) (плановый приход заказа недели 0
   при fin.lead_weeks = 1 сдвигается на 2 недели). */
json cp_scenario(bool disrupt, bool buyerDefault) {
  cr::CpEvents e; e.T = 52;
  e.buyers.resize(2); for (auto& b : e.buyers) b.late.assign(52, 0);
  if (buyerDefault) e.buyers[0].defaultWeek = 1;
  e.buyers[1].late[0] = 3;
  e.suppliers.resize(2);
  e.suppliers[0].entity = cr::entity_of("Q"); e.suppliers[1].entity = cr::entity_of("R");
  for (auto& sp : e.suppliers) sp.disrupt.assign(52, 0);
  if (disrupt) { e.suppliers[0].disrupt[1] = 2; e.suppliers[0].disrupt[2] = 1; }
  cr::CpParams p; p.enabled = true; p.nBuyers = 2;
  return { {"idx", 0}, {"cp", { {"events", cr::events_to_json(e)}, {"params", p.to_json()} }} };
}

json run_det(maos::env::SimEnv& env, const json& sc) {
  env.reset(7, maos::env::Scenario::from_json(sc));
  while (!env.done()) { if (env.level() == 2) env.step(0); else env.step_job(env.rule_choice("EDD")); }
  return env.summary();
}

}  // namespace

// T21: SimEnv со сценарием CPR — вход водопада несёт те же потоки, что buyer_flows/supplier_plan, и его прогон даёт
// прибыль эпизода; срыв поставки сдвигает финиш заказа; InvestEval с «пустышкой» — нулевые парные разности.
TEST(SimEnv, CounterpartyScenarioConsistency) {
  using namespace maos::env;
  const Instance inst = instance_from_json(cp_env_instance());
  EnvConfig c; c.mode = EpochMode::Serial; c.deterministic = true; c.breakdowns = false;
  SimEnv env(inst, c);
  const json sc = cp_scenario(true, true);
  const json sum = run_det(env, sc);
  ASSERT_FALSE(sum["counterparty"].is_null());
  EXPECT_GT(sum["counterparty"]["bad_debt"].get<double>(), 0.0);
  const int taxP = std::max(1, inst.fin.taxPeriodWeeks), TT = ((c.horizonWeeks + taxP - 1) / taxP) * taxP;
  const cw::ScenarioInput in = env.cash_input(TT);
  cw::CounterpartyFlows ref;
  const Scenario S = Scenario::from_json(sc);
  cr::buyer_flows(S.cpEvents, S.cpParams, inst.fin.dsoKernel, inst.fin.tauV, TT, ref);
  ASSERT_EQ(in.cp.buyerCollect.size(), ref.buyerCollect.size());
  for (size_t k = 0; k < ref.buyerCollect.size(); ++k) {
    EXPECT_EQ(in.cp.buyerCollect[k].from, ref.buyerCollect[k].from); EXPECT_EQ(in.cp.buyerCollect[k].to, ref.buyerCollect[k].to);
    EXPECT_EQ(in.cp.buyerCollect[k].share, ref.buyerCollect[k].share);
  }
  EXPECT_FALSE(in.cp.supplyArrive.empty());                         // срыв Q → план закупок по частям
  const cw::ScenarioResult wr = cw::run(inst.fin, in);
  EXPECT_DOUBLE_EQ(wr.profit, sum["profit"].get<double>());
  EXPECT_LE(wr.residuals.max(), 1e-6 * 1e4);
  // Срыв поставки Q на 2 недели: заказ P (Q в дефиците) заканчивается не раньше чем на 2 недели позже.
  const json noDis = run_det(env, cp_scenario(false, true));
  EXPECT_GE(sum["makespan_h"].get<double>(), noDis["makespan_h"].get<double>() + 2 * 168.0 - 1e-6);
  // Без CPR (тот же экземпляр) — поля counterparty нет, эпизод как раньше.
  const json plain = run_det(env, json{ {"idx", 0} });
  EXPECT_TRUE(plain["counterparty"].is_null());
  // InvestEval: «пустышка» (модернизация без эффекта, CAPEX 0) — нулевые парные разности на одних событиях.
  json ji = cp_env_instance();
  ji["a3"] = { {"invest_cands", json::array({ { {"id","noop"}, {"kind","modernize"}, {"wct","B"}, {"capex",0}, {"lead_weeks",0},
                                                {"mtbf_mul",1.0}, {"repair_mul",1.0}, {"opex_weekly",0} } })} };
  std::vector<Scenario> scen{ Scenario::from_json(cp_scenario(true, true)), Scenario::from_json(cp_scenario(false, true)) };
  maos::invest::EvalCfg ec; ec.rule = "EDD"; ec.threads = 1; ec.bootB = 50;
  EnvConfig ci; ci.breakdowns = false; ci.deterministic = true; ci.denseReward = false;
  const json ev = maos::invest::evaluate(instance_from_json(ji), ci, 0, scen, { 3, 4 }, ec);
  EXPECT_NEAR(ev["d_profit_mean"].get<double>(), 0.0, 1e-9);
  EXPECT_NEAR(ev["npv_mean"].get<double>(), 0.0, 1e-6);
}

// Серверная инвестаналитика при fin.cp.enabled: сценарии набора несут события контрагентов на координатах
// [seed, 915, i, …] (те же, что Стадия 2 и стенд); наборы A и B — на своих seed; без CPR — сценарии без cp.
TEST(InvestApi, CounterpartyScenariosShareCoordinates) {
  const auto ms = maos::macro::MacroSampler::load(std::string(MAOS_TEST_FIXTURES) + "/macro_params_small.json");
  cr::CpParams cp; cp.enabled = true; cp.disruptShare = 0.2; cp.supplierPd = 0.3;
  cp.apply_generator(ms.params());
  const std::vector<uint32_t> ent{ cp.supplier_entity("raw-00"), cp.supplier_entity("raw-01") };
  const int n = 6, weeks = 26;
  const auto a = maos::invest::macro_scenarios(&ms, n, 77, weeks, &cp, ent);
  const auto b = maos::invest::macro_scenarios(&ms, n, 78, weeks, &cp, ent);
  const auto r = ms.sample(n, 77, weeks);
  const auto months = cr::resolve_regimes(r.paths.regime, r.paths.blockId, ms.params(), cp.crisisIndex);
  int differ = 0;
  for (int i = 0; i < n; ++i) {
    ASSERT_TRUE(a[i].hasCp);
    const cr::CpEvents ref = cr::draw(cp, 77, i, months[i], std::numeric_limits<double>::quiet_NaN(), 52,
                                      (int)cp.buyer_weights().size(), ent);
    EXPECT_EQ(cr::events_to_json(a[i].cpEvents), cr::events_to_json(ref)) << i;
    differ += cr::events_to_json(a[i].cpEvents) != cr::events_to_json(b[i].cpEvents);
  }
  EXPECT_GT(differ, 0);
  const auto off = maos::invest::macro_scenarios(&ms, n, 77, weeks, nullptr, ent);
  for (const auto& s : off) EXPECT_FALSE(s.hasCp);
  for (int i = 0; i < n; ++i) EXPECT_EQ(off[i].keyRate, a[i].keyRate);   // макро-путь не зависит от CPR
}
