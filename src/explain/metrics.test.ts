import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { optScreenTips } from '../features/optimization/optTips'
import type { OptResultExt } from '../features/optimization/optTypes'
import { isDiagramId, isMethodologyAnchor } from './anchors'
import { bindFormula, bindFormulaParts, placeholders } from './format'
import { METRICS, METRIC_LIST, getMetric } from './metrics'

/** Числа из инвентаря docs/research/A1-design-audit.md §5, которые обязаны иметь «i». */
const REQUIRED_IDS = [
  'plan.makespan', 'plan.makespan_cvar', 'plan.tardiness', 'plan.otd', 'plan.utilization', 'plan.availability',
  'plan.setup_share', 'plan.throughput', 'plan.wip', 'plan.wait_share', 'plan.flow_time', 'plan.cost',
  'plan.labor_cost', 'plan.maintenance', 'plan.bottleneck', 'plan.rule_score', 'plan.queue_peak', 'plan.mrp',
  'opt.expected', 'opt.cvar', 'opt.var', 'opt.sigma', 'opt.p_loss', 'opt.worst', 'opt.max_regret', 'opt.hhi',
  'opt.effective_n', 'opt.max_share', 'opt.risk_contribution', 'opt.resource_load', 'opt.price_of_robustness',
  'opt.pareto', 'opt.oos_gap', 'opt.exact_gap',
  'forecast.fan', 'forecast.trend', 'forecast.aic', 'forecast.backtest', 'forecast.factors',
  'invest.capex', 'invest.delta_cf', 'invest.npv', 'invest.irr', 'invest.dpp', 'invest.roi', 'invest.next_bottleneck',
  'analytics.bottleneck_rank', 'analytics.labor_constraint', 'analytics.recommendations', 'analytics.sankey',
  'sim.required_operators', 'sim.avg_utilization', 'sim.orders_per_day', 'sim.calibration',
  // Волна G2: касса (METHODOLOGY-V2 §6.0), CRPS прогноза, веса цели плана.
  'cash.cfar', 'cash.p_breach', 'cash.dscr_min_p05', 'cash.pol', 'forecast.crps', 'plan.objective_weights',
  // Волна G4: агенты (UX-V2 §4.7, METHODOLOGY-V2 §7.5).
  'agent.move_gain', 'agent.win_share', 'agent.price_of_anarchy', 'agent.stackelberg_rate',
]

const NAMESPACES = ['plan', 'opt', 'forecast', 'invest', 'analytics', 'sim', 'cash', 'agent']
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

/* ── «Портфель»: каждое «i» экрана получает все ключи своей формулы (X2 P-82) ── */

const metrics = { expected: 45.7e6, std: 60e6, worst_case: -120e6, var: -47e6, cvar: -53.7e6, p_loss: 0.35, downside: 0, best: 300e6, max_regret: 80e6 }
const portfolio = (concentration: number) => ({
  items: [
    { product_id: 'p1', qty: 120, unit_price: 1, unit_cost: 1, unit_margin: 1, contribution: 30e6, risk_contribution: 0.6 },
    { product_id: 'p2', qty: 80, unit_price: 1, unit_cost: 1, unit_margin: 1, contribution: 15.7e6, risk_contribution: 0.4 },
  ],
  resource_load: [{ wc_type_id: 'w1', load_hours: 900, capacity_hours: 5000, utilization: 0.18 }],
  total_load_hours: 900,
  diversification: { n_products: 2, hhi: 0.38, effective_n: 2.6, concentration },
  metrics,
})
const OPT_FIXTURE = {
  scenario_id: 's1', scenario_name: 'Базовый', objective: 'cvar', samples: 3000, alpha: 0.1, lambda: 0.5, seed: 1, horizon_hours: 9360,
  market_corr: 0.3, max_share: 0.6, sellables: 2, robust: portfolio(0.57), expected: portfolio(0.9), price_of_robustness: 12e6,
  histogram: [], candidates: [{ expected: 1, cvar: 1, worst_case: 1, std: 1, p_loss: 0, max_regret: 0, is_robust: true, is_expected: false, is_pareto: true }],
  warnings: [], run_id: 'a1b2c3d4',
  oos: { expected: 49.7e6, cvar: -52.8e6, worst_case: -130e6, std: 61e6, p_loss: 0.34, gap_expected: -0.088, gap_cvar: -0.016 },
  exact: { status: 'optimal', gap_vs_heuristic: { objective_pct: 2.1, oos_objective_pct: -0.4, expected_pct: 0.3, cvar_pct: 2.1 } },
} as unknown as OptResultExt

describe('«Портфель»: формулы «i» с числами, без «—»', () => {
  const tips = optScreenTips(OPT_FIXTURE)

  it('every tip on the screen gets every placeholder of its formula', () => {
    for (const t of tips) {
      const m = getMetric(t.id)
      expect(m, t.id).toBeDefined()
      const missing = placeholders(m?.formula ?? '').filter((k) => t.values[k] === null || t.values[k] === undefined || t.values[k] === '')
      expect(missing, `${t.where}: ${t.id}`).toEqual([])
      const unknown = bindFormulaParts(m?.formula ?? '', t.values, m?.variables).filter((p) => p.kind === 'value' && !p.known)
      expect(unknown, `${t.where}: ${t.id}`).toEqual([])
    }
  })

  it('every «i» id used in src/features/optimization has its live values', () => {
    const dir = fileURLToPath(new URL('../features/optimization/', import.meta.url))
    const used = new Set<string>()
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/['"](opt\.[a-z_]+)['"]/g)) used.add(m[1])
    }
    const covered = new Set(tips.map((t) => t.id))
    expect(used.size).toBeGreaterThan(5)
    expect([...used].filter((id) => !covered.has(id))).toEqual([])
  })
})
