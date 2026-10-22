/**
 * Денежные KPI (категория «Деньги» каталога) живут не в plans.kpi_json, а в ответе
 * POST /api/optimize/cash. Чтобы каталог читал их тем же `kpiField(b, 'cash_*')`,
 * результат кассы «вливается» в KPI-блок плана: новый объект, исходный не меняется.
 * Светофоры — из fin_params (не из кода), ставки налогов — тоже.
 */
import type { CashLpResult, FinParams, KpiBundle } from '../../lib/api'

/** Пороги светофоров §6.0 по умолчанию (копия паспорта kpi.*); перекрываются fin_params при появлении полей. */
const THR = { breachWarn: 0.05, breachBad: 0.15, debtWarn: 0.7, debtBad: 0.9 }

export function cashKpiFields(cash: CashLpResult, fin?: FinParams | null): Record<string, number> {
  const w = cash.waterfall?.lp_recourse ?? cash.waterfall?.rule
  const out: Record<string, number> = {
    cash_n: cash.n_scenarios, cash_weeks: cash.horizon_weeks, cash_beta: cash.beta,
    cash_rate: cash.weekly_rate * 52,
    cash_credit_limit: cash.duals?.credit_limit ?? fin?.credit_limit ?? Number.NaN,
    cash_thr_breach_warn: THR.breachWarn, cash_thr_breach_bad: THR.breachBad,
    cash_thr_debt_warn: THR.debtWarn, cash_thr_debt_bad: THR.debtBad,
    cash_dscr_covenant: fin?.dscr_covenant ?? 1.2,
    cash_tau_v: fin?.tau_v ?? Number.NaN, cash_tau_p: fin?.tau_p ?? Number.NaN,
  }
  if (w) {
    Object.assign(out, {
      cash_min_p50: w.cash_min_p50, cash_cfar: w.cfar, cash_cfar_lo: w.cfar_ci?.[0], cash_cfar_hi: w.cfar_ci?.[1],
      cash_p_breach: w.p_breach, cash_p_breach_lo: w.p_breach_ci?.[0], cash_p_breach_hi: w.p_breach_ci?.[1],
      cash_t_breach_p10: w.p_breach > 0 ? w.t_breach_p10 : Number.NaN,
      cash_dscr_min_p05: w.dscr_min_p05, cash_p_covenant: w.p_covenant,
      cash_debt_peak: w.debt_peak, cash_debt_peak_share: w.debt_peak_share,
      cash_int_cost: w.int_cost, cash_wc_avg: w.wc_avg, cash_tax_paid: w.tax_paid,
      cash_npv_owner: w.npv_owner_mean, cash_npv_bank: w.npv_bank_mean, cash_p_npv_neg: w.p_npv_owner_neg,
    })
  }
  const pol = cash.price_of_liquidity
  if (pol) Object.assign(out, { cash_pol: pol.value, cash_pol_lo: pol.ci?.[0], cash_pol_hi: pol.ci?.[1], cash_pol_obj: pol.objective_delta, cash_pol_dual: pol.local_dual })
  return out
}

/** KPI-блок плана с полями кассы (иммутабельно). Без результата кассы — тот же объект. */
export function withCashKpis(bundle: KpiBundle, cash: CashLpResult | null | undefined, fin?: FinParams | null): KpiBundle {
  if (!cash) return bundle
  return { ...bundle, kpi: { ...bundle.kpi, ...cashKpiFields(cash, fin) } }
}
