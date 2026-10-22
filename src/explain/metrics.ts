/**
 * Реестр «i»-объяснений: как считается каждое вычисляемое число на экране.
 * Тексты документируют целевые определения docs/AUDIT-2026-10.md §4.2;
 * формулы сверены с backend/src (Scheduler.cpp, Optimizer.cpp, main.cpp).
 *
 *   import { getMetric } from '../../explain/metrics'
 *   <InfoTip id="plan.makespan" values={{ mean: 1123, det: 980, n: 600 }} />
 */
import { ANALYTICS_METRICS } from './metrics.analytics'
import { CASH_METRICS } from './metrics.cash'
import { FORECAST_METRICS } from './metrics.forecast'
import { INVEST_METRICS } from './metrics.invest'
import { OPT_METRICS } from './metrics.opt'
import { PLAN_METRICS } from './metrics.plan'
import type { MetricExplain } from './types'

export type { MetricExplain, MetricVariable, MethodologyAnchor } from './types'

/** Все записи в порядке доменов (для тестов целостности и экрана «Методика»). */
export const METRIC_LIST: readonly MetricExplain[] = [
  ...PLAN_METRICS,
  ...OPT_METRICS,
  ...FORECAST_METRICS,
  ...INVEST_METRICS,
  ...ANALYTICS_METRICS,
  ...CASH_METRICS,
]

export const METRICS: Readonly<Record<string, MetricExplain>> = Object.freeze(
  Object.fromEntries(METRIC_LIST.map((m) => [m.id, m])),
)

export function getMetric(id: string): MetricExplain | undefined {
  return Object.prototype.hasOwnProperty.call(METRICS, id) ? METRICS[id] : undefined
}

export function hasMetric(id: string): boolean {
  return getMetric(id) !== undefined
}
