import { beforeEach, describe, expect, it } from 'vitest'
import type { ScheduleResult } from '../../lib/api'
import { INITIAL_PARAMS, getPlanState, planActions, subscribePlan } from './planStore'

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
