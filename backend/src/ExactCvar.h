#pragma once
/**
 * Точная модель Стадии 2 (Rockafellar & Uryasev 2000; 2002): LP по ТЕМ ЖЕ N
 * сценариям, что и эвристика (общие случайные числа), решается HiGHS.
 *
 *   max  F(P(x))  при  Σ_s h_{s,w}·x_s ≤ Cap_w ∀w,  0 ≤ x_s ≤ U_s,
 *                      x_s·w_s ≤ maxShare·Σ_t x_t·w_t ∀s   (если включено),
 *   P_i(x) = Σ_s ( price_{i,s}·g_s(x_s) − cost_{i,s}·x_s ),
 *   g_s(q) = min(q, absorb_s)·clamp(1 + e_s·(1 − (C_s + q)/Cap_s), lo, hi).
 *
 * g_s вогнута (e_s ≥ 0) и заменяется кусочно-линейной вогнутой интерполяцией ĝ_s
 * (K отрезков, наклоны не возрастают) — точное LP без бинарных переменных: цены ≥ 0,
 * а критерии (CVaR / матожидание / худший случай) монотонны по P_i. Поскольку
 * ĝ ≤ g, значение LP — гарантированная НИЖНЯЯ граница истинного оптимума, а
 * истинный оптимум ≤ LP + δ, δ = Σ_s max_i price_{i,s}·sup_q (g_s − ĝ_s).
 *
 *   cvar     : max η − (1/k)·Σ u_i,  u_i ≥ η − P_i(x), u_i ≥ 0,  k = max(1,⌊αN⌋)
 *              (вес 1/k вместо 1/(αN) — ровно эмпирический CVaR эвристики);
 *   expected : max (1/N)·Σ P_i(x);
 *   worst    : max t,  t ≤ P_i(x) ∀i.
 *
 * Чистый модуль: без БД и JSON — проверяется юнит-тестами (tests/test_exact.cpp).
 */
#include <string>
#include <utility>
#include <vector>

namespace maos::exact {

enum class Criterion { Cvar, Expected, Worst };
const char* criterion_name(Criterion c);

/** Модель спроса изделия — та же формула, что priceMul()/soldOf() в Optimizer.cpp. */
struct Market {
  double capM       = 0;      // ёмкость рынка, ед. (≤ 0 → модели нет: множитель 1)
  double competitor = 0;      // объём конкурентов, ед.
  double elasticity = 0;      // наклон множителя цены по насыщению
  double absorb     = 1e18;   // потолок продаж, ед.
  double mulLo = 0.5, mulHi = 1.3;
};
double price_mult(const Market& mk, double q);
double revenue_volume(const Market& mk, double q);   // g(q) = min(q, absorb)·mult(q)

/** Кусочно-линейная интерполяция g на [0, D] (узлы — точно на g). */
struct Pwl {
  std::vector<double> len, slope;   // отрезки слева направо
  double domain  = 0;               // D
  double maxErr  = 0;               // sup_q (g − ĝ) ≥ 0, в ед. «объём × множитель»
  bool   concave = true;            // наклоны не возрастают (иначе LP без бинарных неточно)
};
Pwl build_pwl(const Market& mk, double domain, int minSegments, int maxSegments, double relTol);
double eval_pwl(const Pwl& f, double q);

using Matrix = std::vector<std::vector<double>>;    // [сценарий i][изделие s]

struct Problem {
  Matrix price, cost;                               // N × S (общие случайные числа)
  std::vector<Market> market;                       // [s]
  std::vector<double> upper;                        // [s] U_s (≥ 0; ∞ допустима)
  std::vector<double> batch;                        // [s] размер партии (≥ 1) для округления
  std::vector<double> capacity;                     // [w] фонд, ч
  std::vector<std::vector<std::pair<int,double>>> usage;   // [s] → (w, ч/ед.)
  bool   enforceMaxShare = false;
  double maxShare = 1.0;
  std::vector<double> shareWeight;                  // [s] вес доли (средняя цена — как в эвристике)
  double alpha = 0.10;
  Criterion criterion = Criterion::Cvar;
  int    minSegments = 16, maxSegments = 64;
  double pwlRelTol   = 1e-4;                        // целевая отн. ошибка ĝ на отрезке
  double timeLimitSec = 30;
};

struct Metrics { double expected = 0, cvar = 0, worst = 0; };
int     tail_count(double alpha, int n);            // k = max(1, ⌊αN⌋) — как metrics_of()
Metrics evaluate(const Problem& pb, const std::vector<double>& x);
Metrics evaluate_on(const Problem& pb, const Matrix& price, const Matrix& cost,
                    const std::vector<double>& x);
double  objective_of(Criterion c, const Metrics& m);

struct Dual {
  int    resource = -1;
  double shadowPrice = 0;    // ∂F*/∂Cap_w, ден. ед. за машино-час (≥ 0)
  double load = 0, capacity = 0, utilization = 0;
  bool   binding = false;
};

struct Result {
  std::string status = "error";   // optimal | infeasible | unbounded | time_limit | error
  std::string reason;
  double lpObjective = 0;         // значение PWL-LP = нижняя граница истинного оптимума
  double pwlMaxError = 0;         // δ: истинный оптимум ≤ lpObjective + δ
  double pwlMaxRelError = 0;
  bool   pwlConcave = true;
  int    pwlSegments = 0, pwlSegmentsTotal = 0;
  std::vector<double> x;          // решение LP (непрерывное)
  Metrics metrics;                // x на ИСТИННОЙ g
  double  objective = 0;
  std::vector<double> xRounded;   // кратно партиям, допустимо
  Metrics roundedMetrics;
  double  roundedObjective = 0;
  bool    roundedMaxShareOk = true;
  std::vector<Dual> duals;
  double solveMs = 0;
  int    nCols = 0, nRows = 0;
  long   nNz = 0;
  int    tailK = 1;
};

Result solve(const Problem& pb);

const char* solver_version();      // "1.15.1"

}  // namespace maos::exact
