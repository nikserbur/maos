import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduleResult } from '../../../lib/api'
import { getGuardrails, resetGuardrailsStore } from '../../agents/guardrailsStore'
import { DEMO_PREFIX, movesActions } from './decisionsStore'
import { demoMoves } from './fixtures'
import { movesSource } from './movesSource'

const RESULT = {
  plan_id: 'p1', alpha: 0.1, n_jobs: 2, rule: 'EDD',
  gantt: [
    { job_idx: 1, order_idx: 1, product_id: 'p', product_name: 'Вал', op_id: 'a', op_name: 'оп.a', wc_type_id: 'w', wc_name: 'Токарный', machine_id: 'm1', machine_name: 'Станок 1', worker: 0, start: 0, end: 5, due: 50, late: false },
    { job_idx: 2, order_idx: 2, product_id: 'p', product_name: 'Вал', op_id: 'b', op_name: 'оп.b', wc_type_id: 'w', wc_name: 'Токарный', machine_id: 'm2', machine_name: 'Станок 2', worker: 0, start: 0, end: 5, due: 50, late: false },
  ],
} as unknown as ScheduleResult

afterEach(() => { movesActions.reset(); resetGuardrailsStore() })

describe('moves session store', () => {
  it('falls back to an example with a demo key when the run has no moves', () => {
    const src = movesSource(RESULT)
    expect(src.kind).toBe('demo')
    expect(src.runKey.startsWith(DEMO_PREFIX)).toBe(true)
    expect(movesSource({ ...RESULT, moves: { ...demoMoves(RESULT)!, moves: [] } }).kind).toBe('agent-empty')
  })

  it('accepts a dependent move as a package and announces it', () => {
    const moves = demoMoves(RESULT)!.moves
    const r = movesActions.decide('demo:p1', moves, 'demo-shift', 'accept')
    expect(Object.keys(r.state.decisions).sort()).toEqual(['demo-out', 'demo-shift'])
  })

  it('never writes example decisions into project guardrails', () => {
    const moves = demoMoves(RESULT)!.moves
    movesActions.decide(`${DEMO_PREFIX}p1`, moves, 'demo-out', 'freeze')
    movesActions.decide(`${DEMO_PREFIX}p1`, moves, 'demo-split', 'reject', 'другое')
    expect(getGuardrails().frozen).toEqual([])
    expect(getGuardrails().rejected_masks).toEqual([])
  })
})
