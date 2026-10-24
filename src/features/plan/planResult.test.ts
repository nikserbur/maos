import { describe, expect, it } from 'vitest'
import type { CashLpResult, KpiBundle, ScheduleResult, SchedRule, SimPlanSummary } from '../../lib/api'
import { cashEtaSeconds, cashFailDetail, cashFailTitle, cashOutcome } from './cashOutcome'
import { mergeRuns } from './runIndex'
import { readRunMeta, snapshotOf, writeRunMeta, type RunMeta } from './runMeta'
import type { StorageLike } from './planStore'
import { cvarName, planVerdict, verdictText } from './verdict'
import { objectiveSentence } from './wizard/objectiveText'
import { selectionFromParams } from './usePlanSelection'
import { fmtScore, tiedWithChosen } from './ResultTables'
import { dayTickIndices } from './QueueChart'
import { RESULT_SECTIONS, runHref, sectionBySlug } from './planNav'

const schedule = (p: Partial<ScheduleResult> = {}): ScheduleResult => ({
  rule: 'CR', samples: 500, alpha: 0.1, weights: { time: 1, cost: 0, risk: 0.5 },
  n_orders: 6, n_jobs: 40, n_machines: 10, n_workers: 8, program: [], gantt: [], machine_load: [], wc_load: [], worker_plan: [],
  bottleneck: { wc_type_id: 'w1', wc_name: 'Резьбонарезной', utilization: 0.63 },
  idle: { machine_idle_hours: 0, machine_utilization: 0.5 }, calendar: { enabled: true, work_fond_hours: 100 },
  kpi: { makespan: 397, makespan_mean: 418.6, makespan_cvar: 507, makespan_worst: 684, tardiness: 0, tardiness_cvar: 0, n_late: 0, otd: 1, utilization: 0.5, cost: 1 },
  rules: [], warnings: [], portfolio_horizon_hours: 720, ...p,
})

describe('plan verdict — one line, named tail, abnormal only marked', () => {
  it('states makespan, tail, horizon, orders and bottleneck in plain words', () => {
    const text = verdictText(planVerdict(schedule()))
    expect(text).toContain('План 418,6')
    expect(text).toContain('≈ 17')
    expect(text).toContain('в 10\u00a0% худших сценариев — в среднем 507')
    expect(text).toContain('в горизонте Стадии 2')
    expect(text).toContain('все 6 заказов в срок')
    expect(text).toContain('узкое место — Резьбонарезной (63\u00a0%)')
    expect(planVerdict(schedule()).some((p) => p.warn)).toBe(false)
  })

  it('marks lateness, horizon breach and overload with ▲', () => {
    const r = schedule({ kpi: { ...schedule().kpi, n_late: 2, makespan_cvar: 800 }, bottleneck: { wc_type_id: 'w', wc_name: 'Фрезерный', utilization: 0.91 } })
    const warn = planVerdict(r).filter((p) => p.warn).map((p) => p.key)
    expect(warn).toEqual(['tail', 'otd', 'bn'])
  })

  it('names the CVaR level from α', () => {
    expect(cvarName(0.1)).toBe('CVaR₉₀')
    expect(cvarName(0.05)).toBe('CVaR₉₅')
  })
})

describe('cash outcome — one selector for the KPI tile and the section', () => {
  const lp = (status: string): CashLpResult => ({ status, solve_ms: 12000, reason: 'limit', n_scenarios: 500 } as unknown as CashLpResult)
  it('never treats a stopped solver as a result', () => {
    expect(cashOutcome(null, false, null)).toBe('none')
    expect(cashOutcome(null, true, null)).toBe('running')
    expect(cashOutcome(lp('optimal'), false, null)).toBe('ok')
    expect(cashOutcome(lp('time_limit'), false, null)).toBe('failed')
    expect(cashOutcome(lp('optimal'), false, 'сеть')).toBe('failed')
  })
  it('explains the failure in words, raw details only for «Подробнее»', () => {
    expect(cashFailTitle(lp('time_limit'), null)).toBe('Касса не рассчитана: решатель остановился по лимиту времени')
    expect(cashFailTitle(lp('time_limit'), null)).not.toContain('time_limit')
    expect(cashFailDetail(lp('time_limit'), null)).toContain('12')
    expect(cashEtaSeconds(500)).toBeGreaterThan(3)
  })
})

describe('run index — one number per run', () => {
  const plans: SimPlanSummary[] = [
    { id: 'c', created_at: '2026-10-24 14:41:30', n_tasks: '10', makespan: '400' },
    { id: 'a', created_at: '2026-10-24 14:36:17', n_tasks: '9', makespan: '410' },
  ]
  const series: KpiBundle[] = [
    { plan_id: 'a', created_at: '2026-10-24 14:36:17', kpi: { makespan_mean: 410 } },
    { plan_id: 'b', created_at: '2026-10-24 14:38:52', kpi: { makespan_mean: 405 } },
    { plan_id: 'c', created_at: '2026-10-24 14:41:30', kpi: { makespan_mean: 400 } },
  ]
  it('numbers runs by their position in the KPI series, newest first, KPI-only runs included', () => {
    const rows = mergeRuns(plans, series)
    expect(rows.map((r) => [r.id, r.seq])).toEqual([['c', 3], ['b', 2], ['a', 1]])
    expect(rows.find((r) => r.id === 'b')?.nTasks).toBe(0)
  })
})

describe('run passport (repeat any run)', () => {
  class Mem implements StorageLike {
    map = new Map<string, string>()
    getItem(k: string) { return this.map.get(k) ?? null }
    setItem(k: string, v: string) { this.map.set(k, v) }
    removeItem(k: string) { this.map.delete(k) }
  }
  const meta = (key: string): RunMeta => ({
    key, rule: 'CR', adopted: true, source: 'manual', scenarioId: 's', scenarioName: 'Базовый', builtAt: 1,
    params: snapshotOf({ source: 'manual', runId: '', planId: '', scenarioId: 's', manualOrders: [], overrides: { samples: 800 }, preset: 'time', crits: [], startDate: null }),
  })
  it('keeps newest first, replaces duplicates and survives garbage', () => {
    const st = new Mem()
    writeRunMeta(st, meta('a'))
    writeRunMeta(st, meta('b'))
    writeRunMeta(st, meta('a'))
    expect(readRunMeta(st).map((m) => m.key)).toEqual(['a', 'b'])
    st.setItem('maos.plan.runmeta', '{oops')
    expect(readRunMeta(st)).toEqual([])
  })
})

describe('wizard words', () => {
  it('says the objective in one sentence', () => {
    expect(objectiveSentence({ wTime: 1, wRisk: 0.5, wCost: 0 })).toBe('Минимизируем срок; хвост риска штрафуем вдвое слабее')
    expect(objectiveSentence({ wTime: 1, wRisk: 1, wCost: 0.5 })).toContain('наравне со сроком; переналадки — с весом 0,5')
  })
})

describe('linked selection and result address', () => {
  it('reads the selection from the address', () => {
    expect(selectionFromParams({ wc: 'w1', o: '3' })).toEqual({ wc: 'w1', machine: null, order: 3 })
    expect(selectionFromParams({ o: 'x' }).order).toBeNull()
  })
  it('builds one address per run and section', () => {
    expect(runHref('abc')).toBe('#/plan/run/abc')
    expect(runHref('abc', 'cash')).toBe('#/plan/run/abc/cash')
    expect(sectionBySlug('bottleneck')?.id).toBe('res-bn')
    expect(RESULT_SECTIONS.filter((s) => s.slug !== 'moves')).toHaveLength(6)
  })
})

describe('rules and queue helpers', () => {
  const rule = (r: string, score: number, chosen = false): SchedRule => ({ rule: r, makespan: 1, makespan_cvar: 1, makespan_worst: 1, tardiness: 0, score, chosen })
  it('formats F compactly and finds rules with the same order', () => {
    expect(fmtScore(27_800)).toBe('27,8\u00a0тыс.')
    expect(fmtScore(12.34)).toBe('12,3')
    expect(tiedWithChosen([rule('CR', 10, true), rule('MWKR', 10), rule('EDD', 12)])).toEqual(['CR', 'MWKR'])
  })
  it('puts queue ticks on day boundaries', () => {
    const ts = Array.from({ length: 100 }, (_, i) => i * 2)
    const idx = dayTickIndices(ts)
    expect(idx.length).toBeGreaterThan(2)
    expect(idx.length).toBeLessThanOrEqual(9)
    expect(idx.every((i) => ts[i] % 24 === 0)).toBe(true)
  })
})
