#pragma once
/**
 * Точная CVaR-LP с кассовыми ограничениями по периодам — METHODOLOGY-V2 §5.2/§5.2а,
 * поверх ExactCvar (те же PWL-отрезки выручки, те же N сценариев — общие случайные
 * числа), решается HiGHS.
 *
 * Переменные: x_s (выпуск за горизонт), ỹ_s = ĝ_s(x_s) (PWL), и по сценарию i и
 * периоду t: касса C_{i,t} (свободная), долг D_{i,t} ∈ [0, Limit], транш d_{i,t} ≥ 0,
 * погашение rep_{i,t} ≥ 0, выручка R_{i,t}, налог T_{i,q} (в концах налоговых
 * периодов), η, u_i (CVaR прибыли), ζ, v_i (CVaR минимума кассы).
 *
 * Ограничения (линейны):
 *   R_{i,t} = Σ_s p_{i,s} φ_{s,t} ỹ_s                                   (выручка по отгрузкам)
 *   C_{i,t} = C_{i,t−1} + Σ_k w_k (1+τ_v) R_{i,t−k} − Σ_s c_{i,s}[ψ_{s,t} m_s (1+τ_v) + φ_{s,t}(1−m_s)] x_s
 *             − F_{i,t} − r_{i,t} D_{i,t−1} − rep_{i,t} + d_{i,t} − T_{i,t} − VAT_{i,t}   (касса)
 *   VAT_{i,t} — доли τ_v·(Σ_{τ∈кв} R_{i,τ} − Σ_s Π^{кв}_s c_{i,s} m_s x_s) по сетке уплаты
 *             (линейно: без зачёта отрицательного НДС вперёд — раскрытое упрощение)
 *   D_{i,t} = D_{i,t−1} + d_{i,t} − rep_{i,t} ≤ Limit                       (долг)
 *   Σ_{τ≤t} T_{i,τ} ≥ τ_p Σ_{τ≤t} EBT_{i,τ},  T ≥ 0                          (налог с NOL)
 *   Π_i = Σ_t R_{i,t} − Σ_s c_{i,s} x_s − Σ_t (r_{i,t} D_{i,t−1} + T_{i,t}) − r_{i,TT} D_{i,TT−1}
 *         (долг на конец горизонта несёт ещё один период процентов — иначе транш в последнем
 *          периоде «бесплатно» поднимал бы минимум кассы)
 *   u_i ≥ η − Π_i;   v_i ≥ ζ − C_{i,t} ∀t  (max(0, ζ − min_t C) = max_t max(0, ζ − C_t))
 *   ζ − (1/k_β) Σ_i v_i ≥ L_min                                              (ликвидность)
 *   max  η − (1/k_α) Σ_i u_i  (+ λ_L·(ζ − (1/k_β) Σ v_i))
 *
 * Рекурс (Р4): d_{i,t}, rep_{i,t} — по сценариям (второй этап); при firstStage —
 * одна переменная d_t, rep_t на период («график заранее», чувствительность);
 * разность целей = цена негибкого финансирования.
 * Двойственные: по мощностям — ₽/машино-час; по ликвидности — цена ликвидности
 * (₽ цели на ₽ L_min); по лимиту — цена лимита (из reduced cost границ D).
 * Чистый модуль: без БД и JSON (tests/test_cashlp.cpp).
 */
#include "ExactCvar.h"
#include <string>
#include <vector>

namespace maos::cashlp {

struct CashParams {
  double c0 = 0, d0 = 0, creditLimit = 0;   // [Н]/[НОРМ]
  double tauV = 0.22, tauP = 0.25;           // [НОРМ]
  int    vatPeriodWeeks = 13, vatInstalments = 3, vatInstalmentLagWeeks = 4;   // НДС к уплате [НОРМ]
  bool   vatRemittance = true;               // учитывать уплату НДС (τ_v·(выручка − материалы) периода)
  std::vector<double> dsoKernel{ 0.0, 0.5, 0.5 };  // w_k [О]/[К]
  int    taxPeriodWeeks = 4;                 // [НОРМ]
  double beta = 0.05;                        // уровень CVaR минимума кассы [К]
  bool   liquidityConstraint = true;         // CVaR_β(C_min) ≥ lMin
  double lMin = 0;                           // L_min [К]
  double lambdaL = 0;                        // вес CVaR_β(C_min) в цели (0 → чистый CVaR прибыли)
  bool   firstStage = false;                 // транши заранее (d_t общие по сценариям)
  int    runoffWeeks = 0;                    // периоды дорасчёта после горизонта (инкассация/оплата)
};

struct Problem {
  exact::Problem base;                       // цены/себестоимости N×S, рынок, мощности, доля
  int T = 1;                                 // недель в горизонте
  std::vector<std::vector<double>> ship;     // [s][t<T] φ_{s,t}: доля отгрузки, Σ_t = 1
  std::vector<std::vector<double>> pay;      // [s][t<T+runoff] ψ_{s,t}: доля оплаты себестоимости
  std::vector<double> vatCostShare;          // [s] m_s — доля себестоимости с НДС (материалы)
  std::vector<std::vector<double>> fixed;    // [i][t<T+runoff] F_{i,t}
  std::vector<std::vector<double>> rate;     // [i][t<T+runoff] r_{i,t} периодная (неделя)
  CashParams cp;
};

struct Result {
  std::string status = "error", reason;
  double solveMs = 0; int nCols = 0, nRows = 0; long nNz = 0;
  double lpObjective = 0;                    // значение LP (PWL), ден. ед.
  double objective = 0;                      // критерий на истинной g (прибыль с процентами/налогом)
  std::vector<double> x, xRounded;
  std::vector<double> profit;                // [i] Π_i (истинная g)
  exact::Metrics metrics;                    // по profit
  double eta = 0, zeta = 0;
  double cfar = 0;                           // CVaR_β(min_t C_{i,t}) по решению LP
  double pNegativeCash = 0;                  // доля сценариев с min_t C_{i,t} < 0
  std::vector<double> minCash;               // [i]
  std::vector<std::vector<double>> cash, debt, draw, repay, tax;   // [i][t]
  std::vector<double> interestTotal, taxTotal;                     // [i]
  std::vector<exact::Dual> duals;            // по мощностям (индекс = ресурс base.capacity)
  double liquidityDual = 0;                  // ∂цели/∂L_min (≤ 0): −цена ликвидности
  bool   liquidityBinding = false;
  double creditLimitDual = 0;                // ∂цели/∂Limit (≥ 0), среднее по сценариям
  int    tailK = 1, tailKBeta = 1;
};

Result solve(const Problem& pb);

/** Профиль «равномерно по горизонту» (φ_{s,t} = 1/T) — по умолчанию без опорного расписания [К]. */
std::vector<double> uniform_profile(int T);
/** Ядро оплаты ψ из профиля производства: предоплата φ за leadWeeks до, остаток через dpoWeeks. */
std::vector<double> payment_profile(const std::vector<double>& production, double prepayShare,
                                    int leadWeeks, int dpoWeeks, int totalLen);

}  // namespace maos::cashlp
