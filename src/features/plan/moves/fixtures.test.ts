import { describe, expect, it } from 'vitest'
import type { GanttJob, ScheduleResult } from '../../../lib/api'
import { applyMoves } from '../diff/applyMoves'
import { diffSchedules } from '../diff/diffModel'
import { demoMoves, isDemoMove } from './fixtures'
import { EMPTY_DECISIONS, acceptSafe, isSafe, statusOf } from './movesStore'

const bar = (job_idx: number, order_idx: number, op_id: string, machine_id: string, start: number, end: number): GanttJob => ({
  job_idx, order_idx, product_id: 'p', product_name: 'Вал', op_id, op_name: `оп.${op_id}`,
  wc_type_id: 'lathe', wc_name: 'Токарный', machine_id, machine_name: `Станок ${machine_id}`, worker: 0, start, end, due: 500, late: false,
})

const GANTT = [bar(1, 1, 'a', 'm1', 0, 10), bar(2, 2, 'a', 'm2', 0, 8), bar(3, 3, 'a', 'm1', 10, 20), bar(4, 4, 'b', 'm2', 8, 16), bar(5, 3, 'b', 'm2', 20, 30)]
const RESULT = { gantt: GANTT, alpha: 0.1, plan_id: 'p1' } as unknown as ScheduleResult

describe('demo moves (пример)', () => {
  it('targets real orders and ops of the schedule and is always marked as an example', () => {
    const r = demoMoves(RESULT)!
    expect(r.moves.length).toBeGreaterThanOrEqual(5)
    expect(r.moves.every(isDemoMove)).toBe(true)
    const orders = new Set(GANTT.map((g) => g.order_idx))
    for (const m of r.moves) for (const o of m.targets.order_idx ?? []) expect(orders.has(o)).toBe(true)
    expect(demoMoves({ ...RESULT, gantt: [] } as ScheduleResult)).toBeNull()
  })

  it('has a dependency, safe and unsafe moves; accepting safe ones respects the package', () => {
    const r = demoMoves(RESULT)!
    expect(r.moves.some((m) => (m.depends_on ?? []).length > 0)).toBe(true)
    expect(r.moves.some(isSafe)).toBe(true)
    expect(r.moves.some((m) => !isSafe(m))).toBe(true)
    const { state, accepted } = acceptSafe(EMPTY_DECISIONS, r.moves)
    expect(accepted).toContain('demo-out')
    expect(statusOf(r.moves.find((m) => m.id === 'demo-shift-2')!, state)).toBe('proposed')
  })

  it('produces a schedule diff that matches the accepted moves', () => {
    const r = demoMoves(RESULT)!
    const { state } = acceptSafe(EMPTY_DECISIONS, r.moves)
    const after = applyMoves(RESULT, r.moves, (m) => statusOf(m, state))
    const d = diffSchedules(GANTT, after)
    expect(d.summary.removed).toBe(1) // аутсорсинг снимает одну операцию одного заказа
    expect(d.changes.length).toBeGreaterThan(0)
    expect(d.changes.every((c) => !c.moveId || r.moves.some((m) => m.id === c.moveId))).toBe(true)
  })
})
