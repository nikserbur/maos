/**
 * Живые значения для каждого «i» экрана «Портфель» (X2: формула в «i» — с числами, без «—»).
 * Один источник для компонентов и для теста реестра (src/explain/metrics.test.ts): тест проверяет,
 * что каждая подсказка экрана получает все ключи своей формулы.
 */
import type { OptMetrics, OptPortfolio } from '../../lib/api'
import type { InfoTipValues } from '../../ui/InfoTip'
import { exactGapValue } from './optText'
import type { OptResultExt } from './optTypes'

/** Подсказки метрик одного портфеля (герой — устойчивый, «Для сравнения» — «макс. E»). */
export function metricValues(m: OptMetrics, n: number, alpha: number) {
  return {
    'opt.expected': { expected: m.expected, n },
    'opt.cvar': { cvar: m.cvar, alpha, n },
    'opt.var': { var: m.var, alpha },
    'opt.sigma': { std: m.std },
    'opt.p_loss': { p_loss: m.p_loss, n },
    'opt.worst': { worst: m.worst_case, n },
    'opt.max_regret': { regret: m.max_regret },
  } satisfies Record<string, InfoTipValues>
}

/** Состав портфеля: HHI, макс. доля против предела, вклад в риск крупнейшей позиции. */
export function compositionValues(pf: OptPortfolio, limit: number, topName?: string) {
  const d = pf.diversification
  const top = [...pf.items].filter((it) => it.qty > 0).sort((a, b) => b.contribution - a.contribution)[0]
  return {
    'opt.hhi': { hhi: d.hhi, n_products: d.n_products },
    'opt.max_share': { share: d.concentration, limit },
    'opt.risk_contribution': { rc: top?.risk_contribution ?? null, product: topName ?? top?.product_id ?? null },
  } satisfies Record<string, InfoTipValues>
}

/** Загрузка: верхняя строка (самый загруженный тип). */
export function loadValues(pf: OptPortfolio) {
  const top = [...pf.resource_load].sort((a, b) => b.utilization - a.utilization)[0]
  return { 'opt.resource_load': { load: top?.load_hours ?? null, cap: top?.capacity_hours ?? null, util: top?.utilization ?? null } }
}

export function porValues(r: OptResultExt) {
  return { 'opt.price_of_robustness': { por: r.price_of_robustness, e_exp: r.expected.metrics.expected, e_rob: r.robust.metrics.expected } }
}

export function paretoValues(r: OptResultExt) {
  return { 'opt.pareto': { n_pareto: r.candidates.filter((c) => c.is_pareto).length, n_cand: r.candidates.length } }
}

export function oosValues(r: OptResultExt): Partial<Record<'opt.oos_gap', InfoTipValues>> {
  const o = r.oos
  if (!o) return {}
  const m = r.robust.metrics
  return { 'opt.oos_gap': { e_in: m.expected, e_out: o.expected, gap_e: o.gap_expected, cvar_in: m.cvar, cvar_out: o.cvar, gap_cvar: o.gap_cvar } }
}

export function exactValues(r: OptResultExt): Partial<Record<'opt.exact_gap', InfoTipValues>> {
  const g = r.exact?.status === 'optimal' ? r.exact.gap_vs_heuristic ?? {} : null
  if (!g) return {}
  return {
    'opt.exact_gap': {
      g_obj: exactGapValue(g.objective_pct), g_oos: exactGapValue(g.oos_objective_pct),
      g_e: exactGapValue(g.expected_pct), g_cvar: exactGapValue(g.cvar_pct),
    },
  }
}

export interface ScreenTip { id: string; where: string; values: InfoTipValues }

/** Все «i» экрана после расчёта — для теста полноты значений. */
export function optScreenTips(r: OptResultExt): ScreenTip[] {
  const groups: Array<[string, Partial<Record<string, InfoTipValues>>]> = [
    ['герой', metricValues(r.robust.metrics, r.samples, r.alpha)],
    ['для сравнения', metricValues(r.expected.metrics, r.samples, r.alpha)],
    ['состав', compositionValues(r.robust, r.max_share)],
    ['загрузка', loadValues(r.robust)],
    ['цена робастности', porValues(r)],
    ['Парето', paretoValues(r)],
    ['вне выборки', oosValues(r)],
    ['LP', exactValues(r)],
  ]
  return groups.flatMap(([where, map]) => Object.entries(map).flatMap(([id, values]) => (values ? [{ id, where, values }] : [])))
}
