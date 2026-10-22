/**
 * Живые значения для формул карты (плейсхолдеры `InfoTip`) из последних ответов:
 * портфель Стадии 2 (`OptResultExt`), план Стадии 1 (`ScheduleResult`), прогноз.
 * Ключи — переменные записей `src/explain/metrics.*.ts`; доли передаются долями.
 */
import type { ForecastResult, ScheduleResult } from '../../lib/api'
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
    'opt.sigma': { sigma: m.std, n },
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
    'plan.labor_cost': { cost: k.labor_cost, n_workers: r.n_workers },
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

/** Все живые значения по id метрики. */
export function deriveValuesByMetric(opt: OptResultExt | null, plan: ScheduleResult | null, forecast: ForecastResult | null): ValuesByMetric {
  return { ...optValues(opt), ...planValues(plan), ...forecastValues(forecast) }
}
