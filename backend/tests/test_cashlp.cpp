// CVaR-LP с кассой (CashLp) — METHODOLOGY-V2 §5.2: совпадение с ExactCvar без кассы,
// крошечный экземпляр с известным оптимумом, активное ограничение ликвидности →
// двойственная > 0, рекурс vs «график заранее», OOS на свежих сценариях.
#include "CashLp.h"
#include <gtest/gtest.h>
#include <cmath>
#include <random>

namespace ex = maos::exact;
namespace cl = maos::cashlp;

namespace {

/* Экземпляр: S изделий, одна мощность 100 ч (1 ч/ед.), рынок не задан (линейная g). */
cl::Problem tiny(int N, int T, unsigned seed, double cv = 0.0) {
  cl::Problem P;
  ex::Problem& b = P.base;
  std::mt19937 rng(seed);
  std::normal_distribution<double> n01(0, 1);
  const int S = 2;
  b.price.assign(N, std::vector<double>(S)); b.cost.assign(N, std::vector<double>(S));
  for (int i = 0; i < N; ++i) {
    b.price[i] = { 10.0 * (1 + cv * n01(rng)), 8.0 * (1 + cv * n01(rng)) };
    b.cost[i]  = { 6.0, 5.0 };
  }
  b.market.assign(S, ex::Market{});
  b.upper = { 1e9, 1e9 }; b.batch = { 1, 1 };
  b.capacity = { 100 };
  b.usage = { { { 0, 1.0 } }, { { 0, 1.0 } } };
  b.alpha = 0.5; b.criterion = ex::Criterion::Cvar;
  P.T = T;
  P.cp.runoffWeeks = 1;
  const int TT = T + 1;
  for (int s = 0; s < S; ++s) {
    P.ship.push_back(cl::uniform_profile(T));
    P.pay.push_back(cl::payment_profile(cl::uniform_profile(T), 0.0, 0, 0, TT));
    P.vatCostShare.push_back(0.0);
  }
  P.fixed.assign(N, std::vector<double>(TT, 0.0));
  P.rate.assign(N, std::vector<double>(TT, 0.0));
  P.cp.tauV = 0; P.cp.tauP = 0; P.cp.dsoKernel = { 0.0, 1.0 };   // оплата через неделю
  P.cp.liquidityConstraint = false; P.cp.beta = 0.5;
  return P;
}

}  // namespace

TEST(CashLp, WithoutCashConstraintsMatchesExactCvar) {
  cl::Problem P = tiny(40, 4, 7, 0.15);
  const cl::Result r = cl::solve(P);
  ASSERT_EQ(r.status, "optimal") << r.reason;
  const ex::Result e = ex::solve(P.base);
  ASSERT_EQ(e.status, "optimal");
  EXPECT_NEAR(r.objective, e.objective, 1e-6 * std::fabs(e.objective));
  EXPECT_NEAR(r.x[0] + r.x[1], 100, 1e-6);
  EXPECT_NEAR(r.metrics.expected, e.metrics.expected, 1e-6 * std::fabs(e.metrics.expected));
  // Без ограничения ликвидности кредит не выбирается (проценты — чистый расход).
  for (int t = 0; t < 5; ++t) EXPECT_NEAR(r.draw[0][t], 0, 1e-6);
}

TEST(CashLp, TinyInstanceWithKnownOptimum) {
  // 1 изделие по сути (второе невыгодно по CVaR? нет — оба линейны: 10−6=4 > 8−5=3 →
  // всё в изделие 0), x=100, выручка 1000 приходит через неделю, себестоимость 600
  // платится по 300 в недели 1–2. Касса ≥ 0 в худшем сценарии (β=0.5, N=2 → k=1) →
  // транш 300 в t=0, погашение 197 в t=1 при ставке 1 %/нед: проценты 3 + 1.03.
  cl::Problem P = tiny(2, 2, 1);
  P.cp.liquidityConstraint = true; P.cp.lMin = 0; P.cp.creditLimit = 1000;
  for (auto& rr : P.rate) rr.assign(3, 0.01);
  const cl::Result r = cl::solve(P);
  ASSERT_EQ(r.status, "optimal") << r.reason;
  EXPECT_NEAR(r.x[0], 100, 1e-6); EXPECT_NEAR(r.x[1], 0, 1e-6);
  EXPECT_NEAR(r.draw[0][0], 300, 1e-5);
  EXPECT_NEAR(r.debt[0][1], 103, 1e-5);
  EXPECT_NEAR(r.interestTotal[0], 3 + 1.03, 1e-5);
  EXPECT_NEAR(r.objective, 400 - 4.03, 1e-5);
  EXPECT_NEAR(r.cfar, 0, 1e-6);
  EXPECT_GE(r.minCash[0], -1e-6);
  // Без лимита кредита ограничение ликвидности заставляет x = 0: цена ликвидности = 400.
  cl::Problem P0 = P; P0.cp.creditLimit = 0;
  const cl::Result r0 = cl::solve(P0);
  ASSERT_EQ(r0.status, "optimal") << r0.reason;
  EXPECT_NEAR(r0.objective, 0, 1e-6);
  EXPECT_LT(r0.liquidityDual, -1e-6);                     // ∂F/∂L_min < 0 → цена ликвидности > 0
  EXPECT_TRUE(r0.liquidityBinding);
  // «График заранее» на одинаковых сценариях совпадает с рекурсом.
  cl::Problem P1 = P; P1.cp.firstStage = true;
  const cl::Result r1 = cl::solve(P1);
  ASSERT_EQ(r1.status, "optimal") << r1.reason;
  EXPECT_NEAR(r1.objective, r.objective, 1e-6);
}

TEST(CashLp, LiquidityConstraintIsPricedAndFixedScheduleIsNoBetter) {
  cl::Problem P = tiny(60, 4, 3, 0.2);
  P.cp.liquidityConstraint = true; P.cp.lMin = -50; P.cp.creditLimit = 200; P.cp.beta = 0.1;
  for (auto& rr : P.rate) rr.assign(5, 0.005);
  for (auto& f : P.fixed) f.assign(5, 40.0);
  const cl::Result free = cl::solve(tiny(60, 4, 3, 0.2));
  const cl::Result rec = cl::solve(P);
  cl::Problem Pf = P; Pf.cp.firstStage = true;
  const cl::Result fix = cl::solve(Pf);
  ASSERT_EQ(rec.status, "optimal") << rec.reason;
  ASSERT_EQ(fix.status, "optimal") << fix.reason;
  EXPECT_GE(rec.cfar, -50 - 1e-6);
  EXPECT_LE(rec.objective, free.objective + 1e-9);        // цена ликвидности ≥ 0
  EXPECT_LE(fix.objective, rec.objective + 1e-6);         // негибкое финансирование не лучше рекурса
  EXPECT_LE(rec.liquidityDual, 1e-12);
  // Двойственные по мощности — один ресурс, он связывающий.
  ASSERT_EQ(rec.duals.size(), 1u);
  EXPECT_TRUE(rec.duals[0].binding);
  EXPECT_GT(rec.duals[0].shadowPrice, 0);
}

TEST(CashLp, OutOfSampleProfitOnFreshSeedIsClose) {
  cl::Problem P = tiny(200, 4, 11, 0.1);
  const cl::Result r = cl::solve(P);
  ASSERT_EQ(r.status, "optimal") << r.reason;
  const cl::Problem P2 = tiny(200, 4, 11 + 9973, 0.1);
  const ex::Metrics oos = ex::evaluate_on(P.base, P2.base.price, P2.base.cost, r.x);
  EXPECT_NEAR(oos.expected, r.metrics.expected, 0.1 * std::fabs(r.metrics.expected));
}

TEST(CashLp, PaymentProfileConservesMass) {
  const auto psi = cl::payment_profile({ 0.25, 0.25, 0.25, 0.25 }, 0.3, 1, 2, 7);
  double s = 0; for (double v : psi) s += v;
  EXPECT_NEAR(s, 1.0, 1e-12);
  EXPECT_NEAR(psi[0], 0.3 * 0.25 * 2, 1e-12);            // предоплата недель 0 и 1 (lead 1 → в 0)
  EXPECT_NEAR(psi[5], 0.7 * 0.25, 1e-12);                 // остаток недели 3 через DPO 2
}
