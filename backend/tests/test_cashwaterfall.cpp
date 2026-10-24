// Водопад кассы (CashWaterfall) — METHODOLOGY-V2 §4: ручной пример §4.7 (допуск 1e-9),
// событие разрыва с обрезкой по приоритету, тождества §4.6 на случайных входах.
#include "CashWaterfall.h"
#include <gtest/gtest.h>
#include <cmath>
#include <random>

namespace cw = maos::cash;

namespace {

/* Параметры ручного примера §4.7 (тыс. ₽): C0=100, лимит 300, r=52 % годовых,
   НДС 22 %, прибыль 25 %, ядро DSO (0, 0.5, 0.5), DPO 1 нед., предоплата 0,
   F_t=60 еженедельно, налоги — в конце 3-й недели. */
cw::FinParams hand_params(double limit) {
  cw::FinParams fp;
  fp.c0 = 100; fp.cMin = 0; fp.creditLimit = limit;
  fp.keyRate = 0.52; fp.spread = 0; fp.overdraftLimit = 0;
  fp.tauV = 0.22; fp.tauP = 0.25; fp.tauSoc = 0;
  fp.dsoKernel = { 0.0, 0.5, 0.5 }; fp.prepayShare = 0; fp.dpoWeeks = 1; fp.leadWeeks = 0;
  fp.vatPeriodWeeks = 3; fp.vatInstalments = 1; fp.vatInstalmentLagWeeks = 0;
  fp.taxPeriodWeeks = 3; fp.payrollWeeks.clear();
  fp.autoRepay = false; fp.taxCumulative = false;   // ручной пример §4.7 — правила до A4 (без погашения, налог с NOL)
  return fp;
}
cw::ScenarioInput hand_input() {
  cw::ScenarioInput in;
  for (int t = 0; t < 3; ++t) {
    cw::PeriodInput p;
    p.revenue = t < 2 ? 200 : 0; p.cogs = t < 2 ? 120 : 0;
    p.orders = t < 2 ? 120 : 0;  p.rawConsumed = p.orders;
    p.energy = 60;                               // F_t = зарплата + энергия
    in.periods.push_back(p);
  }
  return in;
}

}  // namespace

TEST(CashWaterfall, WeeklyRateIsEffectiveNotNominal) {
  EXPECT_NEAR(cw::weekly_rate(0.52), std::pow(1.52, 1.0 / 52.0) - 1.0, 1e-15);
  EXPECT_LT(cw::weekly_rate(0.52), 0.52 / 52.0);
}

TEST(CashWaterfall, HandComputedExampleOfSection4_7) {
  const auto r = cw::run(hand_params(300), hand_input());
  ASSERT_EQ(r.periods.size(), 3u);
  const double rw = std::pow(1.52, 1.0 / 52.0) - 1.0;
  const auto& p1 = r.periods[0]; const auto& p2 = r.periods[1]; const auto& p3 = r.periods[2];
  // t=1: выручка 200 → счёт 244, инкассации нет, оплаты поставщику нет (DPO=1).
  EXPECT_NEAR(p1.collections, 0, 1e-12);  EXPECT_NEAR(p1.payMat, 0, 1e-12);
  EXPECT_NEAR(p1.cash, 40, 1e-9);         EXPECT_NEAR(p1.drawdown, 0, 1e-12);
  // t=2: инкассация 122, оплата 146.4, транш 44.4, касса 0.
  EXPECT_NEAR(p2.collections, 122, 1e-9); EXPECT_NEAR(p2.payMat, 146.4, 1e-9);
  EXPECT_NEAR(p2.drawdown, 44.4, 1e-9);   EXPECT_NEAR(p2.cash, 0, 1e-9);
  EXPECT_NEAR(p2.interest, 0, 1e-12);     EXPECT_FALSE(p2.breach);
  // t=3: инкассация 244, оплата 146.4, проценты r_w·44.4, НДС 35.2, налог 0 (NOL 20.36).
  const double intr = rw * 44.4;
  EXPECT_NEAR(p3.collections, 244, 1e-9); EXPECT_NEAR(p3.interest, intr, 1e-12);
  EXPECT_NEAR(p3.vatPay, 0.22 * (400 - 240), 1e-9);
  EXPECT_NEAR(p3.tax, 0, 1e-12);
  EXPECT_NEAR(p3.nol, -(400 - 240 - 180 - intr), 1e-9);
  EXPECT_NEAR(p3.cash, 244 - 146.4 - 60 - intr - 35.2, 1e-9);
  EXPECT_NEAR(p3.debt, 44.4, 1e-9);       EXPECT_NEAR(p3.ar, 122, 1e-9);
  EXPECT_NEAR(p3.ap, 0, 1e-9);
  // Кассовое тождество за горизонт: 100 + 366 − 292.8 − 180 − Int + 44.4 − 35.2.
  EXPECT_NEAR(p3.cash, 100 + 366 - 292.8 - 180 - intr + 44.4 - 35.2, 1e-9);
  // Тождество дебиторки: выставлено 488 = инкассировано 366 + остаток 122.
  EXPECT_NEAR(p3.ar + p1.collections + p2.collections + p3.collections, 488, 1e-9);
  EXPECT_NEAR(r.minCash, 0, 1e-9);
  EXPECT_FALSE(r.breach);
  EXPECT_LE(r.residuals.max(), 1e-9 * 500);
}

TEST(CashWaterfall, LimitFortyCausesBreachAndPriorityCut) {
  const auto r = cw::run(hand_params(40), hand_input());
  const auto& p2 = r.periods[1]; const auto& p3 = r.periods[2];
  // Нехватка 44.4 при лимите 40: разрыв 4.4, режется платёж поставщику (низший приоритет).
  EXPECT_TRUE(p2.breach);
  EXPECT_NEAR(p2.drawdown, 40, 1e-9);
  EXPECT_NEAR(p2.payMat, 146.4 - 4.4, 1e-9);
  EXPECT_NEAR(p2.payEn, 60, 1e-9);                 // зарплата/энергия не тронуты
  EXPECT_NEAR(p2.cash, 0, 1e-9);
  EXPECT_NEAR(p2.arrears, 4.4, 1e-9);
  EXPECT_NEAR(p2.netCash, -4.4, 1e-9);
  EXPECT_NEAR(p2.undrawn, 0, 1e-12);
  EXPECT_EQ(r.tBreach, 2);
  EXPECT_NEAR(r.minCash, -4.4, 1e-9);
  // t=3: просрочка 4.4 предъявлена вместе с 146.4, но лимит исчерпан (U=0) и после
  // НДС 35.2 кассы снова не хватает: 244 − 150.8 − 60 − r_w·40 − 35.2 < 0 → второй разрыв.
  const double gap3 = -(244 - 150.8 - 60 - cw::weekly_rate(0.52) * 40 - 35.2);
  EXPECT_GT(gap3, 0);
  EXPECT_TRUE(p3.breach);
  EXPECT_NEAR(p3.payMat, 150.8 - gap3, 1e-9);
  EXPECT_NEAR(p3.arrears, gap3, 1e-9);
  EXPECT_NEAR(p3.cash, 0, 1e-9);
  EXPECT_LE(r.residuals.max(), 1e-9 * 500);
}

TEST(CashWaterfall, ProfitTaxUsesLossCarryForward) {
  cw::FinParams fp = hand_params(1000);
  fp.taxPeriodWeeks = 1; fp.vatPeriodWeeks = 1; fp.keyRate = 0; fp.c0 = 1000;
  cw::ScenarioInput in;
  cw::PeriodInput a; a.revenue = 100; a.energy = 140;   // EBT = −40 → NOL 40
  cw::PeriodInput b; b.revenue = 100; b.energy = 40;    // EBT = +60 → база 20 → налог 5
  in.periods = { a, b };
  const auto r = cw::run(fp, in);
  EXPECT_NEAR(r.periods[0].tax, 0, 1e-12);
  EXPECT_NEAR(r.periods[0].nol, 40, 1e-12);
  EXPECT_NEAR(r.periods[1].tax, 0.25 * 20, 1e-12);
  EXPECT_NEAR(r.periods[1].nol, 0, 1e-12);
  EXPECT_NEAR(r.profit, 100 - 140 + 100 - 40 - 5, 1e-12);
}

TEST(CashWaterfall, OverdraftAvoidsBreachAtPenaltyRate) {
  cw::FinParams fp = hand_params(0);
  fp.overdraftLimit = 100; fp.overdraftSpread = 0.48;    // 100 % годовых штрафной
  const auto r = cw::run(fp, hand_input());
  const auto& p2 = r.periods[1]; const auto& p3 = r.periods[2];
  EXPECT_FALSE(p2.breach);
  EXPECT_NEAR(p2.overdraft, 44.4, 1e-9);
  EXPECT_NEAR(p2.cash, 0, 1e-9);
  EXPECT_NEAR(p3.interest, cw::weekly_rate(1.0) * 44.4, 1e-12);
  EXPECT_GT(p3.repayment, 0);                            // овердрафт гасится излишком кассы
  EXPECT_LE(r.residuals.max(), 1e-9 * 500);
}

TEST(CashWaterfall, IdentitiesHoldOnRandomInputs) {
  std::mt19937 rng(20261022);
  std::uniform_real_distribution<double> u(0, 1);
  int breaches = 0, defaults = 0;
  for (int rep = 0; rep < 300; ++rep) {
    cw::FinParams fp;
    fp.c0 = 500 * u(rng); fp.cMin = 50 * u(rng); fp.creditLimit = u(rng) < 0.3 ? 0 : 2000 * u(rng);
    fp.d0 = u(rng) < 0.5 ? 0 : fp.creditLimit * u(rng);
    fp.keyRate = 0.3 * u(rng); fp.spread = 0.05 * u(rng); fp.overdraftSpread = 0.2 * u(rng);
    fp.overdraftLimit = u(rng) < 0.5 ? 0 : 300 * u(rng);
    fp.tauV = 0.22; fp.tauP = 0.25; fp.tauSoc = 0.30; fp.propertyTaxWeekly = 3 * u(rng);
    fp.dsoKernel = { 0.2 * u(rng), 0.4 * u(rng), 0.3 * u(rng), 0.1 * u(rng) };  // Σw ≤ 1
    fp.prepayShare = u(rng) < 0.5 ? 0 : 0.5 * u(rng);
    fp.dpoWeeks = (int)(4 * u(rng)); fp.leadWeeks = (int)(3 * u(rng));
    fp.vatPeriodWeeks = 1 + (int)(13 * u(rng)); fp.vatInstalments = 1 + (int)(3 * u(rng));
    fp.vatInstalmentLagWeeks = (int)(5 * u(rng)); fp.taxPeriodWeeks = 1 + (int)(8 * u(rng));
    if (u(rng) < 0.3) fp.payrollWeeks.clear();
    fp.autoRepay = u(rng) < 0.5;
    fp.taxCumulative = u(rng) < 0.5;                     // A4: оба режима налога
    cw::ScenarioInput in;
    const int T = 4 + (int)(30 * u(rng));
    double scale = fp.c0 + fp.creditLimit + 1;
    for (int t = 0; t < T; ++t) {
      cw::PeriodInput p;
      p.revenue = 300 * u(rng); p.cogs = 150 * u(rng); p.orders = 200 * u(rng);
      p.rawConsumed = 150 * u(rng); p.payrollGross = 60 * u(rng); p.energy = 30 * u(rng);
      p.conversion = 40 * u(rng);
      p.logistics = 20 * u(rng); p.repairPlanned = 10 * u(rng); p.repairBreakdown = u(rng) < 0.2 ? 80 * u(rng) : 0;
      p.otherFixed = 5 * u(rng); p.depreciation = 8 * u(rng); p.capex = u(rng) < 0.1 ? 400 * u(rng) : 0;
      p.plannedRepayment = u(rng) < 0.3 ? 100 * u(rng) : 0;
      if (u(rng) < 0.2) p.drawdown = 100 * u(rng);
      if (u(rng) < 0.1) p.repayment = 50 * u(rng);
      if (u(rng) < 0.5) p.keyRate = 0.3 * u(rng);
      scale += p.revenue + p.orders + p.capex;
      in.periods.push_back(p);
    }
    if (u(rng) < 0.3) { in.defaultWeek = 1 + (int)(T * u(rng)); in.lgd = u(rng); ++defaults; }
    const auto r = cw::run(fp, in);
    const auto& z = r.residuals;
    const double tol = 1e-9 * scale;
    EXPECT_LE(z.cash, tol) << "rep " << rep;
    EXPECT_LE(z.reconciliation, tol) << "rep " << rep;
    EXPECT_LE(z.receivables, tol) << "rep " << rep;
    EXPECT_LE(z.debt, tol) << "rep " << rep;
    EXPECT_LE(z.interest, tol) << "rep " << rep;
    EXPECT_LE(z.npvDecomposition, tol) << "rep " << rep;
    EXPECT_LE(z.material, tol) << "rep " << rep;
    for (const auto& s : r.periods) {
      EXPECT_GE(s.cash, -1e-5) << "rep " << rep;              // касса не уходит в минус без события
      EXPECT_LE(s.debt - s.overdraft, fp.creditLimit + 1e-9) << "rep " << rep;
      EXPECT_LE(s.overdraft, fp.overdraftLimit + 1e-9) << "rep " << rep;
      EXPECT_EQ(s.breach, s.netCash < -1e-5) << "rep " << rep; // разрыв ⇔ отрицательная чистая касса
    }
    if (r.breach) ++breaches;
  }
  EXPECT_GT(breaches, 0);   // случайные входы покрывают и ветвь разрыва
  EXPECT_GT(defaults, 0);
}

TEST(CashWaterfall, SummaryStatisticsAndWilsonInterval) {
  double lo, hi;
  cw::wilson95(0, 100, lo, hi);
  EXPECT_NEAR(lo, 0, 1e-12); EXPECT_GT(hi, 0.03);          // при нуле событий верхняя граница ≠ 0
  cw::wilson95(50, 100, lo, hi);
  EXPECT_NEAR(0.5 * (lo + hi), 0.5, 1e-9);
  EXPECT_NEAR(cw::cvar_lower({ 5, 1, 3, 2, 4, 6, 7, 8, 9, 10 }, 0.2), 1.5, 1e-12);
  EXPECT_NEAR(cw::quantile({ 1, 2, 3, 4 }, 0.5), 2.5, 1e-12);

  std::vector<cw::ScenarioResult> rs;
  for (int i = 0; i < 20; ++i) {
    cw::FinParams fp = hand_params(i < 5 ? 40 : 300);     // 5 из 20 — разрыв
    rs.push_back(cw::run(fp, hand_input()));
  }
  const cw::Summary S = cw::summarize(rs, 0.10, 0.25, 300, 7, 200);
  EXPECT_EQ(S.n, 20);
  EXPECT_NEAR(S.pBreach, 0.25, 1e-12);
  EXPECT_LT(S.pBreachLo, 0.25); EXPECT_GT(S.pBreachHi, 0.25);
  EXPECT_NEAR(S.cfar, -4.4, 1e-9);                         // худшие 5 из 20 — все с разрывом
  EXPECT_NEAR(S.cashMinP50, 0, 1e-9);
  EXPECT_NEAR(S.tBreachP10, 2, 1e-12);
  EXPECT_EQ(S.cashP50.size(), 3u);
  EXPECT_LE(S.maxResidual, 1e-6);
}

// ── Волна A3: налог на прибыль нарастающим итогом (ст. 285–287 НК РФ) и транш под CAPEX ─────────────
// Прибыль в начале горизонта, убыток в конце: при помесячных периодах (NOL только вперёд) налог уплачен с ранней
// прибыли и поздний убыток пропадает; нарастающим итогом налог = τ·max(0, Σ EBT), переплата — актив.
TEST(CashWaterfall, A3CumulativeTaxEqualsRateTimesTotalEbtAndIdentitiesHold) {
  cw::FinParams fp = hand_params(1000);
  fp.vatPeriodWeeks = 4; fp.taxPeriodWeeks = 4; fp.dsoKernel = { 1.0 };
  cw::ScenarioInput in;
  for (int t = 0; t < 12; ++t) {
    cw::PeriodInput p;
    p.revenue = t < 4 ? 300 : 0; p.cogs = t < 4 ? 100 : 0; p.orders = p.cogs; p.rawConsumed = p.cogs;
    p.energy = 60;
    in.periods.push_back(p);
  }
  const cw::ScenarioResult monthly = cw::run(fp, in);
  fp.taxCumulative = true;
  const cw::ScenarioResult cum = cw::run(fp, in);
  double ebt = 0, taxCum = 0, taxMon = 0, pCum = 0;
  for (size_t t = 0; t < cum.periods.size(); ++t) { ebt += cum.periods[t].ebt; taxCum += cum.periods[t].tax; taxMon += monthly.periods[t].tax; pCum += cum.periods[t].profitAcc; }
  EXPECT_GT(ebt, 0.0);
  EXPECT_NEAR(pCum, ebt - 0.25 * std::max(0.0, ebt), 1e-9 * 1000);       // расход по налогу = τ·max(0, Σ EBT)
  EXPECT_GT(taxMon, 0.25 * ebt + 1.0);                                    // помесячно — налог с ранней прибыли сверх τ·Σ EBT
  EXPECT_NEAR(taxCum, 0.25 * 4 * (300 - 100 - 60), 1e-9 * 1000);          // уплачено по первой «месячной» прибыли
  EXPECT_GE(taxCum, 0.25 * ebt - 1e-9);                                   // переплата (актив) ≥ 0, возврата нет
  EXPECT_LE(cum.residuals.max(), 1e-9 * 5000);                            // тождества §4.6 с налоговым активом
  EXPECT_LE(monthly.residuals.max(), 1e-9 * 5000);
}

// Транш под CAPEX (минимум выборки drawFloor): долг растёт на CAPEX, касса не уходит в разрыв, тождества держатся.
TEST(CashWaterfall, A3CapexTrancheIsDrawnAndIdentitiesHold) {
  cw::FinParams fp = hand_params(500);
  cw::ScenarioInput in = hand_input();
  in.periods[0].capex = 120; in.periods[0].drawFloor = 120; in.periods[1].depreciation = 1.0; in.periods[2].depreciation = 1.0;
  const cw::ScenarioResult r = cw::run(fp, in);
  EXPECT_NEAR(r.periods[0].drawdown, 120.0, 1e-9);                        // транш = CAPEX (касса 100 − 60 ≥ 0 без него)
  EXPECT_NEAR(r.periods[0].capex, 120.0, 1e-9);
  EXPECT_FALSE(r.breach);
  EXPECT_LE(r.residuals.max(), 1e-9 * 500);
  const cw::ScenarioResult base = cw::run(fp, hand_input());
  EXPECT_NEAR(r.periods[0].netCash, base.periods[0].netCash, 1e-9);      // касса: +транш − CAPEX = 0
  EXPECT_GT(r.periods.back().debt, base.periods.back().debt + 119.0);
}

// ── Волна A4: правила продукта по умолчанию ─────────────────────────────────────────────────────────────────
// Погашение линии излишком кассы сверх буфера C_min (revolver sweep): ликвидность C + U в каждом периоде та же, что
// без погашения, долг и проценты ниже, тождества §4.6 держатся.
TEST(CashWaterfall, A4DefaultSweepKeepsLiquidityAndCutsInterest) {
  const cw::FinParams def;
  EXPECT_TRUE(def.autoRepay);
  EXPECT_TRUE(def.taxCumulative);
  cw::FinParams fp = hand_params(1000);
  fp.taxCumulative = true;
  cw::ScenarioInput in;
  for (int t = 0; t < 12; ++t) {          // выборка на старте (закупка), затем инкассация больше платежей
    cw::PeriodInput p;
    p.revenue = t >= 2 ? 150 : 0; p.cogs = t >= 2 ? 60 : 0; p.orders = t < 2 ? 200 : 40; p.rawConsumed = p.cogs;
    p.energy = 30;
    in.periods.push_back(p);
  }
  const cw::ScenarioResult hold = cw::run(fp, in);
  fp.autoRepay = true; fp.cMin = 5;
  const cw::ScenarioResult sweep = cw::run(fp, in);
  fp.autoRepay = false;
  const cw::ScenarioResult hold5 = cw::run(fp, in);
  EXPECT_GT(hold.maxDebt, 100.0);
  EXPECT_LT(sweep.totalInterest, hold5.totalInterest - 1e-6);
  EXPECT_LT(sweep.periods.back().debt, hold5.periods.back().debt - 1.0);
  for (size_t t = 0; t < in.periods.size(); ++t) {
    const auto& a = sweep.periods[t]; const auto& b = hold5.periods[t];
    EXPECT_FALSE(a.breach);
    if (a.debt > 1e-9) EXPECT_NEAR(a.cash, fp.cMin, 1e-9) << t;        // пока есть долг, касса держится на буфере
    EXPECT_GE(a.cash + a.undrawn, b.cash + b.undrawn - (hold5.totalInterest - sweep.totalInterest) - 1e-6) << t;
  }
  EXPECT_GT(sweep.profit, hold5.profit);                                // экономия процентов после налога
  EXPECT_LE(sweep.residuals.max(), 1e-9 * 5000);
}

// Налог нарастающим итогом по умолчанию: при убытке в начале года и прибыли позже налог за горизонт = τ·max(0, Σ EBT)
// (в обоих режимах при такой последовательности), а при прибыли в начале и убытке позже — меньше, чем помесячно с NOL.
TEST(CashWaterfall, A4DefaultTaxIsYearToDate) {
  cw::FinParams fp = hand_params(1000);
  fp.taxCumulative = cw::FinParams{}.taxCumulative;
  ASSERT_TRUE(fp.taxCumulative);
  fp.vatPeriodWeeks = 4; fp.taxPeriodWeeks = 4; fp.dsoKernel = { 1.0 };
  cw::ScenarioInput in;
  for (int t = 0; t < 12; ++t) {
    cw::PeriodInput p;
    p.revenue = t < 4 ? 300 : 50; p.cogs = t < 4 ? 100 : 20; p.orders = p.cogs; p.rawConsumed = p.cogs; p.energy = 60;
    in.periods.push_back(p);
  }
  const cw::ScenarioResult ytd = cw::run(fp, in);
  fp.taxCumulative = false;
  const cw::ScenarioResult nol = cw::run(fp, in);
  double ebt = 0, accrued = 0, accruedNol = 0;
  for (size_t t = 0; t < ytd.periods.size(); ++t) {
    ebt += ytd.periods[t].ebt;
    accrued += ytd.periods[t].ebt - ytd.periods[t].profitAcc;
    accruedNol += nol.periods[t].ebt - nol.periods[t].profitAcc;
  }
  EXPECT_NEAR(accrued, 0.25 * std::max(0.0, ebt), 1e-9 * 1000);         // расход по налогу = τ·max(0, Σ EBT)
  EXPECT_GT(accruedNol, accrued + 1.0);                                  // помесячно: налог с ранней прибыли сверх τ·Σ EBT
  EXPECT_LE(ytd.residuals.max(), 1e-9 * 5000);
}
