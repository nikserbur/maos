import { beforeEach, describe, expect, it } from 'vitest'
import type { ScheduleResult } from '../../lib/api'
import { INITIAL_PARAMS, PLAN_CACHE_KEY, cachedPlanIds, getPlanState, planActions, readPlanCache, subscribePlan, writePlanCache } from './planStore'

const fakeResult = { rule: 'EDD' } as unknown as ScheduleResult

describe('planStore', () => {
  beforeEach(() => planActions.reset())

  it('starts empty with default params', () => {
    const s = getPlanState()
    expect(s.result).toBeNull()
    expect(s.params).toEqual(INITIAL_PARAMS)
    expect(s.pins.size).toBe(0)
  })

  it('keeps the result after a successful run (survives screen switches)', () => {
    const token = planActions.beginRun()
    expect(getPlanState().running).toBe(true)
    planActions.finishRun(token, fakeResult)
    expect(getPlanState().result).toBe(fakeResult)
    expect(getPlanState().running).toBe(false)
    expect(getPlanState().builtAt).not.toBeNull()
  })

  it('ignores stale run responses', () => {
    const first = planActions.beginRun()
    const second = planActions.beginRun()
    planActions.finishRun(first, fakeResult)
    expect(getPlanState().result).toBeNull()
    planActions.failRun(second, 'сбой')
    expect(getPlanState().error).toBe('сбой')
    expect(getPlanState().running).toBe(false)
  })

  it('keeps the previous result on failure', () => {
    planActions.finishRun(planActions.beginRun(), fakeResult)
    planActions.failRun(planActions.beginRun(), 'нет связи')
    expect(getPlanState().result).toBe(fakeResult)
    expect(getPlanState().error).toBe('нет связи')
  })

  it('clears pins when the program source or active plan changes', () => {
    planActions.addPin(3, 12)
    expect(getPlanState().pins.get(3)).toBe(12)
    planActions.setParam('samples', '800')
    expect(getPlanState().pins.size).toBe(1)
    planActions.setParam('runId', 'run-1')
    expect(getPlanState().pins.size).toBe(0)
    planActions.addPin(1, 5)
    planActions.setActivePlan('plan-2')
    expect(getPlanState().pins.size).toBe(0)
  })

  it('creates a new state object on change and notifies subscribers', () => {
    let calls = 0
    const off = subscribePlan(() => { calls += 1 })
    const before = getPlanState()
    planActions.setParam('rule', 'SPT')
    planActions.setParam('rule', 'SPT')
    off()
    planActions.setParam('rule', 'LPT')
    expect(calls).toBe(1)
    expect(getPlanState()).not.toBe(before)
    expect(before.params.rule).toBe('auto')
  })

  it('clamps pins to non-negative hours', () => {
    planActions.addPin(1, -4)
    expect(getPlanState().pins.get(1)).toBe(0)
  })
})

/* ── G3: кэш результатов и восстановление после F5 ─────────────────────── */

class FakeStorage {
  private map = new Map<string, string>()
  quota = Number.POSITIVE_INFINITY
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { if (v.length > this.quota) throw new Error('QuotaExceededError'); this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
}

const resultOf = (planId: string) => ({ plan_id: planId, rule: 'EDD', gantt: [], kpi: { makespan: 1 } }) as unknown as ScheduleResult

describe('planStore cache (survives reload)', () => {
  beforeEach(() => planActions.reset())

  it('writes finished runs to the cache, newest first, capped at PLAN_CACHE_MAX', () => {
    const storage = new FakeStorage()
    for (const id of ['a', 'b', 'c', 'd']) planActions.finishRun(planActions.beginRun(), resultOf(id), { storage, startDate: '2026-11-01' })
    const cache = readPlanCache(storage)
    expect(cache.map((c) => c.planId)).toEqual(['d', 'c', 'b'])
    expect(cache[0].startDate).toBe('2026-11-01')
  })

  it('hydrates the last cached run only when memory is empty', () => {
    const storage = new FakeStorage()
    planActions.finishRun(planActions.beginRun(), resultOf('p1'), { storage })
    planActions.reset()
    expect(getPlanState().result).toBeNull()
    expect(planActions.hydrate(storage)).toBe(true)
    expect(getPlanState().result?.plan_id).toBe('p1')
    expect(getPlanState().restored).toBe(true)
    expect(planActions.hydrate(storage)).toBe(false)
  })

  it('opens a cached run from history and reports misses', () => {
    const storage = new FakeStorage()
    planActions.finishRun(planActions.beginRun(), resultOf('p1'), { storage })
    planActions.finishRun(planActions.beginRun(), resultOf('p2'), { storage })
    planActions.addPin(1, 3)
    expect(planActions.openCached('p1', storage)).toBe(true)
    expect(getPlanState().result?.plan_id).toBe('p1')
    expect(getPlanState().pins.size).toBe(0)
    expect(planActions.openCached('nope', storage)).toBe(false)
    expect([...cachedPlanIds(storage)]).toEqual(['p2', 'p1'])
  })

  it('ignores broken JSON and shrinks the cache when the quota is hit', () => {
    const storage = new FakeStorage()
    storage.setItem(PLAN_CACHE_KEY, '{not json')
    expect(readPlanCache(storage)).toEqual([])
    storage.quota = 140
    const kept = writePlanCache(storage, { planId: 'x', result: resultOf('x'), builtAt: 1, startDate: null })
    expect(kept.length).toBeLessThanOrEqual(1)
    expect(planActions.hydrate(null)).toBe(false)
  })
})
