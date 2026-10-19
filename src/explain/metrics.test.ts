import { describe, expect, it } from 'vitest'
import { isDiagramId, isMethodologyAnchor } from './anchors'
import { bindFormula, placeholders } from './format'
import { METRICS, METRIC_LIST, getMetric } from './metrics'

/** Числа из инвентаря docs/research/A1-design-audit.md §5, которые обязаны иметь «i». */
const REQUIRED_IDS = [
  'plan.makespan', 'plan.makespan_cvar', 'plan.tardiness', 'plan.otd', 'plan.utilization', 'plan.availability',
  'plan.setup_share', 'plan.throughput', 'plan.wip', 'plan.wait_share', 'plan.flow_time', 'plan.cost',
  'plan.labor_cost', 'plan.maintenance', 'plan.bottleneck', 'plan.rule_score', 'plan.queue_peak', 'plan.mrp',
  'opt.expected', 'opt.cvar', 'opt.var', 'opt.sigma', 'opt.p_loss', 'opt.worst', 'opt.max_regret', 'opt.hhi',
  'opt.effective_n', 'opt.max_share', 'opt.risk_contribution', 'opt.resource_load', 'opt.price_of_robustness',
  'opt.pareto', 'opt.oos_gap',
  'forecast.fan', 'forecast.trend', 'forecast.aic', 'forecast.backtest', 'forecast.factors',
  'invest.capex', 'invest.delta_cf', 'invest.npv', 'invest.irr', 'invest.dpp', 'invest.roi', 'invest.next_bottleneck',
  'analytics.bottleneck_rank', 'analytics.labor_constraint', 'analytics.recommendations', 'analytics.sankey',
  'sim.required_operators', 'sim.avg_utilization', 'sim.orders_per_day', 'sim.calibration',
]

const NAMESPACES = ['plan', 'opt', 'forecast', 'invest', 'analytics', 'sim']
const KEY_FORMAT = /^[A-Za-z0-9_]+$/
const ID_FORMAT = /^[a-z]+\.[a-z0-9_]+$/

describe('metric registry integrity', () => {
  it('has unique ids', () => {
    const ids = METRIC_LIST.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(METRICS)).toHaveLength(ids.length)
  })

  it('covers every computed number of the A1 §5 inventory', () => {
    const missing = REQUIRED_IDS.filter((id) => !getMetric(id))
    expect(missing).toEqual([])
  })

  it('uses namespaced ids', () => {
    for (const m of METRIC_LIST) {
      expect(m.id, m.id).toMatch(ID_FORMAT)
      expect(NAMESPACES, m.id).toContain(m.id.split('.')[0])
    }
  })

  it('declares every formula placeholder as a variable', () => {
    for (const m of METRIC_LIST) {
      const declared = new Set(m.variables.map((v) => v.key))
      const undeclared = placeholders(m.formula).filter((k) => !declared.has(k))
      expect(undeclared, m.id).toEqual([])
    }
  })

  it('has unique, well-formed variable keys with labels', () => {
    for (const m of METRIC_LIST) {
      const keys = m.variables.map((v) => v.key)
      expect(new Set(keys).size, m.id).toBe(keys.length)
      for (const v of m.variables) {
        expect(v.key, m.id).toMatch(KEY_FORMAT)
        expect(v.label.trim(), `${m.id}.${v.key}`).not.toBe('')
      }
    }
  })

  it('uses curly braces only for placeholders', () => {
    for (const m of METRIC_LIST) {
      const stripped = m.formula.replace(/\{[A-Za-z0-9_]+\}/g, '')
      expect(stripped, m.id).not.toMatch(/[{}]/)
    }
  })

  it('does not repeat a unit right after a placeholder (values are formatted with their unit)', () => {
    for (const m of METRIC_LIST) {
      expect(m.formula, m.id).not.toMatch(/\}\s?(ч|мин|%|₽|мес)(?![\p{L}])/u)
    }
  })

  it('references only registered diagrams and methodology anchors', () => {
    for (const m of METRIC_LIST) {
      if (m.diagram !== undefined) expect(isDiagramId(m.diagram), `${m.id} → ${m.diagram}`).toBe(true)
      if (m.learnMore !== undefined) expect(isMethodologyAnchor(m.learnMore), `${m.id} → ${m.learnMore}`).toBe(true)
    }
  })

  it('has no empty texts', () => {
    for (const m of METRIC_LIST) {
      expect(m.title.trim(), m.id).not.toBe('')
      expect(m.short.trim(), m.id).not.toBe('')
      expect(m.formula.trim(), m.id).not.toBe('')
      expect(m.method.trim(), m.id).not.toBe('')
      for (const c of m.caveats ?? []) expect(c.trim(), m.id).not.toBe('')
      if (m.caveats) expect(m.caveats.length, m.id).toBeGreaterThan(0)
    }
  })

  it('binds every formula without leftover placeholders, with or without values', () => {
    for (const m of METRIC_LIST) {
      const values = Object.fromEntries(m.variables.map((v) => [v.key, v.unit ? 1 : 'x']))
      expect(bindFormula(m.formula, values, m.variables), m.id).not.toMatch(/[{}]/)
      expect(bindFormula(m.formula, undefined, m.variables), m.id).not.toMatch(/[{}]/)
    }
  })

  it('returns undefined for unknown ids and does not resolve prototype keys', () => {
    expect(getMetric('plan.nope')).toBeUndefined()
    expect(getMetric('constructor')).toBeUndefined()
    expect(getMetric('toString')).toBeUndefined()
  })
})
