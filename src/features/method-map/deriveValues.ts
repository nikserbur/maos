/**
 * Живые значения для формул карты (плейсхолдеры `InfoTip`) из последних ответов:
 * портфель Стадии 2 (`OptResultExt`), план Стадии 1 (`ScheduleResult`), прогноз.
 * Ключи — переменные записей `src/explain/metrics.*.ts`; доли передаются долями.
 */
import type { CashLpResult, FinParams, ForecastResult, MacroSummary, ScheduleResult } from '../../lib/api'
import type { OptResultExt } from '../optimization/optTypes'
import { isSoft } from '../optimization/optTypes'

export type MetricValues = Readonly<Record<string, number | string | null | undefined>>
export type ValuesByMetric = Record<string, MetricValues>

function optValues(r: OptResultExt | null): ValuesByMetric {
  if (!r || isSoft(r)) return {}
  const m = r.robust.metrics
  const div = r.robust.diversification
  const n = r.samples
  const topLoad = [...(r.robust.resource_load ?? [])].sort((a, b) => b.utilization - a.utilization)[0]
  const out: ValuesByMetric = {
    'opt.cvar': { cvar: m.cvar, alpha: r.alpha, n },
    'opt.expected': { expected: m.expected, n },
    'opt.var': { var: m.var, alpha: r.alpha },
    'opt.worst': { worst: m.worst_case, n },
    'opt.p_loss': { p_loss: m.p_loss, n },
    'opt.max_regret': { regret: m.max_regret, n },
    'opt.sigma': { std: m.std, n },
    'opt.hhi': { hhi: div.hhi, n_products: div.n_products },
    'opt.effective_n': { eff: div.effective_n, hhi: div.hhi, n_products: div.n_products },
    'opt.max_share': { limit: r.max_share },
    'opt.price_of_robustness': { por: r.price_of_robustness, e_exp: r.expected.metrics.expected, e_rob: m.expected },
    'opt.pareto': { n_pareto: r.candidates.filter((c) => c.is_pareto).length, n_cand: r.candidates.length },
  }
  if (topLoad) out['opt.resource_load'] = { util: topLoad.utilization, load: topLoad.load_hours, cap: topLoad.capacity_hours }
  if (r.oos) {
    out['opt.oos_gap'] = {
      gap_e: r.oos.gap_expected, gap_cvar: r.oos.gap_cvar,
      e_in: m.expected, e_out: r.oos.expected, cvar_in: m.cvar, cvar_out: r.oos.cvar,
    }
  }
  return out
}

function planValues(r: ScheduleResult | null): ValuesByMetric {
  if (!r || r.error_soft) return {}
  const k = r.kpi
  const chosen = r.rules.find((x) => x.chosen)
  const qty = r.program.reduce((s, p) => s + p.qty, 0)
  const peak = [...(r.queue_by_wc ?? [])].sort((a, b) => b.peak - a.peak)[0]
  const out: ValuesByMetric = {
    'plan.makespan': { mean: k.makespan_mean, det: k.makespan, n: r.samples },
    'plan.makespan_cvar': { cvar: k.makespan_cvar, worst: k.makespan_worst, alpha: r.alpha, n: r.samples },
    'plan.tardiness': { tard: k.tardiness, tard_cvar: k.tardiness_cvar, n_late: k.n_late },
    'plan.otd': { otd: k.otd, n: r.n_orders, n_late: k.n_late },
    'plan.utilization': { util: k.utilization, fund: r.calendar.work_fond_hours, n_machines: r.n_machines },
    'plan.cost': { cost: k.cost, n_jobs: r.n_jobs },
    'plan.rule_score': { rule: r.rule, score: chosen?.score, w_t: r.weights.time, w_r: r.weights.risk, w_c: r.weights.cost },
    'plan.bottleneck': { name: r.bottleneck.wc_name, util: r.bottleneck.utilization },
    'plan.throughput': { th: k.throughput_per_day, qty, cmax: k.makespan_mean },
    'plan.wip': { wip: k.wip_avg, n: r.n_orders, cmax: k.makespan_mean, flow: k.flow_time_mean_h },
    'plan.flow_time': { flow: k.flow_time_mean_h, n: r.n_orders },
    'plan.setup_share': { setup: k.setup_hours, n_setups: k.n_setups, fund: r.calendar.work_fond_hours },
    'plan.wait_share': { share: k.wait_share },
    'plan.maintenance': { maint: k.maintenance_hours, repair: k.breakdown_hours_mean, n: r.samples },
    'plan.labor_cost': { labor: k.labor_cost, n_workers: r.n_workers },
  }
  if (r.improver?.validation) {
    const v = r.improver.validation
    out['plan.ga'] = { val: v.improvement_pct / 100, nv: v.scenarios, gens: r.improver.iterations }
  }
  if (peak) out['plan.queue_peak'] = { peak: peak.peak, wc: peak.wc_name }
  return out
}

function forecastValues(f: ForecastResult | null): ValuesByMetric {
  if (!f) return {}
  const out: ValuesByMetric = {}
  const idx = f.inflation_index
  if (idx.length) out['forecast.inflation'] = { cum: (idx[idx.length - 1] - 100) / 100, pi: f.inflation_monthly, months: f.months }
  const withBt = f.products.find((p) => p.backtest)
  if (withBt?.backtest) {
    const b = withBt.backtest
    out['forecast.backtest'] = { mape: b.mape, mape_naive: b.mape_naive, skill: b.skill, coverage: b.coverage80, k: b.k }
  }
  const first = f.products[0]
  if (first) {
    const last = first.p50.length - 1
    out['forecast.fan'] = { base: first.base, p10: first.p10[last], p50: first.p50[last], p90: first.p90[last], months: f.months }
  }
  return out
}

/** Денежный слой (POST /api/optimize/cash): водопад на решении LP, цена ликвидности. */
function cashValues(c: CashLpResult | null, fin: FinParams | null): ValuesByMetric {
  if (!c) return {}
  const w = c.waterfall?.lp_recourse ?? c.waterfall?.rule
  const out: ValuesByMetric = {}
  if (w) {
    Object.assign(out, {
      'cash.cash_min_p50': { cash_min: w.cash_min_p50, n: c.n_scenarios, weeks: c.horizon_weeks },
      'cash.cfar': { cfar: w.cfar, beta: c.beta, n: c.n_scenarios, ci_lo: w.cfar_ci?.[0], ci_hi: w.cfar_ci?.[1] },
      'cash.p_breach': { p: w.p_breach, ci_lo: w.p_breach_ci?.[0], ci_hi: w.p_breach_ci?.[1], warn: 0.05, bad: 0.15 },
      'cash.t_breach_p10': { t: w.p_breach > 0 ? w.t_breach_p10 : null },
      'cash.dscr_min_p05': { dscr: w.dscr_min_p05, covenant: fin?.dscr_covenant ?? 1.2, p_cov: w.p_covenant },
      'cash.debt_peak': { peak: w.debt_peak, share: w.debt_peak_share, limit: c.duals?.credit_limit ?? fin?.credit_limit },
      'cash.int_cost': { int: w.int_cost, rate: c.weekly_rate * 52 },
      'cash.wc_avg': { wc: w.wc_avg },
      'cash.npv': { npv_o: w.npv_owner_mean, p_neg: w.p_npv_owner_neg, npv_b: w.npv_bank_mean },
      'cash.tax_paid': { tax: w.tax_paid, tau_v: fin?.tau_v, tau_p: fin?.tau_p },
    })
  }
  if (c.price_of_liquidity) {
    const p = c.price_of_liquidity
    out['cash.pol'] = { pol: p.value, ci_lo: p.ci?.[0], ci_hi: p.ci?.[1], pol_obj: p.objective_delta, dual: p.local_dual }
  }
  return out
}

/** CRPS обученного макро-генератора на отложенных целях (GET /api/macro/summary). */
function macroValues(m: MacroSummary | null): ValuesByMetric {
  if (!m) return {}
  const h = m.holdout?.variables
  const avg = (f: (v: NonNullable<typeof h>[keyof NonNullable<typeof h>]) => number) =>
    h ? Object.values(h).reduce((a, v) => a + f(v), 0) / Object.values(h).length : null
  const crps = avg((v) => v.mean_CRPS)
  const naive = avg((v) => v.mean_CRPS_persistence)
  return {
    'forecast.crps': {
      crps, crps_naive: naive, skill: crps != null && naive ? 1 - crps / naive : null,
      coverage: avg((v) => v.coverage80),
    },
  }
}

/** Все живые значения по id метрики. */
export function deriveValuesByMetric(
  opt: OptResultExt | null, plan: ScheduleResult | null, forecast: ForecastResult | null,
  cash: CashLpResult | null = null, fin: FinParams | null = null, macro: MacroSummary | null = null,
): ValuesByMetric {
  return { ...optValues(opt), ...planValues(plan), ...forecastValues(forecast), ...cashValues(cash, fin), ...macroValues(macro) }
}
