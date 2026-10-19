#pragma once
/**
 * Финансовая математика инвестпроекта (ЧДД / ВНД / сроки окупаемости) —
 * чистые функции без состояния, чтобы их можно было проверить юнит-тестами.
 *
 * Соглашения (Методические рекомендации по оценке эффективности инвестиционных
 * проектов, ВК 477, 1999; AUDIT-2026-10 §4.2):
 *   - годовая ставка дисконтирования r — ЭФФЕКТИВНАЯ; месячная ставка
 *     r_m = (1 + r)^{1/12} − 1 (а не номинальная r/12) — везде одна и та же;
 *   - денежный поток: −capex в момент 0, затем постоянный cf в конце каждого
 *     месяца t = 1..months;
 *   - ВНД (IRR) ищется как месячная ставка i, при которой ЧДД = 0, и
 *     пересчитывается в эффективную годовую (1 + i)^12 − 1 — поэтому
 *     «ВНД = ставке дисконта» ⇔ «ЧДД = 0».
 */
#include <algorithm>
#include <cmath>
#include <optional>

namespace maos::finance {

/** Месячная ставка, эквивалентная эффективной годовой: (1+r)^{1/12} − 1. */
inline double monthly_rate(double annualEffective) {
  return std::pow(1.0 + annualEffective, 1.0 / 12.0) - 1.0;
}

/** Эффективная годовая ставка из месячной: (1+r_m)^12 − 1. */
inline double annual_effective(double monthly) {
  return std::pow(1.0 + monthly, 12.0) - 1.0;
}

/** ЧДД (NPV) потока −capex, затем cf в месяцы 1..months при месячной ставке rm. */
inline double npv(double capex, double cfMonthly, int months, double rm) {
  double v = -capex;
  const double x = 1.0 / (1.0 + rm);   // дисконт-множитель одного месяца
  double df = 1.0;
  for (int t = 1; t <= months; ++t) { df *= x; v += cfMonthly * df; }
  return v;
}

/**
 * Месячная ВНД (IRR) для «обычного» потока (capex > 0, cf > 0, months ≥ 1).
 * Ищем корень по x = 1/(1+i) ∈ (0, ∞): f(x) = −capex + cf·Σ x^t строго
 * возрастает, f(0) = −capex < 0, f(∞) = +∞ ⇒ корень единственный, и ВНД может
 * быть ОТРИЦАТЕЛЬНОЙ (поток за срок жизни не возвращает capex) — она возвращается
 * честно, без «зажима» в 0. nullopt — ВНД не определена (cf ≤ 0: ЧДД < 0 при
 * любой ставке; capex ≤ 0: ВНД бесконечна).
 */
inline std::optional<double> irr_monthly(double capex, double cfMonthly, int months) {
  if (!(capex > 0) || !(cfMonthly > 0) || months < 1) return std::nullopt;
  auto f = [&](double x) {
    double s = 0, p = 1.0;
    for (int t = 1; t <= months; ++t) { p *= x; s += p; }
    return -capex + cfMonthly * s;
  };
  double lo = 0.0, hi = 1.0;
  for (int g = 0; g < 1000 && f(hi) <= 0; ++g) hi *= 2.0;   // f(hi) > 0 — правая граница (конечна)
  for (int it = 0; it < 300; ++it) {
    const double mid = 0.5 * (lo + hi);
    (f(mid) > 0 ? hi : lo) = mid;
  }
  const double x = 0.5 * (lo + hi);
  return 1.0 / x - 1.0;
}

/** Простой срок окупаемости, мес: capex / cf; nullopt — не окупается (cf ≤ 0). */
inline std::optional<double> simple_payback_months(double capex, double cfMonthly) {
  if (!(cfMonthly > 0)) return std::nullopt;
  return std::max(0.0, capex) / cfMonthly;
}

/**
 * Дисконтированный срок окупаемости (ВК 477), мес: наименьшее t, при котором
 * Σ_{τ≤t} cf/(1+rm)^τ ≥ capex; внутри месяца — линейная интерполяция.
 * nullopt — дисконтированный поток не возвращает capex за `months` месяцев.
 */
inline std::optional<double> discounted_payback_months(double capex, double cfMonthly,
                                                       int months, double rm) {
  if (!(capex > 0)) return 0.0;
  if (!(cfMonthly > 0)) return std::nullopt;
  double cum = 0, df = 1.0;
  const double x = 1.0 / (1.0 + rm);
  for (int t = 1; t <= months; ++t) {
    df *= x;
    const double d = cfMonthly * df;
    if (cum + d >= capex) return (t - 1) + (capex - cum) / d;
    cum += d;
  }
  return std::nullopt;
}

}  // namespace maos::finance
