// Блок контрагентского риска (CPR, CounterpartyRisk + ветка событий CashWaterfall) — METHODOLOGY-V2 §2.6в, §4.3, §4.6:
// нулевой риск → пустые потоки и старая ветка побитово (T1, T2), ручные случаи просрочки, дефолта покупателя и
// поставщика, срыва поставки (T7–T10), время дефолта = t_ex рукописи (T11), нормировка режимов (T12), статистика
// копулы Васичека и задержек Ломакса (T13, T14), CRN (T15), тождества на случайных событиях (T16), проверка
// генератора по режимам (T24 — проверка реализации, не валидация: все параметры [К]/[НОРМ]).
#include "CashWaterfall.h"
#include "CounterpartyRisk.h"
#include <gtest/gtest.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>
#include <random>

namespace cw = maos::cash;
namespace cr = maos::cpr;

namespace {

/* Параметры, при которых событий нет ни при каких числах. */
cr::CpParams zero_risk() {
  cr::CpParams p; p.enabled = true;
  p.buyerPd = 0; p.supplierPd = 0; p.lateShare = 0; p.disruptShare = 0;
  return p;
}

/* Случайные финпараметры и входы — генератор IdentitiesHoldOnRandomInputs (test_cashwaterfall.cpp). */
struct RandomCase { cw::FinParams fp; cw::ScenarioInput in; double scale = 1; };
RandomCase random_case(std::mt19937& rng, bool legacyDefault) {
  std::uniform_real_distribution<double> u(0, 1);
  RandomCase c;
  cw::FinParams& fp = c.fp;
  fp.c0 = 500 * u(rng); fp.cMin = 50 * u(rng); fp.creditLimit = u(rng) < 0.3 ? 0 : 2000 * u(rng);
  fp.d0 = u(rng) < 0.5 ? 0 : fp.creditLimit * u(rng);
  fp.keyRate = 0.3 * u(rng); fp.spread = 0.05 * u(rng); fp.overdraftSpread = 0.2 * u(rng);
  fp.overdraftLimit = u(rng) < 0.5 ? 0 : 300 * u(rng);
  fp.tauV = 0.22; fp.tauP = 0.25; fp.tauSoc = 0.30; fp.propertyTaxWeekly = 3 * u(rng);
  fp.dsoKernel = { 0.2 * u(rng), 0.4 * u(rng), 0.3 * u(rng), 0.1 * u(rng) };
  fp.prepayShare = u(rng) < 0.5 ? 0 : 0.5 * u(rng);
  fp.dpoWeeks = (int)(4 * u(rng)); fp.leadWeeks = (int)(3 * u(rng));
  fp.vatPeriodWeeks = 1 + (int)(13 * u(rng)); fp.vatInstalments = 1 + (int)(3 * u(rng));
  fp.vatInstalmentLagWeeks = (int)(5 * u(rng)); fp.taxPeriodWeeks = 1 + (int)(8 * u(rng));
  if (u(rng) < 0.3) fp.payrollWeeks.clear();
  fp.autoRepay = u(rng) < 0.5; fp.taxCumulative = u(rng) < 0.5;
  const int T = 4 + (int)(30 * u(rng));
  c.scale = fp.c0 + fp.creditLimit + 1;
  for (int t = 0; t < T; ++t) {
    cw::PeriodInput p;
    p.revenue = 300 * u(rng); p.cogs = 150 * u(rng); p.orders = 200 * u(rng);
    p.rawConsumed = 150 * u(rng); p.payrollGross = 60 * u(rng); p.energy = 30 * u(rng); p.conversion = 40 * u(rng);
    p.logistics = 20 * u(rng); p.repairPlanned = 10 * u(rng); p.repairBreakdown = u(rng) < 0.2 ? 80 * u(rng) : 0;
    p.otherFixed = 5 * u(rng); p.depreciation = 8 * u(rng); p.capex = u(rng) < 0.1 ? 400 * u(rng) : 0;
    p.plannedRepayment = u(rng) < 0.3 ? 100 * u(rng) : 0;
    if (u(rng) < 0.2) p.drawdown = 100 * u(rng);
    if (u(rng) < 0.1) p.repayment = 50 * u(rng);
    if (u(rng) < 0.5) p.keyRate = 0.3 * u(rng);
    c.scale += p.revenue + p.orders + p.capex;
    c.in.periods.push_back(p);
  }
  if (legacyDefault && u(rng) < 0.3) { c.in.defaultWeek = 1 + (int)(T * u(rng)); c.in.lgd = u(rng); }
  return c;
}

void expect_periods_equal(const cw::PeriodState& a, const cw::PeriodState& b, int rep) {
  using P = cw::PeriodState;
  static const double P::* kFields[] = {
    &P::cash, &P::netCash, &P::debt, &P::undrawn, &P::overdraft, &P::drawdown, &P::repayment, &P::interest,
    &P::collections, &P::payMat, &P::payLog, &P::payLab, &P::payEn, &P::payRep, &P::payBrk, &P::payOther,
    &P::vatPay, &P::tax, &P::capex, &P::ar, &P::ap, &P::invRaw, &P::invFg, &P::invTransit, &P::wc, &P::arrears,
    &P::revenue, &P::ebitda, &P::ebit, &P::ebt, &P::profitAcc, &P::cfOp, &P::badDebt, &P::nol, &P::vatOut, &P::vatIn,
    &P::dscr, &P::icr, &P::recoveries, &P::cpDiscount, &P::supLoss, &P::sc };
  for (size_t k = 0; k < sizeof(kFields) / sizeof(kFields[0]); ++k)
    EXPECT_EQ(a.*kFields[k], b.*kFields[k]) << "rep " << rep << " field " << k;   // побитово (==), не NEAR
  EXPECT_EQ(a.breach, b.breach); EXPECT_EQ(a.covenantBreach, b.covenantBreach);
}

void expect_results_equal(const cw::ScenarioResult& a, const cw::ScenarioResult& b, int rep) {
  ASSERT_EQ(a.periods.size(), b.periods.size());
  for (size_t t = 0; t < a.periods.size(); ++t) expect_periods_equal(a.periods[t], b.periods[t], rep);
  EXPECT_EQ(a.minCash, b.minCash); EXPECT_EQ(a.maxDebt, b.maxDebt); EXPECT_EQ(a.totalInterest, b.totalInterest);
  EXPECT_EQ(a.minDscr, b.minDscr); EXPECT_EQ(a.dscr, b.dscr); EXPECT_EQ(a.profit, b.profit); EXPECT_EQ(a.taxPaid, b.taxPaid);
  EXPECT_EQ(a.wcAvg, b.wcAvg); EXPECT_EQ(a.npvOwner, b.npvOwner); EXPECT_EQ(a.npvBank, b.npvBank);
  EXPECT_EQ(a.tBreach, b.tBreach); EXPECT_EQ(a.breach, b.breach); EXPECT_EQ(a.covenantBreach, b.covenantBreach);
  EXPECT_EQ(a.residuals.cash, b.residuals.cash); EXPECT_EQ(a.residuals.reconciliation, b.residuals.reconciliation);
  EXPECT_EQ(a.residuals.receivables, b.residuals.receivables); EXPECT_EQ(a.residuals.material, b.residuals.material);
  EXPECT_EQ(a.residuals.npvDecomposition, b.residuals.npvDecomposition);
  EXPECT_EQ(a.badDebt, b.badDebt); EXPECT_EQ(a.recoveries, b.recoveries); EXPECT_EQ(a.revenueVat, b.revenueVat);
}

void expect_identities(const cw::ScenarioResult& r, double scale, int rep) {
  const auto& z = r.residuals;
  const double tol = 1e-9 * scale;
  EXPECT_LE(z.cash, tol) << rep; EXPECT_LE(z.reconciliation, tol) << rep; EXPECT_LE(z.receivables, tol) << rep;
  EXPECT_LE(z.debt, tol) << rep; EXPECT_LE(z.interest, tol) << rep; EXPECT_LE(z.npvDecomposition, tol) << rep;
  EXPECT_LE(z.material, tol) << rep; EXPECT_LE(z.supplierClaims, tol) << rep;
}

/* §4.7: C0 = 100, r = 52 %, НДС 22 %, ядро (0, 0.5, 0.5), DPO 1, F_t = 60, налоги в конце 3-й недели. */
cw::FinParams hand_params(double limit) {
  cw::FinParams fp;
  fp.c0 = 100; fp.cMin = 0; fp.creditLimit = limit;
  fp.keyRate = 0.52; fp.spread = 0; fp.overdraftLimit = 0;
  fp.tauV = 0.22; fp.tauP = 0.25; fp.tauSoc = 0;
  fp.dsoKernel = { 0.0, 0.5, 0.5 }; fp.prepayShare = 0; fp.dpoWeeks = 1; fp.leadWeeks = 0;
  fp.vatPeriodWeeks = 3; fp.vatInstalments = 1; fp.vatInstalmentLagWeeks = 0;
  fp.taxPeriodWeeks = 3; fp.payrollWeeks.clear();
  fp.autoRepay = false; fp.taxCumulative = false;
  return fp;
}

/* Бесприбыльные «чистые» параметры: без налогов, ставок, взносов. */
cw::FinParams plain_params(double c0) {
  cw::FinParams fp;
  fp.c0 = c0; fp.creditLimit = 0; fp.keyRate = 0; fp.spread = 0; fp.tauV = 0; fp.tauP = 0; fp.tauSoc = 0;
  fp.prepayShare = 0; fp.dpoWeeks = 0; fp.leadWeeks = 0; fp.vatPeriodWeeks = 13; fp.taxPeriodWeeks = 4;
  fp.payrollWeeks.clear(); fp.autoRepay = false; fp.taxCumulative = true;
  return fp;
}

cr::CpEvents one_buyer(int T) {
  cr::CpEvents e; e.T = T; e.buyers.resize(1); e.buyers[0].late.assign(T, 0);
  return e;
}

}  // namespace

// T1: нулевые вероятности → у каждого id пустые события, потоки и данные LP.
TEST(CounterpartyRisk, ZeroRiskProducesNoEvents) {
  const cr::CpParams p = zero_risk();
  const std::vector<uint32_t> sup{ cr::entity_of("raw-00"), cr::entity_of("raw-01") };
  const std::vector<std::vector<double>> ship{ { 0.5, 0.5, 0 } }, theta{ { 0.7, 0.3 } };
  const std::vector<int> months{ 0, 1, 1 };
  for (uint64_t id = 0; id < 1000; ++id) {
    const cr::CpEvents e = cr::draw(p, 42, id, id % 2 ? months : std::vector<int>{}, 0.3, 26, 10, sup);
    ASSERT_TRUE(e.empty()) << id;
    cw::CounterpartyFlows f;
    cr::buyer_flows(e, p, { 0, 0.5, 0.5 }, 0.22, 30, f);
    const cr::SupplyPlan sp = cr::supplier_plan(e, p, { { 1, 2, 3 }, { 4, 5, 6 } }, { 1, 1, 1 }, 1, 0.3, 30, f);
    EXPECT_TRUE(f.empty()) << id;
    EXPECT_DOUBLE_EQ(sp.orders[0], 6.0);
    const cr::LpScenario d = cr::lp_data(e, p, f, ship, theta, { 1, 1 }, 0.3, 1, 1, 0.22, 30);
    EXPECT_TRUE(d.collect.empty() && d.writeOff.empty() && d.pay.empty() && d.matLoss.empty() && d.ship.empty()) << id;
  }
}

// T2: потоки при нулевых параметрах пусты → водопад идёт старой веткой побитово (EXPECT_EQ, не NEAR).
TEST(CashWaterfall, CpEmptyIsBitIdentical) {
  std::mt19937 rng(20261022);
  const cr::CpParams p = zero_risk();
  for (int rep = 0; rep < 200; ++rep) {
    RandomCase c = random_case(rng, true);
    const int T = (int)c.in.periods.size();
    const cr::CpEvents e = cr::draw(p, 7, rep, {}, 0.0, T, 10, { 1u, 2u, 3u });
    cw::ScenarioInput withCp = c.in;
    cr::buyer_flows(e, p, c.fp.dsoKernel, c.fp.tauV, T, withCp.cp);
    std::vector<double> ord(T); for (int t = 0; t < T; ++t) ord[t] = c.in.periods[t].orders;
    cr::supplier_plan(e, p, { ord }, {}, c.fp.leadWeeks, c.fp.prepayShare, T, withCp.cp);
    ASSERT_TRUE(withCp.cp.empty());
    expect_results_equal(cw::run(c.fp, c.in), cw::run(c.fp, withCp), rep);
  }
}

// Ветка событий с потоками, тождественными ядру DSO и сроку L (без событий), совпадает со старой веткой
// (до округления): проверка арифметики ветки, а не только тождеств.
TEST(CashWaterfall, CpKernelEquivalentFlowsMatchLegacy) {
  std::mt19937 rng(77);
  for (int rep = 0; rep < 200; ++rep) {
    RandomCase c = random_case(rng, false);
    const int T = (int)c.in.periods.size();
    cw::ScenarioInput withCp = c.in;
    for (int tau = 0; tau < T; ++tau)
      for (size_t k = 0; k < c.fp.dsoKernel.size(); ++k)
        if (tau + (int)k < T && c.fp.dsoKernel[k] > 0) withCp.cp.buyerCollect.push_back({ tau, tau + (int)k, c.fp.dsoKernel[k], cw::kFlowCollect });
    withCp.cp.supplyArrive.assign(T, {});
    for (int t = 0; t < T; ++t) withCp.cp.supplyArrive[t].push_back({ t + c.fp.leadWeeks, 1.0, std::min(1.0, std::max(0.0, c.fp.prepayShare)) });
    const cw::ScenarioResult a = cw::run(c.fp, c.in), b = cw::run(c.fp, withCp);
    const double tol = 1e-9 * c.scale;
    for (int t = 0; t < T; ++t) {
      EXPECT_NEAR(a.periods[t].cash, b.periods[t].cash, tol) << rep << " t" << t;
      EXPECT_NEAR(a.periods[t].collections, b.periods[t].collections, tol) << rep;
      EXPECT_NEAR(a.periods[t].payMat, b.periods[t].payMat, tol) << rep;
      EXPECT_NEAR(a.periods[t].ar, b.periods[t].ar, tol) << rep;
      EXPECT_NEAR(a.periods[t].ap, b.periods[t].ap, tol) << rep;
      EXPECT_NEAR(a.periods[t].debt, b.periods[t].debt, tol) << rep;
      EXPECT_NEAR(a.periods[t].tax, b.periods[t].tax, tol) << rep;
    }
    EXPECT_NEAR(a.profit, b.profit, tol) << rep;
    expect_identities(b, c.scale, rep);
  }
}

// T7: вариант §4.7 при лимите 150 — когорта недели 1 опаздывает на 2 недели.
TEST(CashWaterfall, HandLatePayment) {
  cw::FinParams fp = hand_params(150);
  cw::ScenarioInput in;
  for (int t = 0; t < 5; ++t) {
    cw::PeriodInput q;
    q.revenue = t < 2 ? 200 : 0; q.cogs = t < 2 ? 120 : 0; q.orders = q.cogs; q.rawConsumed = q.cogs; q.energy = 60;
    in.periods.push_back(q);
  }
  cr::CpParams p; p.nBuyers = 1;
  cr::CpEvents e = one_buyer(5); e.buyers[0].late[0] = 2;
  cw::ScenarioInput late = in;
  cr::buyer_flows(e, p, fp.dsoKernel, fp.tauV, 5, late.cp);
  const cw::ScenarioResult base = cw::run(fp, in), r = cw::run(fp, late);
  const double expColl[4] = { 0, 122, 244, 122 }, baseColl[4] = { 122, 244, 122, 0 };
  for (int k = 0; k < 4; ++k) {
    EXPECT_NEAR(r.periods[k + 1].collections, expColl[k], 1e-9) << k;
    EXPECT_NEAR(base.periods[k + 1].collections, baseColl[k], 1e-9) << k;
  }
  for (int t = 0; t < 5; ++t) {
    EXPECT_NEAR(r.periods[t].revenue, base.periods[t].revenue, 1e-12);
    EXPECT_NEAR(r.periods[t].ebitda, base.periods[t].ebitda, 1e-12);
  }
  EXPECT_NEAR(r.periods[2].vatPay, 35.2, 1e-9); EXPECT_NEAR(base.periods[2].vatPay, 35.2, 1e-9);
  EXPECT_NEAR(base.periods[1].drawdown, 44.4, 1e-9); EXPECT_FALSE(base.periods[1].breach);
  EXPECT_TRUE(r.periods[1].breach);                                  // d₂ = 166.4 > 150 → разрыв 16.4
  EXPECT_NEAR(r.periods[1].drawdown, 150, 1e-9);
  EXPECT_NEAR(r.periods[1].payMat, 146.4 - 16.4, 1e-9);
  EXPECT_NEAR(r.periods[1].arrears, 16.4, 1e-9);
  expect_identities(r, 1000, 0);
}

// T8: дефолт единственного покупателя — LGD, лаг взыскания и заменяющий покупатель с бонусом.
TEST(CashWaterfall, HandBuyerDefaultLgdRecoveryLagAndReplacement) {
  cw::FinParams fp = plain_params(1000);
  fp.dsoKernel = { 0, 0, 1 };
  cw::ScenarioInput in;
  for (int t = 0; t < 12; ++t) { cw::PeriodInput q; q.revenue = t < 6 ? 100 : 0; in.periods.push_back(q); }
  cr::CpParams p; p.nBuyers = 1; p.stopLag = 1; p.securityShare = 0; p.buyerLgd = 0.45; p.recoveryLag = 3;
  p.replaceLag = 4; p.replaceDiscount = 0.05;
  cr::CpEvents e = one_buyer(12); e.buyers[0].defaultWeek = 2;
  cr::buyer_flows(e, p, fp.dsoKernel, fp.tauV, 12, in.cp);
  const cw::ScenarioResult r = cw::run(fp, in);
  EXPECT_NEAR(r.periods[2].badDebt, 135, 1e-9);
  EXPECT_NEAR(r.periods[5].recoveries, 165, 1e-9);
  const double expAr[12] = { 100, 200, 165, 260, 355, 285, 285, 285, 285, 190, 95, 0 };
  double coll = 0, bonus = 0, ebitda = 0;
  for (int t = 0; t < 12; ++t) {
    EXPECT_NEAR(r.periods[t].ar, expAr[t], 1e-9) << t;
    EXPECT_NEAR(r.periods[t].cpDiscount, (t >= 3 && t <= 5) ? 5.0 : 0.0, 1e-12) << t;
    EXPECT_NEAR(r.periods[t].collections, t >= 9 ? 95.0 : 0.0, 1e-9) << t;
    if (t != 2) EXPECT_NEAR(r.periods[t].badDebt, 0, 1e-12) << t;
    if (t != 5) EXPECT_NEAR(r.periods[t].recoveries, 0, 1e-12) << t;
    coll += r.periods[t].collections + r.periods[t].recoveries; bonus += r.periods[t].cpDiscount; ebitda += r.periods[t].ebitda;
  }
  EXPECT_NEAR(coll + 135 + bonus, 600, 1e-9);                        // 450 + 135 + 15 = 600 (тождество 3)
  EXPECT_NEAR(ebitda, 450, 1e-9);
  expect_identities(r, 2000, 0);
}

// T9: дефолт поставщика — потеря предоплаты (LGD, лаг), восстановление НДС, перенос/перезаказ с надбавкой.
TEST(CashWaterfall, HandSupplierDefaultPrepaymentLossVatRestore) {
  cw::FinParams fp = plain_params(1000);
  fp.tauV = 0.2; fp.prepayShare = 0.5; fp.dpoWeeks = 1; fp.leadWeeks = 2; fp.vatPeriodWeeks = 8; fp.vatInstalments = 1;
  fp.vatInstalmentLagWeeks = 0; fp.dsoKernel = { 1.0 };
  const int T = 8;
  cr::CpParams p; p.supplierLgd = 0.45; p.recoveryLag = 3; p.replaceSupplierLag = 1; p.replacePremium = 0.10; p.replacePrepay = 0.5;
  cr::CpEvents e; e.T = T; e.suppliers.resize(1); e.suppliers[0].defaultWeek = 1; e.suppliers[0].disrupt.assign(T, 0);
  std::vector<double> ord(T, 0.0); ord[0] = ord[1] = 100;
  cw::ScenarioInput in, base;
  in.periods.resize(T); base.periods.resize(T);
  const cr::SupplyPlan sp = cr::supplier_plan(e, p, { ord }, {}, fp.leadWeeks, fp.prepayShare, T, in.cp);
  for (int t = 0; t < T; ++t) { in.periods[t].orders = sp.orders[t]; base.periods[t].orders = ord[t]; }
  EXPECT_NEAR(sp.orders[0], 100, 1e-12); EXPECT_NEAR(sp.orders[1], 0, 1e-12); EXPECT_NEAR(sp.orders[2], 220, 1e-9);
  in.periods[4].rawConsumed = in.periods[4].cogs = 220;                 // материал — в неделю прихода
  base.periods[2].rawConsumed = base.periods[2].cogs = 100; base.periods[3].rawConsumed = base.periods[3].cogs = 100;
  const cw::ScenarioResult r = cw::run(fp, in), b = cw::run(fp, base);
  EXPECT_NEAR(r.periods[0].invTransit, 100, 1e-9);
  EXPECT_NEAR(r.periods[1].invTransit, 0, 1e-9);                         // аннулировано в t1
  EXPECT_NEAR(r.periods[1].supLoss, 27, 1e-9);
  EXPECT_NEAR(r.periods[1].sc, 33, 1e-9);                                // требование 60 − LGD 27
  EXPECT_NEAR(r.periods[2].payMat, 132, 1e-9);                           // предоплата перезаказа 0.5·220·1.2
  EXPECT_NEAR(r.periods[3].payMat, 0, 1e-9);                             // остаток 60 по аннулированному снят
  EXPECT_NEAR(r.periods[4].recoveries, 33, 1e-9);
  EXPECT_NEAR(r.periods[5].payMat, 132, 1e-9);
  double payR = 0, payB = 0, recov = 0, eb = 0, er = 0;
  for (int t = 0; t < T; ++t) { payR += r.periods[t].payMat; payB += b.periods[t].payMat; recov += r.periods[t].recoveries;
                                er += r.periods[t].ebitda; eb += b.periods[t].ebitda; }
  EXPECT_NEAR(payB, 240, 1e-9);
  EXPECT_NEAR(payR - recov - payB, 51, 1e-9);                            // лишний отток поставщикам
  EXPECT_NEAR(eb - er, 47, 1e-9);                                        // 27 (потеря) + 20 (надбавка) = 51 − 4 (НДС)
  EXPECT_NEAR(r.periods.back().sc, 0, 1e-9);
  EXPECT_NEAR(r.periods.back().invTransit, 0, 1e-9);
  expect_identities(r, 2000, 0);
}

// T10: перебой у поставщика на плановом приходе — приход позже на 2 недели, оплата позже, отгрузка и инкассация
// сдвинуты, начисление не меняется.
TEST(CashWaterfall, HandSupplyDisruption) {
  cw::FinParams fp = plain_params(1000);
  fp.tauV = 0.2; fp.tauP = 0.25; fp.prepayShare = 0; fp.dpoWeeks = 1; fp.leadWeeks = 1; fp.dsoKernel = { 0, 0.5, 0.5 };
  const int T = 8;
  cr::CpParams p; p.thetaMin = 0.05;
  cr::CpEvents e; e.T = T; e.suppliers.resize(1); e.suppliers[0].disrupt.assign(T, 0);
  e.suppliers[0].disrupt[1] = 2; e.suppliers[0].disrupt[2] = 1;          // перебой [1, 3): плановый приход t1 → t3
  const int D = cr::product_delay(e, p, { 1.0 }, { 1 }, 1, fp.leadWeeks);   // выпуск в t1 ждёт заказа t0
  ASSERT_EQ(D, 2);
  cw::ScenarioInput base, dis;
  base.periods.resize(T); dis.periods.resize(T);
  base.periods[0].orders = 100; base.periods[1].revenue = 200; base.periods[1].cogs = base.periods[1].rawConsumed = 100;
  std::vector<double> ord(T, 0.0); ord[0] = 100;
  const cr::SupplyPlan sp = cr::supplier_plan(e, p, { ord }, {}, fp.leadWeeks, fp.prepayShare, T, dis.cp);
  for (int t = 0; t < T; ++t) dis.periods[t].orders = sp.orders[t];
  dis.periods[1 + D].revenue = 200; dis.periods[1 + D].cogs = dis.periods[1 + D].rawConsumed = 100;
  const cw::ScenarioResult b = cw::run(fp, base), r = cw::run(fp, dis);
  EXPECT_NEAR(b.periods[1].invRaw, 0, 1e-12); EXPECT_NEAR(b.periods[2].payMat, 120, 1e-9);
  EXPECT_NEAR(r.periods[2].invTransit, 100, 1e-9);                       // ещё в пути
  EXPECT_NEAR(r.periods[3].invTransit, 0, 1e-9);                         // приход t3
  EXPECT_NEAR(r.periods[4].payMat, 120, 1e-9); EXPECT_NEAR(r.periods[2].payMat, 0, 1e-12);
  EXPECT_NEAR(b.periods[2].collections, 120, 1e-9); EXPECT_NEAR(r.periods[4].collections, 120, 1e-9);
  EXPECT_NEAR(r.periods[5].collections, 120, 1e-9); EXPECT_NEAR(r.periods[2].collections, 0, 1e-12);
  double rb = 0, rr = 0; for (int t = 0; t < T; ++t) { rb += b.periods[t].revenue; rr += r.periods[t].revenue; }
  EXPECT_NEAR(rb, rr, 1e-12);
  EXPECT_NEAR(b.profit, r.profit, 1e-9);                                 // прибыль без процентов (ставки 0)
  expect_identities(r, 2000, 0);
}

// T11: при постоянной h неделя дефолта = ⌊ln(1−U)/ln(1−PD_T)·T⌋ (t_ex рукописи §4.3) — точное равенство.
TEST(CounterpartyRisk, HazardTimingMatchesManuscript) {
  for (int T : { 16, 26, 32, 52 })
    for (double pdT : { 0.02, 0.1, 0.5 }) {
      const double h = -std::log(1.0 - pdT) / T;
      const std::vector<double> hv(T, h);
      int mism = 0;
      for (int k = 1; k <= 1000; ++k) {
        const double U = k / 1001.0;
        const double tex = std::floor(std::log(1.0 - U) / std::log(1.0 - pdT) * T);
        const int exp = tex < T ? (int)tex : -1;
        mism += cr::default_week_from_uniform(U, hv) != exp;
      }
      EXPECT_EQ(mism, 0) << "T " << T << " PD " << pdT;
    }
  EXPECT_EQ(cr::default_week_from_uniform(0.999, std::vector<double>(26, 0.0)), -1);   // PD = 0 → за горизонтом
  // Кусочно-постоянный режим (calm 0..3, crisis 4..7, calm 8..11): обращение Λ(t) вручную.
  std::vector<double> h(12, 0.01); for (int t = 4; t < 8; ++t) h[t] = 0.05;
  EXPECT_EQ(cr::hazard_week(0.035, h), 3);                               // Λ(4) = 0.04 > 0.035
  EXPECT_EQ(cr::hazard_week(0.041, h), 4);                               // Λ(5) = 0.09
  EXPECT_EQ(cr::hazard_week(0.239, h), 7);                               // Λ(8) = 0.24
  EXPECT_EQ(cr::hazard_week(0.245, h), 8);                               // Λ(9) = 0.25
  EXPECT_EQ(cr::hazard_week(0.29, h), -1);                               // Λ(12) = 0.28
}

// T12: Σπ_g·m_g = 1; обрезка q·m > 1 — предупреждение и фактическое безусловное среднее.
TEST(CounterpartyRisk, RegimeNormalization) {
  const std::vector<double> pi{ 0.9037425748227139, 0.0962574251772861 };
  for (double k : { 1.0, 2.0, 3.0, 5.0 }) {
    const auto m = cr::regime_multipliers(pi, 1, k);
    EXPECT_LE(std::fabs(pi[0] * m[0] + pi[1] * m[1] - 1.0), 1e-15) << k;
    EXPECT_NEAR(m[1] / m[0], k, 1e-12);
  }
  const auto m3 = cr::regime_multipliers(pi, 1, 3.0);
  EXPECT_NEAR(m3[0], 0.8386, 1e-4); EXPECT_NEAR(m3[1], 2.5157, 1e-4);
  cr::CpParams p;
  double lateEff = 0, disEff = 0;
  EXPECT_TRUE(cr::clip_warnings(p, &lateEff, &disEff).empty());
  EXPECT_NEAR(lateEff, p.lateShare, 1e-12);
  p.lateShare = 0.6; p.kappaLate = 5;                                     // q_crisis = 0.6·5/(0.9037+0.4813) > 1
  const auto w = cr::clip_warnings(p, &lateEff);
  ASSERT_EQ(w.size(), 1u);
  const auto ml = cr::regime_multipliers(pi, 1, 5.0);
  EXPECT_NEAR(lateEff, pi[0] * 0.6 * ml[0] + pi[1] * 1.0, 1e-12);
  EXPECT_LT(lateEff, 0.6);
}

// AS241: Φ(Φ⁻¹(p)) = p; Базель при PD 0.04 → 0.136.
TEST(CounterpartyRisk, NormalQuantileAndBaselRho) {
  for (double p : { 1e-12, 1e-6, 0.001, 0.02, 0.3, 0.5, 0.7, 0.975, 0.999999 })
    EXPECT_NEAR(cr::norm_cdf(cr::norm_ppf(p)) / p, 1.0, 1e-13) << p;
  EXPECT_NEAR(cr::norm_ppf(0.975), 1.959963984540054, 1e-14);
  EXPECT_NEAR(cr::basel_rho(0.04), 0.1362, 1e-4);
  EXPECT_NEAR(cr::implied_default_corr(0.05, 0.0), 0.0, 1e-14);
}

// T13: копула Васичека без режимов — частота, условная по децилям Z, парная совместная вероятность, независимость.
TEST(CounterpartyRisk, VasicekCopulaStatistics) {
  const int N = 200000, T = 52;
  for (double rho : { 0.3, 0.0 }) {
    cr::CpParams p; p.buyerPd = 0.05; p.rho = rho; p.lateShare = 0; p.disruptShare = 0; p.supplierPd = 0;
    const double pd = 0.05, c = cr::norm_ppf(pd);
    std::vector<std::pair<double, int>> zd; zd.reserve(N);
    double n1 = 0, both = 0;
    for (int i = 0; i < N; ++i) {
      const cr::CpEvents e = cr::draw(p, 11, i, {}, 0.0, T, 2, {});
      const int d0 = e.buyers[0].defaultWeek >= 0, d1 = e.buyers[1].defaultWeek >= 0;
      n1 += d0; both += d0 * d1; zd.push_back({ e.z, d0 });
    }
    const double f = n1 / N, se = std::sqrt(pd * (1 - pd) / N);   // один контрагент на сценарий — i.i.d.
    EXPECT_NEAR(f, pd, 4 * se) << rho;
    std::sort(zd.begin(), zd.end());
    for (int dec = 0; dec < 10; ++dec) {
      double obs = 0, model = 0; const int a = dec * N / 10, b = (dec + 1) * N / 10;
      for (int k = a; k < b; ++k) {
        obs += zd[k].second;
        model += cr::norm_cdf((c - std::sqrt(rho) * zd[k].first) / std::sqrt(1 - rho));
      }
      obs /= (b - a); model /= (b - a);
      EXPECT_NEAR(obs, model, 4 * std::sqrt(std::max(model * (1 - model), 1e-6) / (b - a)) + 1e-12) << rho << " decile " << dec;
    }
    const double p2 = cr::implied_default_corr(pd, rho) * pd * (1 - pd) + pd * pd;   // ∫φ p(z)² dz
    EXPECT_NEAR(both / N, p2, 4 * std::sqrt(p2 * (1 - p2) / N)) << rho;
    if (rho == 0) EXPECT_NEAR(p2, pd * pd, 1e-15);
  }
}

// T14: задержки Ломакса — выживание (1 + x/σ)^{−α}, оценка Хилла хвоста, растяжение масштаба в кризисе.
TEST(CounterpartyRisk, LomaxDelays) {
  const int N = 50000; const double alpha = 1.5, sigma = 3.0;
  std::mt19937_64 g(5); std::uniform_real_distribution<double> u(0, 1);
  std::vector<int> d(N); std::vector<double> y(N);
  for (int i = 0; i < N; ++i) { const double ui = u(g); d[i] = cr::lomax_weeks(ui, alpha, sigma, 100000); y[i] = cr::lomax_delay(ui, alpha, sigma) + sigma; }
  for (int x = 1; x <= 20; ++x) {
    const double s = std::pow(1 + x / sigma, -alpha);
    double obs = 0; for (int v : d) obs += v > x; obs /= N;
    EXPECT_NEAR(obs, s, 4 * std::sqrt(s * (1 - s) / N)) << x;
  }
  // Хилл — по непрерывной задержке до округления вверх (целые недели дают связки на пороге и смещают оценку);
  // целочисленный выход проверен функцией выживания выше. Y + σ — точный Парето с индексом α.
  std::sort(y.begin(), y.end(), std::greater<double>());
  const int k = N / 10; double hs = 0;
  for (int i = 0; i < k; ++i) hs += std::log(y[i] / y[k]);
  const double hill = k / hs;
  EXPECT_NEAR(hill, alpha, 1.96 * alpha / std::sqrt((double)k)) << hill;
  // Режимы (навязаны): σ_g = σ·m_g(κ_σ), Σπ_g σ_g = σ; Δ > D_def кодируется D_def + 1 (дефолт когорты) — тоже > 6.
  cr::CpParams p; p.lateShare = 1.0; p.kappaLate = 1.0; p.buyerPd = 0; p.kappaLateScale = 2.0;
  const auto ms = cr::regime_multipliers(p.regimeStationary, p.crisisIndex, 2.0);
  EXPECT_NEAR(p.regimeStationary[0] * ms[0] + p.regimeStationary[1] * ms[1], 1.0, 1e-15);
  double calm = 0, crisis = 0, dflt = 0, overMax = 0; const int M = 3000;
  for (int i = 0; i < M; ++i) {
    const int c = cr::draw(p, 3, i, std::vector<int>(20, 0), 0, 4, 1, {}).buyers[0].late[0];
    calm += c > 6; dflt += c > p.defaultDpd; overMax += c > p.defaultDpd + 1 || (c > p.lateMax && c <= p.defaultDpd);
    crisis += cr::draw(p, 3, i, std::vector<int>(20, 1), 0, 4, 1, {}).buyers[0].late[0] > 6;
  }
  EXPECT_NEAR(calm / M, std::pow(1 + 6 / (3.0 * ms[0]), -1.5), 4 * std::sqrt(0.2 / M));
  EXPECT_NEAR(crisis / M, std::pow(1 + 6 / (3.0 * ms[1]), -1.5), 4 * std::sqrt(0.25 / M));
  EXPECT_NEAR(dflt / M, std::pow(1 + 13 / (3.0 * ms[0]), -1.5), 4 * std::sqrt(0.08 / M));
  EXPECT_EQ(overMax, 0);
}

// T15: CRN — события id не зависят от N, горизонта (префикс), числа других контрагентов и решений; seed+9973 — другие.
TEST(CounterpartyRisk, CrnProperties) {
  cr::CpParams p; p.buyerPd = 0.3; p.supplierPd = 0.3; p.lateShare = 0.3; p.disruptShare = 0.2;
  const std::vector<uint32_t> sup{ cr::entity_of("raw-00"), cr::entity_of("raw-07") };
  const std::vector<int> months(14, 0);
  for (uint64_t id : { 0ull, 7ull, 999ull }) {
    const cr::CpEvents a = cr::draw(p, 42, id, months, 0, 52, 10, sup);
    std::vector<cr::CpEvents> batch; for (uint64_t i = 0; i < 1000; ++i) batch.push_back(cr::draw(p, 42, i, months, 0, 52, 10, sup));
    EXPECT_EQ(cr::events_to_json(a), cr::events_to_json(batch[id]));               // N = 10 и N = 1000
    const cr::CpEvents s26 = cr::draw(p, 42, id, months, 0, 26, 10, sup);
    for (size_t c = 0; c < a.buyers.size(); ++c) {
      EXPECT_TRUE(std::equal(s26.buyers[c].late.begin(), s26.buyers[c].late.end(), a.buyers[c].late.begin()));
      EXPECT_EQ(s26.buyers[c].defaultWeek, a.buyers[c].defaultWeek < 26 ? a.buyers[c].defaultWeek : -1);
    }
    const cr::CpEvents more = cr::draw(p, 42, id, months, 0, 52, 11, { sup[0], sup[1], cr::entity_of("raw-11") });
    for (size_t c = 0; c < 10; ++c) EXPECT_EQ(more.buyers[c].late, a.buyers[c].late);
    for (size_t j = 0; j < 2; ++j) EXPECT_EQ(more.suppliers[j].disrupt, a.suppliers[j].disrupt);
    const cr::CpEvents swapped = cr::draw(p, 42, id, months, 0, 52, 10, { sup[1], sup[0] });   // порядок НСИ не важен
    EXPECT_EQ(swapped.suppliers[0].disrupt, a.suppliers[1].disrupt);
    const cr::CpEvents other = cr::draw(p, 42 + 9973, id, months, 0, 52, 10, sup);
    EXPECT_NE(cr::events_to_json(other), cr::events_to_json(a));
  }
  // Решения (φ, объёмы заказов) меняют суммы, но не статусы заказов.
  const cr::CpEvents e = cr::draw(p, 42, 3, months, 0, 26, 10, sup);
  cw::CounterpartyFlows f1, f2;
  cr::supplier_plan(e, p, { std::vector<double>(26, 10.0), std::vector<double>(26, 5.0) }, {}, 1, 0.0, 26, f1);
  cr::supplier_plan(e, p, { std::vector<double>(26, 70.0), std::vector<double>(26, 1.0) }, {}, 1, 0.0, 26, f2);
  EXPECT_EQ(f1.supplyCancel.size(), f2.supplyCancel.size());
  for (size_t k = 0; k < f1.supplyCancel.size(); ++k) {
    EXPECT_EQ(f1.supplyCancel[k].from, f2.supplyCancel[k].from); EXPECT_EQ(f1.supplyCancel[k].at, f2.supplyCancel[k].at);
  }
}

// T16: тождества §4.6 (вкл. 3, 3б, 7 и сверку с SC) на 1000 случайных входах со случайными событиями.
TEST(CashWaterfall, IdentitiesHoldWithRandomCounterpartyEvents) {
  std::mt19937 rng(915);
  std::uniform_real_distribution<double> u(0, 1);
  int withCancel = 0, withDefault = 0, breaches = 0;
  for (int rep = 0; rep < 1000; ++rep) {
    RandomCase c = random_case(rng, false);
    const int T = (int)c.in.periods.size();
    cr::CpParams p;
    p.buyerPd = 0.6 * u(rng); p.supplierPd = 0.6 * u(rng); p.lateShare = 0.5 * u(rng); p.disruptShare = 0.4 * u(rng);
    p.nBuyers = 1 + (int)(5 * u(rng)); p.securityShare = u(rng) < 0.3 ? u(rng) : 0; p.securityLag = (int)(6 * u(rng));
    p.recoveryLag = (int)(12 * u(rng)); p.stopLag = (int)(3 * u(rng)); p.replaceLag = (int)(4 * u(rng));
    p.replaceSupplierLag = (int)(3 * u(rng)); p.buyerLgd = u(rng); p.supplierLgd = u(rng); p.replacePrepay = u(rng);
    p.lateScale = 0.5 + 3 * u(rng); p.disruptScale = 0.5 + 2 * u(rng); p.lateMax = 1 + (int)(10 * u(rng));
    const std::vector<int> months(12, u(rng) < 0.5 ? 0 : 1);
    const cr::CpEvents e = cr::draw(p, rep, rep, months, 0, T, p.nBuyers, { 1u, 2u });
    cr::buyer_flows(e, p, c.fp.dsoKernel, c.fp.tauV, T, c.in.cp);
    std::vector<std::vector<double>> oj(2, std::vector<double>(T)); std::vector<double> other(T);
    for (int t = 0; t < T; ++t) { const double o = c.in.periods[t].orders; oj[0][t] = 0.5 * o; oj[1][t] = 0.3 * o; other[t] = 0.2 * o; }
    const cr::SupplyPlan sp = cr::supplier_plan(e, p, oj, other, c.fp.leadWeeks, std::min(1.0, std::max(0.0, c.fp.prepayShare)), T, c.in.cp);
    for (int t = 0; t < T; ++t) c.in.periods[t].orders = sp.orders[t];
    withCancel += !c.in.cp.supplyCancel.empty();
    for (const auto& b : e.buyers) withDefault += b.defaultWeek >= 0;
    const cw::ScenarioResult r = cw::run(c.fp, c.in);
    expect_identities(r, c.scale * 3, rep);
    breaches += r.breach;
  }
  EXPECT_GT(withCancel, 50); EXPECT_GT(withDefault, 100); EXPECT_GT(breaches, 0);
}

// T24: генератор по навязанным режимам: PD на 26 недель 1.70 % / 5.01 % / 2.02 %, доли просрочек 0.137 / 0.274.
// Проверка реализации (параметры [К]), не валидация.
TEST(CounterpartyRisk, GeneratorCalibrationCheck) {
  const int N = 20000, T = 26, nb = 10;
  cr::CpParams p; p.supplierPd = 0; p.disruptShare = 0;
  struct Case { std::vector<int> months; double pd, late; };
  const std::vector<Case> cases = { { std::vector<int>(8, 0), 0.01697, 0.13682 }, { std::vector<int>(8, 1), 0.05005, 0.27364 },
                                    { {}, 1 - std::sqrt(0.96), 0.15 } };
  for (const Case& cs : cases) {
    std::vector<double> perScenD(N), perScenL(N);
    for (int i = 0; i < N; ++i) {
      const cr::CpEvents e = cr::draw(p, 2026, i, cs.months, 0, T, nb, {});
      double d = 0, l = 0;
      for (const auto& b : e.buyers) { d += b.defaultWeek >= 0; for (int x : b.late) l += x > 0; }
      perScenD[i] = d / nb; perScenL[i] = l / (nb * T);
    }
    auto check = [&](const std::vector<double>& v, double target, const char* what) {
      const double m = std::accumulate(v.begin(), v.end(), 0.0) / N;
      double s2 = 0; for (double x : v) s2 += (x - m) * (x - m);
      const double se = std::sqrt(s2 / (N - 1) / N);                      // кластерная ошибка (общий Z в сценарии)
      EXPECT_NEAR(m, target, 4 * se + 1e-12) << what << " target " << target;
    };
    check(perScenD, cs.pd, "PD26");
    check(perScenL, cs.late, "late");
  }
}

// Согласованность сторон: ψ^(i) LP (lp_data) = оплаты поставщику в водопаде по плану supplier_plan (τ_v = 0) —
// предоплаты, остатки после прихода, перенос/перезаказ с надбавкой, взыскание требования (со знаком «−»).
TEST(CounterpartyRisk, LpPaymentsMatchWaterfallSupplierSide) {
  const int T = 8, R = 4, TT = T + R, L = 1, DPO = 1; const double phi = 0.4, mat = 100.0;
  cr::CpParams p; p.replaceSupplierLag = 2; p.recoveryLag = 3; p.supplierLgd = 0.45; p.replacePremium = 0.1; p.replacePrepay = 0.5;
  cr::CpEvents e; e.T = TT; e.suppliers.resize(1); e.suppliers[0].disrupt.assign(TT, 0);
  e.suppliers[0].disrupt[1] = 2; e.suppliers[0].disrupt[2] = 1; e.suppliers[0].defaultWeek = 5;   // перебой, норма, аннулирование, перенос
  const std::vector<std::vector<double>> ship{ std::vector<double>(T, 1.0 / T) };
  const cr::LpScenario d = cr::lp_data(e, p, {}, ship, { { 1.0 } }, { 1 }, phi, L, DPO, 0.0, TT);
  ASSERT_EQ(d.pay.size(), 1u);
  std::vector<double> oj(TT, 0.0);
  for (int t = 0; t < T; ++t) oj[std::max(0, t - L)] += mat * ship[0][t];
  cw::ScenarioInput in; in.periods.resize(TT);
  const cr::SupplyPlan sp = cr::supplier_plan(e, p, { oj }, {}, L, phi, TT, in.cp);
  for (int t = 0; t < TT; ++t) in.periods[t].orders = sp.orders[t];
  cw::FinParams fp; fp.c0 = 1e6; fp.creditLimit = 0; fp.keyRate = 0; fp.spread = 0; fp.tauV = 0; fp.tauP = 0; fp.tauSoc = 0;
  fp.prepayShare = phi; fp.leadWeeks = L; fp.dpoWeeks = DPO; fp.payrollWeeks.clear(); fp.autoRepay = false;
  const cw::ScenarioResult w = cw::run(fp, in);
  for (int t = 0; t < TT - 1; ++t)
    EXPECT_NEAR(w.periods[t].payMat - w.periods[t].recoveries, d.pay[0][t] * mat, 1e-9) << "t" << t;
  double loss = 0, ml = 0;
  for (int t = 0; t < TT; ++t) { loss += w.periods[t].supLoss; ml += d.matLoss[0][t] * mat; }
  EXPECT_GT(loss, 0.0);
  double prem = 0; for (double v : sp.premium) prem += v;
  EXPECT_NEAR(ml, loss + prem, 1e-9);                                     // LGD·φ (τ_v = 0) + надбавка π_rep
  double s1 = 0; for (double v : d.ship[0]) s1 += v;
  EXPECT_NEAR(s1, 1.0, 1e-12);                                            // сдвиг отгрузок сохраняет массу
}

// Судьба заказа — одна функция для Стадий 1 и 2: аннулирование при τ_o < τ_j ≤ τ_o+L+Δ^s (дефолт до ФАКТИЧЕСКОГО
// прихода), граница τ_j = τ_o+L и L = 0; задержка Стадии 1 = задержке выпуска Стадии 2 на тех же событиях.
TEST(CounterpartyRisk, OrderFateBoundaryAndCrossStageEquality) {
  cr::CpParams p; p.replaceSupplierLag = 2;
  auto ev = [](int tj, int a, int dis) {
    cr::CpEvents e; e.T = 30; e.suppliers.resize(1); e.suppliers[0].defaultWeek = tj; e.suppliers[0].disrupt.assign(30, 0);
    if (dis > 0) for (int w = a; w < a + dis && w < 30; ++w) e.suppliers[0].disrupt[w] = a + dis - w;
    return e;
  };
  // Граница τ_j = τ_o + L: аннулирование, задержка τ_j + ℓ_rep − τ_o = 5 в обеих стадиях.
  const cr::CpEvents b = ev(3, 3, 0);
  const cr::SupplyStatus s1 = cr::supply_status(b.suppliers[0], p, 0, 3);
  EXPECT_EQ(s1.state, cr::SupplyState::Cancelled); EXPECT_EQ(s1.delay, 5);
  EXPECT_EQ(cr::stage1_delay(b, p, { 0 }, 3, 0), 5);
  // L = 0, τ_j = τ_o: заказ переносится к заменяющему — задержка ℓ_rep.
  const cr::CpEvents z = ev(2, 0, 0);
  EXPECT_EQ(cr::supply_status(z.suppliers[0], p, 2, 0).state, cr::SupplyState::Moved);
  EXPECT_EQ(cr::stage1_delay(z, p, { 0 }, 0, 2), 2);
  // Перебой продлевает «в пути»: L = 3, Δ = 6 на плановом приходе 3, τ_j = 5 ≤ 9 → аннулирование, а не приход от
  // дефолтника; τ_j = 10 > 9 — приход по перебою.
  const cr::CpEvents d = ev(5, 3, 6);
  const cr::SupplyStatus s2 = cr::supply_status(d.suppliers[0], p, 0, 3);
  EXPECT_EQ(s2.state, cr::SupplyState::Cancelled); EXPECT_EQ(s2.delay, 7); EXPECT_EQ(s2.arrive, 9);
  cw::CounterpartyFlows f;
  cr::supplier_plan(d, p, { std::vector<double>(12, 0.0) }, {}, 3, 0.5, 12, f);
  std::vector<double> o(12, 0.0); o[0] = 100;
  cw::CounterpartyFlows g;
  cr::supplier_plan(d, p, { o }, {}, 3, 0.5, 12, g);
  ASSERT_EQ(g.supplyCancel.size(), 1u);
  EXPECT_EQ(g.supplyCancel[0].at, 5); EXPECT_EQ(g.supplyCancel[0].arrive, 9);
  const cr::CpEvents late = ev(10, 3, 6);
  EXPECT_EQ(cr::supply_status(late.suppliers[0], p, 0, 3).state, cr::SupplyState::Disrupted);
  EXPECT_EQ(cr::stage1_delay(late, p, { 0 }, 3, 0), 6);
  // Перенесённый/заменённый заказ — без перебоя (заменяющий без риска).
  const cr::CpEvents mv = ev(1, 3, 6);
  EXPECT_EQ(cr::supply_status(mv.suppliers[0], p, 3, 0).state, cr::SupplyState::Replaced);
  EXPECT_EQ(cr::supply_status(mv.suppliers[0], p, 3, 0).delay, 0);
  // Случайные события: задержка Стадии 1 (stage1_delay) = задержке выпуска Стадии 2 (product_delay, θ = 1).
  std::mt19937 rng(17); std::uniform_int_distribution<int> U(0, 12);
  for (int rep = 0; rep < 2000; ++rep) {
    const int L = U(rng) % 5, tauO = U(rng), tj = U(rng) - 2, a = U(rng), dis = U(rng) % 7;
    const cr::CpEvents e = ev(tj < 0 ? -1 : tj, a, dis);
    EXPECT_EQ(cr::stage1_delay(e, p, { 0 }, L, tauO), cr::product_delay(e, p, { 1.0 }, { 1 }, tauO + L, L)) << rep;
  }
}

// Нет общего фактора (F̃ = NaN) → загрузка λ_F не применяется: Z побитово как при λ_F = 0 (Var Z = 1).
TEST(CounterpartyRisk, MissingFactorKeepsStandardZ) {
  cr::CpParams p0, p9; p9.lambdaF = 0.9;
  const double nan = std::numeric_limits<double>::quiet_NaN();
  for (uint64_t id = 0; id < 200; ++id) {
    EXPECT_EQ(cr::draw(p9, 5, id, {}, nan, 4, 2, {}).z, cr::draw(p0, 5, id, {}, nan, 4, 2, {}).z) << id;
    EXPECT_EQ(cr::draw(p0, 5, id, {}, 0.7, 4, 2, {}).z, cr::draw(p0, 5, id, {}, nan, 4, 2, {}).z) << id;
  }
  EXPECT_NE(cr::draw(p9, 5, 3, {}, 0.7, 4, 2, {}).z, cr::draw(p0, 5, 3, {}, 0.7, 4, 2, {}).z);
}

// Дефолт когорты: Δ > D_def → списание LGD на τ+k+D_def и взыскание через ℓ_R; Δ ≤ D_def — излечение (оплата целиком);
// юридический дефолт раньше признания — экспозиция на τ_c. Тождества водопада держатся.
TEST(CashWaterfall, CohortDefaultBeyondDpd) {
  cr::CpParams p; p.nBuyers = 1; p.defaultDpd = 3; p.lateMax = 3; p.buyerLgd = 0.9; p.recoveryLag = 4; p.securityShare = 0;
  cr::CpEvents e = one_buyer(14); e.buyers[0].late[0] = 4; e.buyers[0].late[1] = 3;
  cw::CounterpartyFlows f;
  cr::buyer_flows(e, p, { 0, 0, 1 }, 0.2, 14, f);
  auto has = [](const std::vector<cw::BuyerFlow>& v, int from, int to, double share, unsigned char kind) {
    for (const auto& x : v) if (x.from == from && x.to == to && std::fabs(x.share - share) < 1e-12 && x.kind == kind) return true;
    return false;
  };
  EXPECT_TRUE(has(f.buyerWriteOff, 0, 5, 0.9, cw::kFlowLgd));          // 0 + k 2 + D_def 3
  EXPECT_TRUE(has(f.buyerCollect, 0, 9, 0.1, cw::kFlowRecovery));      // + ℓ_R 4
  EXPECT_TRUE(has(f.buyerCollect, 1, 6, 1.0, cw::kFlowCollect));       // излечение: 1 + 2 + 3
  for (const auto& x : f.buyerCollect) EXPECT_FALSE(x.from == 0 && x.kind == cw::kFlowCollect);
  cr::CpEvents l = e; l.buyers[0].defaultWeek = 4;                       // юридический дефолт до признания (5)
  cw::CounterpartyFlows fl;
  cr::buyer_flows(l, p, { 0, 0, 1 }, 0.2, 14, fl);
  EXPECT_TRUE(has(fl.buyerWriteOff, 0, 4, 0.9, cw::kFlowLgd));
  EXPECT_TRUE(has(fl.buyerWriteOff, 1, 4, 0.9, cw::kFlowLgd));          // излечение на 6 ≥ τ_c — тоже экспозиция
  cw::FinParams fp = plain_params(1000); fp.dsoKernel = { 0, 0, 1 }; fp.tauV = 0.2;
  cw::ScenarioInput in;
  for (int t = 0; t < 14; ++t) { cw::PeriodInput q; q.revenue = t < 4 ? 100 : 0; in.periods.push_back(q); }
  in.cp = f;
  const cw::ScenarioResult r = cw::run(fp, in);
  EXPECT_NEAR(r.periods[5].badDebt, 0.9 * 120, 1e-9);
  EXPECT_NEAR(r.periods[9].recoveries, 0.1 * 120, 1e-9);
  expect_identities(r, 2000, 0);
}

// Общий фактор покупателя ε_c: при λ_b > 0 число просроченных когорт связано с дефолтом покупателя (условная PD
// растёт), при λ_b = 0 и ρ = 0 — независимы; безусловная доля просрочек не меняется.
TEST(CounterpartyRisk, BuyerFactorLinksLatesAndDefault) {
  const int N = 20000, T = 52;
  for (double load : { 0.6, 0.0 }) {
    cr::CpParams p; p.rho = 0; p.lateRho = 0; p.buyerPd = 0.2; p.lateShare = 0.2; p.lateBuyerLoad = load;
    p.supplierPd = 0; p.disruptShare = 0;
    std::vector<double> n(N), d(N);
    double late = 0;
    for (int i = 0; i < N; ++i) {
      const cr::CpEvents e = cr::draw(p, 77, i, {}, 0.0, T, 1, {});
      for (int x : e.buyers[0].late) n[i] += x > 0;
      d[i] = e.buyers[0].defaultWeek >= 0; late += n[i];
    }
    const double mn = std::accumulate(n.begin(), n.end(), 0.0) / N, md = std::accumulate(d.begin(), d.end(), 0.0) / N;
    double cov = 0, vn = 0, vd = 0;
    for (int i = 0; i < N; ++i) { cov += (n[i] - mn) * (d[i] - md); vn += (n[i] - mn) * (n[i] - mn); vd += (d[i] - md) * (d[i] - md); }
    const double corr = cov / std::sqrt(vn * vd);
    if (load > 0) EXPECT_GT(corr, 0.15) << corr;
    else EXPECT_NEAR(corr, 0.0, 4.0 / std::sqrt((double)N)) << corr;
    EXPECT_NEAR(late / (N * T), 0.2, 0.01) << load;                     // маргинальная доля — та же
  }
}

// ρ_w внутри режима: полная корреляция дефолтов за год при смеси режимов = подразумеваемой ρ Базеля; без режимов
// (κ = 1 или сценарий без генератора) — ρ Базеля; заданная ρ ≥ 0 — как есть.
TEST(CounterpartyRisk, WithinRegimeRhoMatchesBaselTotal) {
  cr::CpParams p;
  const double rb = cr::basel_rho(0.04), rw = p.buyer_rho(true);
  EXPECT_NEAR(rw, 0.0970, 5e-4);
  EXPECT_LT(rw, rb);
  EXPECT_NEAR(cr::regime_mixture_corr(0.04, p.regimeStationary, p.crisisIndex, p.kappaPd, rw),
              cr::implied_default_corr(0.04, rb), 1e-10);
  EXPECT_EQ(p.buyer_rho(false), rb);
  EXPECT_NEAR(cr::within_regime_rho(0.04, p.regimeStationary, p.crisisIndex, 1.0), rb, 1e-9);
  p.rho = 0.2;
  EXPECT_EQ(p.buyer_rho(true), 0.2); EXPECT_EQ(p.late_rho(true), 0.10); EXPECT_EQ(p.disrupt_rho(true), 0.10);
  p.lateRho = -1; p.disruptRho = -1;
  EXPECT_EQ(p.late_rho(true), 0.2); EXPECT_EQ(p.disrupt_rho(true), 0.2);
}

// Перебои поставщика: приходы внутри перебоя ждут его конца (фактический приход a + disrupt[a] не убывает по a —
// без обгона); длительность ≤ Dmax; события CRN по префиксу.
TEST(CounterpartyRisk, OutagesBlockArrivalsWithoutOvertaking) {
  cr::CpParams p; p.disruptShare = 0.08; p.supplierPd = 0; p.buyerPd = 0; p.lateShare = 0; p.disruptMax = 9;
  const std::vector<uint32_t> sup{ cr::entity_of("raw-00"), cr::entity_of("raw-01"), cr::entity_of("raw-02") };
  int blocked = 0;
  for (uint64_t id = 0; id < 400; ++id) {
    const cr::CpEvents e = cr::draw(p, 9, id, std::vector<int>(14, id % 2), 0.0, 52, 0, sup);
    for (const auto& s : e.suppliers) {
      for (int a = 0; a + 1 < 52; ++a) {
        EXPECT_LE(a + s.disrupt[a], a + 1 + s.disrupt[a + 1]) << id << " a" << a;
        EXPECT_LE(s.disrupt[a], 9);
        if (s.disrupt[a] > 1) EXPECT_GE(s.disrupt[a + 1], s.disrupt[a] - 1);    // тот же конец перебоя
      }
      for (int x : s.disrupt) blocked += x > 0;
      for (int tauO = 0; tauO + 1 < 40; ++tauO)                               // судьбы заказов — без обгона
        EXPECT_LE(cr::supply_status(s, p, tauO, 2).arrive, cr::supply_status(s, p, tauO + 1, 2).arrive);
    }
  }
  EXPECT_GT(blocked, 0);
}

// Группировка позиций по поставщику: позиции одного поставщика — общие дефолт и перебои; ключ сохраняется в JSON.
TEST(CounterpartyRisk, SupplierGroupsShareEvents) {
  cr::CpParams p; p.supplierPd = 0.5; p.disruptShare = 0.2;
  p.supplierGroups = { { "raw-00", "V1" }, { "raw-01", "V1" } };
  EXPECT_EQ(p.supplier_entity("raw-00"), cr::entity_of("V1"));
  EXPECT_EQ(p.supplier_entity("raw-02"), cr::entity_of("raw-02"));
  const std::vector<uint32_t> ent{ p.supplier_entity("raw-00"), p.supplier_entity("raw-01"), p.supplier_entity("raw-02") };
  int differ = 0;
  for (uint64_t id = 0; id < 50; ++id) {
    const cr::CpEvents e = cr::draw(p, 3, id, {}, 0.0, 26, 0, ent);
    EXPECT_EQ(e.suppliers[0].defaultWeek, e.suppliers[1].defaultWeek);
    EXPECT_EQ(e.suppliers[0].disrupt, e.suppliers[1].disrupt);
    differ += e.suppliers[0].disrupt != e.suppliers[2].disrupt;
  }
  EXPECT_GT(differ, 0);
  const cr::CpParams q = cr::CpParams::from_json(p.to_json());
  EXPECT_EQ(q.supplierGroups, p.supplierGroups);
  EXPECT_TRUE(q.validate().empty());
}

// Добавка supply-джобы: задержка материала в пределах запаса до срока джобы не удлиняет её; сверх — на разность.
TEST(CounterpartyRisk, SupplyJobExtraRespectsSlack) {
  cr::CpParams p;
  cr::CpEvents e; e.T = 10; e.suppliers.resize(2);
  for (auto& s : e.suppliers) s.disrupt.assign(10, 0);
  e.suppliers[0].disrupt[1] = 1;                                         // материал 0 (срок 1/2 джобы): +1 нед.
  e.suppliers[1].disrupt[1] = 2;                                         // материал 1 (срок джобы): +2 нед.
  EXPECT_EQ(cr::supply_job_extra(e, p, { 0 }, { 0.5 }, 1, 0, 20160.0), 0.0);          // 10080 + 10080 ≤ 20160
  EXPECT_EQ(cr::supply_job_extra(e, p, { 0 }, { 0.5 }, 1, 0, 10080.0), 5040.0);       // 5040 + 10080 − 10080
  EXPECT_EQ(cr::supply_job_extra(e, p, { 0, 1 }, { 0.5, 1.0 }, 1, 0, 20160.0), 20160.0);
  EXPECT_EQ(cr::supply_job_extra(e, p, { 0, 1 }, { 0.5, 1.0 }, 1, 3, 20160.0), 0.0);  // заказ недели 3 — без перебоя
}
