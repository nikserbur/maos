import { describe, expect, it } from 'vitest'
import type { GanttJob, ScheduleResult, StructuralMove } from '../../../lib/api'
import { ZERO_IMPACT } from '../moves/movesStore'
import { applyMoves, touches } from './applyMoves'
import { diffRoutes, diffSchedules, stepChange } from './diffModel'

const bar = (job_idx: number, order_idx: number, op_id: string, machine_id: string, start: number, end: number): GanttJob => ({
  job_idx, order_idx, product_id: `p${order_idx}`, product_name: `Изделие ${order_idx}`, op_id, op_name: `оп.${op_id}`,
  wc_type_id: 'wc1', wc_name: 'Токарный', machine_id, machine_name: `Станок ${machine_id}`, worker: 0, start, end, due: 500, late: false,
})

const GANTT = [bar(1, 1, 'a', 'm1', 0, 10), bar(2, 1, 'b', 'm2', 10, 20), bar(3, 2, 'c', 'm1', 10, 18), bar(4, 3, 'd', 'm3', 0, 5)]
const RESULT = { gantt: GANTT } as unknown as ScheduleResult

const move = (id: string, patch: Partial<StructuralMove>): StructuralMove => ({
  id, kind: 'shift', status: 'accepted', targets: {}, before: {}, after: {}, impact: ZERO_IMPACT,
  justification: { regime: { id: 'r', label: 'r', share: 0 }, scenarios: [], map_nodes: [] },
  masks_checked: [], proposed_at: '', agent: { level: 'L2', policy_version: 'v', seed: 1 }, ...patch,
})

describe('applyMoves', () => {
  it('matches targets by op, order, machine or product', () => {
    expect(touches(move('x', { targets: { op_ids: ['a'] } }), GANTT[0])).toBe(true)
    expect(touches(move('x', { targets: { order_idx: [2] } }), GANTT[2])).toBe(true)
    expect(touches(move('x', { targets: { machine_ids: ['m3'] } }), GANTT[3])).toBe(true)
    expect(touches(move('x', { targets: {} }), GANTT[0])).toBe(false)
    // все заданные измерения — через И: операция другого заказа не задевается
    expect(touches(move('x', { targets: { op_ids: ['a'], order_idx: [2] } }), GANTT[0])).toBe(false)
  })

  it('shifts an order, reassigns a machine, drops outsourced ops and marks frozen without moving', () => {
    const moves = [
      move('shift', { targets: { order_idx: [1] }, before: { release_hours: 0 }, after: { release_hours: 24 } }),
      move('re', { kind: 'reassign', targets: { op_ids: ['c'] }, after: { machine_id: 'm2', machine_name: 'Станок m2' } }),
      move('out', { kind: 'outsource', status: 'proposed', targets: { op_ids: ['d'] }, after: { outsourced: true } }),
    ]
    const status = (m: StructuralMove) => (m.id === 'out' ? 'accepted' : m.id === 're' ? 'frozen' : m.status)
    const after = applyMoves(RESULT, moves, status)
    const by = new Map(after.map((b) => [b.job_idx, b]))
    expect(by.get(1)!.start).toBe(24)
    expect(by.get(2)!.end).toBe(44)
    expect(by.get(3)!.machine_id).toBe('m1')
    expect(by.get(3)!.frozen).toBe(true)
    expect(by.has(4)).toBe(false)
    // исходный результат не мутирован
    expect(GANTT[0].start).toBe(0)
  })

  it('splits a bar into N batches', () => {
    const after = applyMoves(RESULT, [move('s', { kind: 'split', targets: { op_ids: ['a'] }, after: { n_batches: 2 } })], (m) => m.status)
    const parts = after.filter((b) => b.op_id === 'a')
    expect(parts).toHaveLength(2)
    expect(parts[1].start).toBe(5)
    expect(parts[1].end).toBe(10)
  })
})

describe('diffSchedules', () => {
  it('classifies same / moved / removed / added / frozen and orders changed lanes first', () => {
    const after = applyMoves(RESULT, [
      move('shift', { targets: { order_idx: [1] }, before: { release_hours: 0 }, after: { release_hours: 24 } }),
      move('out', { kind: 'outsource', targets: { op_ids: ['d'] }, after: { outsourced: true } }),
      move('fr', { targets: { op_ids: ['c'] } }),
    ], (m) => (m.id === 'fr' ? 'frozen' : 'accepted'))
    const extra = { ...bar(9, 4, 'z', 'm3', 30, 40), moveId: 'add' }
    const d = diffSchedules(GANTT, [...after, extra])
    expect(d.summary).toEqual({ same: 0, moved: 2, removed: 1, added: 1, frozen: 1 })
    expect(d.lanes.every((l) => l.changed)).toBe(true)
    const m1 = d.lanes.find((l) => l.machineId === 'm1')!
    expect(m1.after.find((b) => b.bar.job_idx === 1)!.from).toEqual({ machine_id: 'm1', machine_name: 'Станок m1', start: 0, end: 10 })
    expect(d.changes.map((c) => c.kind)).toEqual(['removed', 'frozen', 'moved', 'added', 'moved'])
    expect(d.makespan).toBe(44)
  })

  it('keeps unchanged lanes unchanged', () => {
    const d = diffSchedules(GANTT, GANTT)
    expect(d.summary.same).toBe(4)
    expect(d.changes).toEqual([])
    expect(d.lanes.some((l) => l.changed)).toBe(false)
  })

  it('steps through changes cyclically for j/k', () => {
    const d = diffSchedules(GANTT, applyMoves(RESULT, [move('o', { kind: 'outsource', targets: { order_idx: [1] }, after: { outsourced: true } })], () => 'accepted'))
    const keys = d.changes.map((c) => c.key)
    expect(stepChange(d.changes, null, 1)).toBe(keys[0])
    expect(stepChange(d.changes, keys[0], 1)).toBe(keys[1])
    expect(stepChange(d.changes, keys[0], -1)).toBe(keys[keys.length - 1])
    expect(stepChange([], null, 1)).toBeNull()
  })
})

describe('diffRoutes', () => {
  it('builds per-order chains with removed / moved / added steps, changed orders first', () => {
    const after = applyMoves(RESULT, [
      move('out', { kind: 'outsource', targets: { op_ids: ['b'] }, after: { outsourced: true } }),
      move('re', { kind: 'reassign', targets: { op_ids: ['c'] }, after: { machine_id: 'm2', machine_name: 'Станок m2' } }),
    ], () => 'accepted')
    const rows = diffRoutes(GANTT, after)
    expect(rows.map((r) => r.orderIdx)).toEqual([1, 2, 3])
    expect(rows[0].steps.map((s) => s.kind)).toEqual(['same', 'removed'])
    expect(rows[1].steps[0]).toMatchObject({ kind: 'moved', wc_name: 'Станок m1 → Станок m2', count: 1 })
    expect(rows[2].changed).toBe(false)
  })
})

describe('diffRoutes collapsing', () => {
  it('collapses consecutive batches of one operation and shows a time shift for same-machine moves', () => {
    const before = [bar(1, 1, 'a', 'm1', 0, 5), bar(2, 1, 'a', 'm1', 5, 10), bar(3, 1, 'b', 'm2', 10, 20)]
    const after = before.map((b) => ({ ...b, start: b.start + 24, end: b.end + 24 }))
    const rows = diffRoutes(before, after)
    expect(rows[0].steps).toHaveLength(2)
    expect(rows[0].steps[0]).toMatchObject({ op_id: 'a', count: 2 })
    expect(rows[0].steps[0].wc_name).toMatch(/^Токарный · сдвиг \+24\s?ч$/)
  })
})

describe('fitLabel (диф Ганта)', () => {
  it('truncates labels to the bar width with an ellipsis', async () => {
    const { fitLabel } = await import('./GanttDiff')
    expect(fitLabel('Точение', 200)).toBe('Точение')
    expect(fitLabel('Фрезерование шпоночных пазов', 60)).toMatch(/…$/)
    expect(fitLabel('Фрезерование', 10)).toBe('')
  })
})
