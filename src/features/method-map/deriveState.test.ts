import { describe, expect, it } from 'vitest'
import type { PriceScenario, ScheduleResult } from '../../lib/api'
import type { OptResultExt } from '../optimization/optTypes'
import { EMPTY_COUNTS, emptyInput, type DeriveInput } from './deriveInput'
import { deriveState, liveOf } from './deriveState'
import { NODES, subblocksOf } from './registry'
import { worstState } from './stateMeta'
import { BLOCK_IDS } from './types'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

const scenario = (patch: Partial<PriceScenario> = {}): PriceScenario => ({
  id: 'scn-1', name: 'Базовый', description: '', horizon_hours: '8640', created_at: '2026-10-01',
  key_rate: '16', fx: '1', inflation: '0.005', demand: '1', volatility: '0.05', market_corr: '0.5', months: '12',
  alpha: '0.1', objective: 'cvar', max_share: '0.35',
  ...patch,
})

const metrics = { expected: 1_000_000, std: 200_000, worst_case: -300_000, var: 100_000, cvar: -120_000, p_loss: 0.08, downside: 0, best: 2_000_000, max_regret: 400_000 }
const portfolio = {
  items: [{ product_id: 'p1', qty: 10, unit_price: 10, unit_cost: 5, unit_margin: 5, contribution: 50, risk_contribution: 0.5 }],
  resource_load: [{ wc_type_id: 'wc1', load_hours: 80, capacity_hours: 100, utilization: 0.8 }],
  total_load_hours: 80, diversification: { n_products: 1, hhi: 1, effective_n: 1, concentration: 1 }, metrics,
}
const optResult = (patch: Partial<OptResultExt> = {}): OptResultExt => ({
  scenario_id: 'scn-1', scenario_name: 'Базовый', objective: 'cvar', samples: 3000, alpha: 0.1, lambda: 0, seed: 1,
  horizon_hours: 8640, market_corr: 0.5, max_share: 0.35, sellables: 1, robust: portfolio, expected: portfolio,
  price_of_robustness: 50_000, histogram: [], candidates: [{ ...metrics, is_robust: true, is_expected: false, is_pareto: true }],
  warnings: [], run_id: 'run-1', ...patch,
})

const planResult = (patch: Partial<ScheduleResult> = {}): ScheduleResult => ({
  rule: 'EDD', samples: 500, alpha: 0.1, weights: { time: 1, cost: 0, risk: 0.5 },
  n_orders: 3, n_jobs: 12, n_machines: 6, n_workers: 4,
  program: [{ product_id: 'p1', product_name: 'Вал', qty: 10, due_hours: 720 }],
  gantt: [], machine_load: [], wc_load: [], worker_plan: [],
  bottleneck: { wc_type_id: 'wc1', wc_name: 'Токарный', utilization: 0.91 },
  idle: { machine_idle_hours: 10, machine_utilization: 0.7 }, calendar: { enabled: true, work_fond_hours: 1760 },
  kpi: { makespan: 980, makespan_mean: 1123, makespan_cvar: 1400, makespan_worst: 1600, tardiness: 12, tardiness_cvar: 40, n_late: 1, otd: 0.93, utilization: 0.7, cost: 120_000 },
  rules: [{ rule: 'EDD', makespan: 980, makespan_cvar: 1400, makespan_worst: 1600, tardiness: 12, score: 1.2, chosen: true }],
  warnings: [], ...patch,
})

const filled = (): DeriveInput => ({
  ...emptyInput(NOW),
  context: { scenarioId: 'scn-1' },
  scenario: scenario(),
  counts: { ...EMPTY_COUNTS, products: 5, sellable: 3, purchased: 2, machines: 6, wcTypes: 3, wcTypesWithMtbf: 1, workers: 4, routings: 3, operations: 12, scenarios: 2 },
})

describe('deriveState', () => {
  it('covers every registry node and every block from an empty project', () => {
    const s = deriveState(emptyInput(NOW))
    expect(s.source).toBe('derived')
    expect(s.computedAt).toBe(new Date(NOW).toISOString())
    for (const n of NODES) expect(s.nodes[n.id], n.id).toBeDefined()
    for (const b of ['external', 'distributions', 'internal']) expect(s.nodes[b].state, b).toBe('unconfigured')
    expect(s.nodes.agents.state).toBe('planned')
    expect(s.nodes.internal.reason).toContain('Справочников')
  })

  it('marks parameters by provenance: default, manual and normative «для заметности»', () => {
    const s = deriveState({ ...filled(), scenario: scenario({ inflation: '0.085', energy: '1.4' }) })
    expect(s.params['scenario.key_rate']).toMatchObject({ value: 16, provenance: 'manual', owner: 'scenario' })
    expect(s.params['scenario.fx']).toMatchObject({ value: 1, provenance: 'default' })
    expect(s.params['scenario.inflation']).toMatchObject({ value: 8.5, provenance: 'manual', outOfRange: true })
    expect(s.params['scenario.energy'].provenance).toBe('normative')
    expect(s.params['fin.dso']).toMatchObject({ value: null, stage: 'w1' })
    expect(s.nodes['ext.macro'].state).toBe('manual')
    expect(s.nodes['ext.macro'].reason).toContain('Инфляция')
    expect(s.nodes['ext.macro.inflation'].reason).toBe('вне разумного диапазона')
    expect(s.nodes['ext.macro.energy'].state).toBe('normative')
    expect(s.nodes['int.finance.dso'].state).toBe('planned')
  })

  it('reports NSI-backed blocks as manual with counts and decisions as not computed', () => {
    const s = deriveState(filled())
    expect(s.nodes['int.capacity']).toMatchObject({ state: 'manual', badge: '6 станков · 3 типов РЦ' })
    expect(s.nodes['int.mrp'].state).toBe('default') // MRP считается только при построении плана
    expect(s.nodes.internal.state).toBe('default') // худшее из детей: default < manual
    expect(s.nodes['dist.breakdowns']).toMatchObject({ state: 'manual', badge: 'MTBF задан: 1 из 3' })
    expect(s.nodes['dist.prices'].state).toBe('default')
    expect(s.nodes['dec.portfolio']).toMatchObject({ state: 'default', badge: 'портфель не рассчитан' })
    expect(s.nodes.decisions.state).toBe('default')
    expect(s.nodes['crit.profit'].badge).toContain('α = 0,1')
    expect(s.values['crit.profit.f.cvar']).toBeUndefined()
    expect(s.nodes['crit.profit.f.cvar'].state).toBe('default')
  })

  it('turns a computed portfolio and plan into estimated nodes with live formula values', () => {
    const input = filled()
    input.opt = { ...input.opt, result: optResult({ oos: { expected: 990_000, cvar: -130_000, worst_case: -310_000, std: 1, p_loss: 0.08, gap_expected: 0.01, gap_cvar: 0.08 } }), ranAt: NOW - 60_000 }
    input.plan = { ...input.plan, result: planResult(), builtAt: NOW - 30_000, params: { ...input.plan.params, runId: 'run-1' } }
    const s = deriveState(input)
    expect(s.nodes['dec.portfolio']).toMatchObject({ state: 'estimated', updatedAt: new Date(NOW - 60_000).toISOString() })
    expect(s.nodes['dec.schedule'].state).toBe('estimated')
    expect(s.nodes['dec.schedule'].badge).toContain('EDD')
    expect(s.nodes.decisions.state).toBe('default') // dec.invest/dec.lots остаются по умолчанию — худшее из детей
    expect(s.nodes.criteria.state).toBe('estimated')
    expect(s.nodes['crit.ci'].state).toBe('estimated')
    expect(s.values['crit.profit.f.cvar']).toEqual({ cvar: -120_000, alpha: 0.1, n: 3000 })
    expect(s.values['dec.schedule.f.rule_score']).toMatchObject({ rule: 'EDD', score: 1.2, w_r: 0.5 })
    expect(s.values['crit.schedule.f.otd']).toEqual({ otd: 0.93, n: 3, n_late: 1 })
    expect(s.nodes['crit.profit.f.cvar']).toMatchObject({ state: 'estimated' })
    expect(s.nodes['int.labor'].detail).toContain('операторов меньше станков')
  })

  it('flags stale decisions when the scenario or the portfolio changed after the run', () => {
    const input = filled()
    input.context = { scenarioId: 'scn-2' }
    input.opt = { ...input.opt, result: optResult(), ranAt: NOW }
    const other = deriveState(input)
    expect(other.nodes['dec.portfolio']).toMatchObject({ state: 'stale', reason: 'портфель считался под другой сценарий' })

    const input2 = filled()
    input2.opt = { ...input2.opt, result: optResult(), ranAt: NOW }
    input2.plan = { ...input2.plan, result: planResult(), builtAt: NOW - 10_000, params: { ...input2.plan.params, runId: 'run-1' } }
    const late = deriveState(input2)
    expect(late.nodes['dec.schedule'].state).toBe('stale')
    expect(late.nodes.decisions.state).toBe('stale')
  })

  it('turns a soft backend error into an error node that dominates the block', () => {
    const input = filled()
    input.opt = { ...input.opt, result: optResult({ error_soft: true, warnings: ['нет товарных изделий'] }), ranAt: NOW }
    const s = deriveState(input)
    expect(s.nodes['dec.portfolio']).toMatchObject({ state: 'error', reason: 'нет товарных изделий' })
    expect(s.nodes.decisions.state).toBe('error')
    expect(s.nodes['dec.portfolio.f.expected'].state).toBe('error')
  })

  it('aggregates blocks as the worst child while planned children never worsen a block', () => {
    expect(worstState(['estimated', 'planned', 'manual'])).toBe('manual')
    expect(worstState(['planned', 'planned'])).toBe('planned')
    expect(worstState(['default', 'stale', 'error'])).toBe('error')
    expect(worstState([])).toBe('unconfigured')
    const s = deriveState(filled())
    for (const b of BLOCK_IDS) {
      const kids = subblocksOf(b).map((k) => s.nodes[k.id].state)
      expect(s.nodes[b].state, b).toBe(worstState(kids))
    }
    expect(s.nodes.monitoring.detail).toContain('в плане')
    expect(s.nodes.external.badge).toBe('Базовый') // контекст блока — первый реализованный подблок
    expect(s.nodes.internal.detail).toContain('по умолчанию:') // вторая строка — что тянет блок вниз
  })

  it('liveOf falls back honestly for unknown and planned nodes', () => {
    expect(liveOf(null, 'ag.rl').state).toBe('planned')
    expect(liveOf(null, 'ext.macro').state).toBe('unconfigured')
    expect(liveOf(null, 'nope').state).toBe('unconfigured')
  })
})
