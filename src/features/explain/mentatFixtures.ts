/**
 * Фикстуры тестов MENTAT (только для *.test.ts): детерминированное состояние карты с прогоном портфеля,
 * планом и статусом RL — той же формы, что ответы API. Значения условные.
 */
import type { PriceScenario, RlStatus, ScheduleResult } from '../../lib/api'
import { EMPTY_COUNTS, emptyInput, type DeriveInput } from '../method-map/deriveInput'
import { deriveState } from '../method-map/deriveState'
import type { MethodMapState } from '../method-map/types'
import type { OptResultExt } from '../optimization/optTypes'

export const NOW = Date.UTC(2026, 9, 24, 12, 0, 0)

const scenario: PriceScenario = {
  id: 'scn-1', name: 'Базовый', description: '', horizon_hours: '8640', created_at: '2026-10-01',
  key_rate: '16', fx: '1', inflation: '0.005', demand: '1', volatility: '0.05', market_corr: '0.5', months: '12',
  alpha: '0.1', objective: 'cvar', max_share: '0.35',
} as PriceScenario

const metrics = { expected: 41_200_000, std: 9_800_000, worst_case: -71_500_000, var: -38_100_000, cvar: -53_312_000, p_loss: 0.27, downside: 0, best: 90_000_000, max_regret: 12_000_000 }
const items = [
  { product_id: 'p1', qty: 120, unit_price: 10, unit_cost: 5, unit_margin: 5, contribution: 18_000_000, risk_contribution: 0.58 },
  { product_id: 'p2', qty: 80, unit_price: 10, unit_cost: 5, unit_margin: 5, contribution: 15_000_000, risk_contribution: 0.27 },
  { product_id: 'p3', qty: 40, unit_price: 10, unit_cost: 5, unit_margin: 5, contribution: 8_200_000, risk_contribution: 0.15 },
]
const portfolio = {
  items,
  resource_load: [{ wc_type_id: 'wc1', load_hours: 1263, capacity_hours: 1400, utilization: 0.902 }],
  total_load_hours: 1263, diversification: { n_products: 3, hhi: 0.42, effective_n: 2.38, concentration: 0.42 }, metrics,
}

export function optFixture(patch: Partial<OptResultExt> = {}): OptResultExt {
  return {
    scenario_id: 'scn-1', scenario_name: 'Базовый', objective: 'cvar', samples: 3000, alpha: 0.1, lambda: 0, seed: 1,
    horizon_hours: 8640, market_corr: 0.5, max_share: 0.35, sellables: 3, robust: portfolio, expected: portfolio,
    price_of_robustness: 2_100_000, histogram: [], candidates: [{ ...metrics, is_robust: true, is_expected: false, is_pareto: true }],
    warnings: [], run_id: 'run-aaaa1111',
    exact: { status: 'optimal', duals: [{ wc_type: 'Токарный', shadow_price: 1850, utilization: 0.902, binding: true }, { wc_type: 'Фрезерный', shadow_price: 0, utilization: 0.61, binding: false }] },
    ...patch,
  }
}

export function planFixture(): ScheduleResult {
  return {
    rule: 'EDD', samples: 500, alpha: 0.1, weights: { time: 1, cost: 0, risk: 0.5 },
    n_orders: 3, n_jobs: 12, n_machines: 6, n_workers: 4,
    program: [{ product_id: 'p1', product_name: 'Вал', qty: 10, due_hours: 720 }],
    gantt: [], machine_load: [], wc_load: [], worker_plan: [],
    bottleneck: { wc_type_id: 'wc1', wc_name: 'Токарный', utilization: 0.91 },
    idle: { machine_idle_hours: 10, machine_utilization: 0.7 }, calendar: { enabled: true, work_fond_hours: 1760 },
    kpi: { makespan: 980, makespan_mean: 1263, makespan_cvar: 1400, makespan_worst: 1600, tardiness: 12, tardiness_cvar: 40, n_late: 1, otd: 0.93, utilization: 0.7, cost: 120_000 },
    rules: [{ rule: 'EDD', makespan: 980, makespan_cvar: 1400, makespan_worst: 1600, tardiness: 12, score: 1.2, chosen: true }],
    warnings: [],
  } as ScheduleResult
}

export function rlFixture(): RlStatus {
  const info = { ok: true, path: '', sha256: '', obs_size: 0, act_size: 0, meta: {} }
  return {
    available: false, onnxruntime: true, dir: '', error: '', l0: info, l2: info, note: '',
    gate_a3: { gate_pass: false, gate_g1: true, champion: 'non_rl_champion', ci95_vs_best_rule: [1.01, 1.92], ci95_vs_champion_plus: [0, 0.02], units: '% стоимости портфеля, IQM по экземплярам', source: 'rl/results/a3/champion_a3.json' },
  }
}

export function stateFixture(): MethodMapState {
  const input: DeriveInput = {
    ...emptyInput(NOW),
    context: { scenarioId: 'scn-1', portfolioRunId: 'run-aaaa1111' },
    scenario,
    counts: { ...EMPTY_COUNTS, products: 5, sellable: 3, purchased: 2, machines: 6, wcTypes: 3, wcTypesWithMtbf: 1, workers: 4, routings: 3, operations: 12, scenarios: 2 },
  }
  const opt = optFixture()
  return deriveState({ ...input, opt: { ...input.opt, result: opt, ranAt: NOW }, plan: { ...input.plan, result: planFixture(), builtAt: NOW }, rl: rlFixture() })
}
