#pragma once
/**
 * Волна A3 (PLAN-V2 §9): оценка инвестпроекта L3 на ОБЩИХ сценариях (CRN) через кассовый водопад.
 *
 * Для каждого сценария i — два прогона SimEnv на одних и тех же случайных числах: «база» и «с проектом»
 * (кандидат куплен в неделю w, CAPEX — транши кредитной линии по ключевой ставке пути + спред, амортизация,
 * ТО/экипаж, ввод через lead недель; модернизация — MTBF↑/ремонт↓). По разностям:
 *
 *   ЧДД_i = DF_H · Δ(C_H − D_H)  +  DF_H · g_i · a(r_w, n_cont)            (ВК 477, собственник, ставка r_O)
 *     Δ(C_H − D_H) — прирост стоимости собственника на горизонте (касса минус долг: CAPEX, проценты, выручка);
 *     g_i = [ΔΠ_i + (ΔDep + ΔInt)(1 − τ_p)] / n_post — прирост операционного потока после налога в неделю
 *           использования (n_post недель после ввода), продлённый на n_cont = min(срок службы − n_post, cont)
 *           недель [К] rl.a3.invest.continuation («портфель повторяется»), в конце — остаточная балансовая
 *           стоимость × salvage (ликвидационная); cont = 0 → только горизонт + остаточная стоимость;
 *           a(r, n) = Σ_{t=1..n} (1+r)^{−t}.
 *   Дисконтированный срок окупаемости (ВК 477) — по потоку E: −CAPEX в неделю заказа, затем E[g] с недели ввода.
 *
 * Правило применения (§9): E[ЧДД] > 0, CVaR_β(C_min | проект) ≥ min(L, CVaR_β(C_min | база)) и нижняя граница
 * 95 %-ДИ (бутстреп по сценариям) E[ΔΠ] > 0 — на ОТЛОЖЕННЫХ сценариях (holdout-набор, переданный вызывающим).
 */
#include "SimEnv.h"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace maos::invest {

using nlohmann::json;

struct EvalCfg {
  std::string rule = "EDD";            // диспетчеризация L0 обоих прогонов (статический чемпион)
  std::vector<double> key;             // или ключ (CP-SAT/ГА), если задан
  int week = 0;                        // неделя заказа
  double alpha = 0.1, beta = 0.05;     // CVaR прибыли / минимума кассы [К]
  double liqThreshold = 0.0;           // порог ликвидности L для CVaR_β(C_min) [К] rl.a3.invest.liq
  int contWeeks = 260;                 // продление операционного эффекта, недель (0 → только горизонт) [К]
  double salvage = 0.7;                // остаточная стоимость без продления: доля балансовой [К]
  int bootB = 1000; unsigned bootSeed = 1;
  int threads = 0;                     // 0 → hardware_concurrency
};

/** Недельная ставка из годовой эффективной: (1+r)^{1/52} − 1 (как CashWaterfall::weekly_rate). */
double weekly(double annual);
/** Аннуитетный множитель a(r, n) = Σ_{t=1..n} (1+r)^{−t}. */
double annuity(double r, int n);
/** Дисконтированный срок окупаемости потока: −capex в 0, затем cf в недели from..from+n−1; −1 → не окупается. */
double discounted_payback_weeks(double capex, double cf, int from, int n, double r);

/** Оценка кандидата c экземпляра (кандидаты — inst.investCands) на сценариях scen с seed seeds[i] (CRN). */
json evaluate(const env::Instance& inst, env::EnvConfig cfg, int c, const std::vector<env::Scenario>& scen,
              const std::vector<uint64_t>& seeds, const EvalCfg& ec);

/** Лучшее из 7 правил (EDD…FIFO) по CVaR_α прибыли на сценариях (без ходов): (правило, {правило: {cvar, mean}}). */
std::pair<std::string, json> choose_rule(const env::Instance& inst, env::EnvConfig cfg, const std::vector<env::Scenario>& scen,
                                         const std::vector<uint64_t>& seeds, double alpha, int threads);

/** Кандидаты L3 по TOC (узкое место детерминированного плана правила), модернизация узкого места и тип с
 *  наибольшей ценностью мощности по двойственным ценам (dualTypes — по убыванию; пусто → второй по загрузке).
 *  capexPerMachine ≤ 0 → 1.5 × 4000 ч × ставка типа [К]. */
std::vector<env::InvestCand> candidates(const env::Instance& inst, const std::string& rule,
                                        const std::vector<std::string>& dualTypes, double capexPerMachine);

}  // namespace maos::invest
