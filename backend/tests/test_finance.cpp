// B6 — финансовая математика инвестпроекта (Finance.h).
#include "Finance.h"
#include <gtest/gtest.h>
#include <cmath>

namespace fin = maos::finance;

TEST(Finance, MonthlyRateIsEffectiveNotNominal) {
  const double rm = fin::monthly_rate(0.18);
  EXPECT_NEAR(rm, std::pow(1.18, 1.0 / 12.0) - 1.0, 1e-15);
  EXPECT_LT(rm, 0.18 / 12.0);                         // эффективная < номинальной r/12
  EXPECT_NEAR(fin::annual_effective(rm), 0.18, 1e-12); // туда-обратно
}

TEST(Finance, NpvOfAnnuityMatchesClosedForm) {
  // capex = 1000, cf = 100/мес, 12 мес, r_m = 1% → PV = 100·(1−1.01^−12)/0.01.
  const double pv = 100.0 * (1.0 - std::pow(1.01, -12)) / 0.01;
  EXPECT_NEAR(fin::npv(1000.0, 100.0, 12, 0.01), pv - 1000.0, 1e-9);
  EXPECT_NEAR(fin::npv(1000.0, 100.0, 12, 0.0), 200.0, 1e-12);  // без дисконта
}

TEST(Finance, IrrRecoversKnownRateAndNpvAtIrrIsZero) {
  // Поток построен так, что месячная ВНД = 1% ровно.
  const double capex = 100.0 * (1.0 - std::pow(1.01, -12)) / 0.01;
  const auto irr = fin::irr_monthly(capex, 100.0, 12);
  ASSERT_TRUE(irr.has_value());
  EXPECT_NEAR(*irr, 0.01, 1e-10);
  EXPECT_NEAR(fin::npv(capex, 100.0, 12, *irr), 0.0, 1e-7);
  // Согласованность ЧДД ↔ ВНД: годовая ВНД как ставка дисконта даёт ЧДД = 0.
  const double irrAnnual = fin::annual_effective(*irr);
  EXPECT_NEAR(irrAnnual, std::pow(1.01, 12) - 1.0, 1e-9);
  EXPECT_NEAR(fin::npv(capex, 100.0, 12, fin::monthly_rate(irrAnnual)), 0.0, 1e-6);
}

TEST(Finance, NpvAtIrrIsZeroForTypicalProject) {
  // 5 лет, capex 12 млн, ΔCF 300 тыс./мес.
  const auto irr = fin::irr_monthly(12e6, 3e5, 60);
  ASSERT_TRUE(irr.has_value());
  EXPECT_NEAR(fin::npv(12e6, 3e5, 60, *irr), 0.0, 1e-3);   // |ЧДД| < 0.001 ₽ при 12 млн
  EXPECT_GT(*irr, 0.0);
}

TEST(Finance, NegativeIrrReportedHonestly) {
  // Σcf = 1200 < capex = 1500 → поток не возвращает вложения: ВНД < 0 (а не 0).
  const auto irr = fin::irr_monthly(1500.0, 100.0, 12);
  ASSERT_TRUE(irr.has_value());
  EXPECT_LT(*irr, 0.0);
  EXPECT_NEAR(fin::npv(1500.0, 100.0, 12, *irr), 0.0, 1e-7);
}

TEST(Finance, IrrUndefinedCases) {
  EXPECT_FALSE(fin::irr_monthly(1000.0, 0.0, 12).has_value());    // нет притока
  EXPECT_FALSE(fin::irr_monthly(1000.0, -50.0, 12).has_value());  // отрицательный поток
  EXPECT_FALSE(fin::irr_monthly(0.0, 100.0, 12).has_value());     // без вложений ВНД = ∞
}

TEST(Finance, DiscountedPaybackHandChecked) {
  // capex 250, cf 100, r_m = 10%: PV по месяцам 90.909, 82.645, 75.131, 68.301 …
  // накоплено к концу 3-го мес 248.685 → DPP = 3 + (250 − 248.685)/68.301 = 3.01925.
  const auto dpp = fin::discounted_payback_months(250.0, 100.0, 12, 0.10);
  ASSERT_TRUE(dpp.has_value());
  const double cum3 = 100 / 1.1 + 100 / 1.21 + 100 / 1.331;
  EXPECT_NEAR(*dpp, 3.0 + (250.0 - cum3) / (100.0 / 1.4641), 1e-12);
  EXPECT_NEAR(*dpp, 3.01925, 1e-5);
}

TEST(Finance, DiscountedPaybackEqualsSimpleAtZeroRateAndExceedsItOtherwise) {
  const auto dpp0 = fin::discounted_payback_months(1000.0, 100.0, 60, 0.0);
  ASSERT_TRUE(dpp0.has_value());
  EXPECT_NEAR(*dpp0, 10.0, 1e-12);
  EXPECT_NEAR(*fin::simple_payback_months(1000.0, 100.0), 10.0, 1e-12);
  const auto dpp = fin::discounted_payback_months(1000.0, 100.0, 60, fin::monthly_rate(0.18));
  ASSERT_TRUE(dpp.has_value());
  EXPECT_GT(*dpp, 10.0);
}

TEST(Finance, DiscountedPaybackNotReachedWithinLife) {
  EXPECT_FALSE(fin::discounted_payback_months(1500.0, 100.0, 12, 0.0).has_value());
  EXPECT_FALSE(fin::discounted_payback_months(1000.0, 0.0, 12, 0.01).has_value());
  EXPECT_DOUBLE_EQ(*fin::discounted_payback_months(0.0, 100.0, 12, 0.01), 0.0);
}
