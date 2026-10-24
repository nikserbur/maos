import { describe, expect, it } from 'vitest'
import type { CashLpResult, ForecastResult, PriceScenario, ScheduleResult } from '../../lib/api'
import type { OptResultExt } from '../optimization/optTypes'
import { EMPTY_COUNTS, emptyInput, type DeriveInput } from './deriveInput'
import { forecastLive } from './deriveLoops'
import { deriveState, liveOf, worstSubblock } from './deriveState'
import { lpStatusLive } from './lpStatus'
import { NODES, subblocksOf } from './registry'
import { worstState } from './stateMeta'
import { BLOCK_IDS } from './types'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const NB = '\u00A0'

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
    // Волна A: агент реализован (среда, стенд, правило «RL»), статус политики ещё не получен → default.
    expect(s.nodes.agents.state).toBe('default')
    expect(s.nodes['ag.games'].state).toBe('planned')
    expect(s.nodes.internal.reason).toContain('Справочников')
  })

  it('marks parameters by provenance: default, manual, deprecated UI sliders and fin_params [К]', () => {
    const s = deriveState({ ...filled(), scenario: scenario({ inflation: '0.085', energy: '1.4', months: '13' }) })
    expect(s.params['scenario.months']).toMatchObject({ value: 13, provenance: 'manual', owner: 'scenario' })
    expect(s.params['scenario.fx']).toMatchObject({ value: 1, provenance: 'default' })
    expect(s.params['scenario.inflation']).toMatchObject({ value: 8.5, provenance: 'manual', outOfRange: true })
    // Волна M: ползунки приняты API, но не участвуют в расчёте — «ui» + deprecated при любом значении.
    expect(s.params['scenario.key_rate']).toMatchObject({ value: 16, provenance: 'ui', deprecated: true })
    expect(s.params['scenario.energy']).toMatchObject({ value: 1.4, provenance: 'ui', deprecated: true })
    // Слой F реализован: без fin_params — умолчание кода, с ними — калибровка [К].
    expect(s.params['fin.dso']).toMatchObject({ provenance: 'calibrated', stage: undefined })
    expect(s.nodes['ext.macro'].state).toBe('manual')
    expect(s.nodes['ext.macro'].reason).toContain('Инфляция')
    expect(s.nodes['ext.macro.inflation'].reason).toBe('вне разумного диапазона')
    expect(s.nodes['ext.macro.energy']).toMatchObject({ state: 'default', badge: 'не используется' })
    expect(s.nodes['int.finance.dso'].state).toBe('calibrated')
    expect(s.nodes['int.finance'].badge).toBe('финансовые параметры не загружены')
  })

  it('reads provenance from the server passport and flags synthetic datasets', () => {
    const passport = {
      'fin.c0': { code: 'fin.c0', block: 'деньги', name: 'C₀', value: '0', unit: '₽', status: 'К' as const, source: 'данных предприятия нет', file_ref: '', note: '', updated_at: '2026-10-22 17:13:33' },
      'r1.19': { code: 'r1.19', block: 'риск', name: 'α', value: '0.10', unit: '—', status: 'К' as const, source: '', file_ref: '', note: '', updated_at: '2026-10-22 17:13:33' },
      'macro.generator': { code: 'macro.generator', block: 'макро', name: 'VAR', value: '2 режима', unit: '—', status: 'О' as const, source: 'cbr.ru', file_ref: '', note: '', updated_at: '2026-10-22 17:55:11' },
      'r1.59': { code: 'r1.59', block: 'данные', name: 'Синтетическая история цен', value: '', unit: '—', status: 'синтетика' as const, source: '', file_ref: '', note: 'synthetic=1', updated_at: '' },
    }
    const fin = { entity: 'default', period_type: 'week', effective_from: '2026-01-01', updated_at: '2026-10-22 17:13:33',
      c0: 0, c_min: 0, credit_limit: 20_000_000, d0: 0, key_rate: 0.16, spread: 0.03, overdraft_spread: 0.1, overdraft_limit: 0,
      tau_v: 0.22, tau_p: 0.25, tau_soc: 0.3, property_tax_weekly: 0, payroll_fixed_weekly: 0, repair_budget_weekly: 0, other_fixed_weekly: 0,
      dso_kernel: [0, 0.5, 0.5], pd: 0.02, lgd: 0.45, prepay_share: 0, dpo_weeks: 2, lead_weeks: 1, vat_period_weeks: 13, vat_instalments: 3,
      vat_instalment_lag_weeks: 4, tax_period_weeks: 4, payroll_weeks: [2, 0], dscr_covenant: 1.2, rate_owner: 0.18, rate_bank: 0.16,
      beta: 0.05, l_min: 0, horizon_weeks: 0, cash_samples: 300, auto_repay: 0 }
    const s = deriveState({ ...filled(), passport, fin })
    expect(s.params['fin.cash0']).toMatchObject({ value: 0, provenance: 'calibrated', status: 'К', sourceText: 'данных предприятия нет' })
    expect(s.params['fin.credit_rate']).toMatchObject({ value: 19, provenance: 'normative' })
    expect(s.params['fin.dso'].value).toBe('0 / 0,5 / 0,5')
    expect(s.params['scenario.alpha']).toMatchObject({ provenance: 'calibrated', status: 'К' }) // [К] никогда не «оценено»
    expect(s.nodes['int.finance']).toMatchObject({ state: 'calibrated' })
    expect(s.nodes['int.finance'].badge).toContain('лимит')
    // синтетика — ▲ (данные не факт), статус паспорта — в поле status, а не бейджем «паспорт …»
    expect(s.nodes['ext.prices.ds']).toMatchObject({ state: 'stale', badge: 'синтетика', status: 'синтетика' })
    expect(s.nodes['ext.generator.ds']).toMatchObject({ status: 'О' })
    expect(s.nodes['ext.generator.ds'].badge).toBeUndefined()
    expect(Object.values(s.nodes).some((n) => n.badge?.startsWith('паспорт'))).toBe(false)
    expect(s.nodes['ext.generator'].badge).toBe('сводка генератора не загружена')
  })

  it('reports NSI-backed blocks as manual with counts and decisions as not computed', () => {
    const s = deriveState(filled())
    expect(s.nodes['int.capacity']).toMatchObject({ state: 'manual', badge: `6${NB}станков · 3${NB}типа РЦ` })
    expect(s.nodes['dist.durations'].badge).toBe(`12${NB}операций`)
    expect(s.nodes['int.mrp'].state).toBe('default') // MRP считается только при построении плана
    expect(s.nodes.internal.state).toBe('default') // худшее из детей: default < manual
    expect(s.nodes['dist.breakdowns']).toMatchObject({ state: 'manual', badge: 'MTBF задан: 1 из 3' })
    expect(s.nodes['dist.prices'].state).toBe('default')
    expect(s.nodes['dec.portfolio']).toMatchObject({ state: 'default', badge: 'портфель не рассчитан' })
    expect(s.nodes.decisions.state).toBe('default')
    expect(s.nodes['crit.profit'].badge).toContain(`α 10${NB}%`)
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
    expect(s.nodes.criteria.state).toBe('default') // crit.cash — касса не рассчитана (слой F реализован, но не запущен)
    expect(s.nodes['crit.cash']).toMatchObject({ state: 'default', badge: 'касса не рассчитана' })
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
    expect(s.nodes.monitoring.detail).toContain('Мониторинг') // прогноз не запрошен — куда идти
    expect(s.nodes.external.badge).toBe('Базовый') // контекст блока — первый реализованный подблок
    expect(s.nodes.internal.detail).toMatch(/^MRP: материалы и запуск: /) // вторая строка — какой подблок тянет блок вниз
  })

  it('liveOf falls back honestly for unknown and planned nodes', () => {
    expect(liveOf(null, 'ag.games').state).toBe('planned')
    expect(liveOf(null, 'ext.macro').state).toBe('unconfigured')
    expect(liveOf(null, 'nope').state).toBe('unconfigured')
  })

  it('derives the RL node honestly from /api/rl/status and the last plan moves', () => {
    const off = { available: false, onnxruntime: true, dir: '', error: 'нет файла', note: '',
      l0: { ok: false, path: '', sha256: '', obs_size: 0, act_size: 0, meta: {} }, l2: { ok: false, path: '', sha256: '', obs_size: 0, act_size: 0, meta: {} } }
    const gated = deriveState({ ...emptyInput(NOW), rl: off })
    expect(gated.nodes['ag.rl']).toMatchObject({ state: 'default', badge: 'гейт не пройден · чемпион — правило' })
    expect(gated.params['agent.policy_version'].value).toBe('не опубликована')
    const on = { ...off, available: true, l0: { ...off.l0, ok: true, sha256: 'abcdef0123456789' } }
    const live = deriveState({ ...emptyInput(NOW), rl: on })
    expect(live.nodes['ag.rl'].state).toBe('estimated')
    expect(live.nodes['ag.rl'].badge).toBe('политика опубликована') // хэш — только в паспорте версии
    expect(live.params['agent.policy_version'].value).toBe('abcdef0123')
    expect(gated.nodes['ag.rl'].detail).toBe('политика не опубликована: не прошла гейт V5 → Агенты')
  })

  it('shows an LP time limit as one ▲ on [4] and a neutral «ждёт» on [5]; raw solver text only in raw', () => {
    const cash = { status: 'time_limit', reason: 'Time limit reached', solve_ms: 30_200 } as unknown as CashLpResult
    const s = deriveState({ ...filled(), cash: { result: cash, ranAt: NOW, running: false } })
    expect(s.nodes['dec.cash']).toMatchObject({ state: 'stale', badge: `касса: не решено за 30${NB}с`, raw: 'Time limit reached' })
    expect(s.nodes['dec.cash'].reason).toContain('повторите с большим лимитом')
    expect(s.nodes['crit.cash']).toMatchObject({ state: 'unconfigured', badge: 'ждёт решения кассы [4]' })
    expect(s.nodes.decisions.state).toBe('stale')
    expect(s.nodes.decisions.detail).toBe(`Транши кредитной линии (CVaR-LP с кассой): касса: не решено за 30${NB}с`)
    expect(worstSubblock(s, 'decisions')?.id).toBe('dec.cash')
    // английский текст решателя — только в raw («Подробнее»), не в бейдже, причине или детали
    const visible = Object.values(s.nodes).flatMap((n) => [n.badge, n.detail, n.reason]).join(' ')
    expect(visible).not.toContain('Time limit')
    expect(lpStatusLive('infeasible')).toMatchObject({ state: 'error', reason: 'ограничение ликвидности неразрешимо — снизьте L_min' })
    expect(lpStatusLive('unbounded').reason).toContain('расчёт кассы не выполнен')
  })

  it('reads the published forecast into block [7] with coverage and the share worse than naive', () => {
    const bt = (coverage80: number, skill: number) => ({ k: 6, mape: 0.1, mape_naive: 0.12, skill, pinball10: 0, pinball90: 0, coverage80 })
    const prod = (backtest?: ReturnType<typeof bt>) => ({ id: 'p', name: 'Вал', role: 'product', base: 1, p10: [1], p50: [1], p90: [1], mean: [1], ...(backtest ? { backtest } : {}) })
    const f = { months: 12, inflation_index: [1, 1.01], products: [prod(bt(0.6, 0.1)), prod(bt(0.74, -0.2)), prod(bt(0.67, 0.3)), prod()] } as unknown as ForecastResult
    expect(forecastLive(f)).toMatchObject({ state: 'estimated', badge: 'надёжен 1 · осторожно 2 · ненадёжен 0 · не проверен 1 из 4' })
    expect(forecastLive(f).detail).toContain(`покрытие 67${NB}%`)
    expect(forecastLive(null).badge).toBe('прогноз не запрошен')
    const s = deriveState({ ...filled(), forecast: f })
    expect(s.nodes['mon.forecast'].badge).not.toBe('прогноз не запрошен')
  })

  it('reflects v0.74: MENTAT live state, ДИ done, auto_repay under the cash decision, no raw objective ids', () => {
    const off = deriveState({ ...filled(), mentat: { configured: false, model: '' } })
    expect(off.nodes['llm.mentat']).toMatchObject({ state: 'unconfigured', badge: 'модель не подключена' })
    const on = deriveState({ ...filled(), mentat: { configured: true, model: 'qwen2.5' } })
    expect(on.nodes['llm.mentat']).toMatchObject({ state: 'estimated', badge: 'модель qwen2.5 · локально' })
    expect(on.nodes.llm.detail ?? '').not.toContain('в плане')
    expect(on.nodes['crit.ci'].state).not.toBe('planned')
    expect(on.params['fin.auto_repay']).toMatchObject({ provenance: 'normative' })
    expect(on.nodes['dec.cash.auto_repay']).toBeDefined()
    const input = filled()
    input.opt = { ...input.opt, result: optResult({ objective: 'meanvariance' }), ranAt: NOW }
    const ran = deriveState(input)
    const text = Object.values(ran.nodes).flatMap((n) => [n.badge, n.detail]).join(' ')
    expect(text).not.toContain('meanvariance')
    expect(text).not.toContain('P(спокойный)')
    expect(ran.nodes['crit.profit'].badge).toBe(`CVaR₁₀${NB}% −120${NB}тыс.${NB}₽ · E +1${NB}млн${NB}₽`)
  })
})
