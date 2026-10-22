import { describe, expect, it } from 'vitest'
import type { Operation } from '../../../lib/api'
import { INIT_STATE, bottleneckId, opsFromApi, payloadFromState, routingReducer, sortOps, totalMinutes, validateRouting } from './routingModel'

const add = (s = INIT_STATE, title = 'Отрезка', t = 30) => routingReducer(s, { type: 'ADD_OP', title, opType: '', wcType: 'Пила', timeMin: t })

describe('routingReducer', () => {
  it('adds operations with increasing order and selects the new one', () => {
    const s1 = add()
    const s2 = add(s1, 'Ковка', 60)
    expect(sortOps(s2.ops).map((o) => o.title)).toEqual(['Отрезка', 'Ковка'])
    expect(s2.ops[1].order).toBeGreaterThan(s2.ops[0].order)
    expect(s2.selectedId).toBe(s2.ops[1].id)
    expect(s2.dirty).toBe(true)
  })

  it('moves an operation to an index and renumbers the route', () => {
    const s = add(add(add(), 'Ковка', 60), 'Обточка', 75)
    const target = sortOps(s.ops)[2]
    const moved = routingReducer(s, { type: 'MOVE_TO', id: target.id, index: 0 })
    expect(sortOps(moved.ops).map((o) => o.title)).toEqual(['Обточка', 'Отрезка', 'Ковка'])
    expect(sortOps(moved.ops).map((o) => o.order)).toEqual([10, 20, 30])
    const up = routingReducer(moved, { type: 'MOVE', id: target.id, delta: 1 })
    expect(sortOps(up.ops)[1].id).toBe(target.id)
  })

  it('does not mutate the previous state', () => {
    const s = add()
    const before = JSON.stringify(s)
    routingReducer(s, { type: 'ADD_TAG', id: s.ops[0].id, field: 'controls', value: 'ГОСТ' })
    expect(JSON.stringify(s)).toBe(before)
  })

  it('finds the bottleneck and sums minutes', () => {
    const s = add(add(), 'Ковка', 60)
    expect(bottleneckId(s.ops)).toBe(sortOps(s.ops)[1].id)
    expect(totalMinutes(s.ops)).toBe(90)
  })
})

describe('API round trip', () => {
  const api: Operation[] = [
    { id: '1', routing_id: 'r', code: 'OP-020', name: 'Ковка', op_type: '', wc_types: 'Молот', order_no: '20', setup_required: '0', t_norm: '36', t_opt: '36', t_pess: '36', cost: '', risk_coef: '0.05', controls: 'ГОСТ, ТУ', mechanisms: '', inputs: '', outputs: 'поковка', created_at: '' },
    { id: '2', routing_id: 'r', code: 'OP-010', name: 'Отрезка', op_type: '', wc_types: 'Пила', order_no: '10', setup_required: '0', t_norm: '57', t_opt: '57', t_pess: '57', cost: '', risk_coef: '0.05', controls: '', mechanisms: '', inputs: '[{"productId":"p","name":"пруток","qty":1,"unit":"шт"}]', outputs: '', created_at: '' },
    { id: '3', routing_id: 'other', code: 'OP-010', name: 'Чужая', op_type: '', wc_types: '', order_no: '10', setup_required: '0', t_norm: '1', t_opt: '1', t_pess: '1', cost: '', risk_coef: '0.05', controls: '', mechanisms: '', inputs: '', outputs: '', created_at: '' },
  ]

  it('reads only this routing in order and parses IDEF0 fields', () => {
    const ops = opsFromApi(api, 'r')
    expect(ops.map((o) => o.title)).toEqual(['Отрезка', 'Ковка'])
    expect(ops[0].inputs[0].name).toBe('пруток')
    expect(ops[1].controls).toEqual(['ГОСТ', 'ТУ'])
  })

  it('writes the same payload shape as before (wc_type_ids by name, order_no, joined tags)', () => {
    const state = routingReducer(INIT_STATE, { type: 'INIT', name: 'ТК', productId: 'fin-1', ops: opsFromApi(api, 'r') })
    const payload = payloadFromState(state, [{ id: 'wc-pila', name: 'Пила' } as never])
    expect(payload.name).toBe('ТК')
    expect(payload.product_id).toBe('fin-1')
    expect(payload.operations?.[0]).toMatchObject({ code: 'OP-010', name: 'Отрезка', wc_types: 'Пила', wc_type_ids: ['wc-pila'], order_no: '10', t_norm: '57' })
    expect(payload.operations?.[1]).toMatchObject({ controls: 'ГОСТ,ТУ', outputs: 'поковка', wc_type_ids: [] })
    expect(validateRouting(state)).toBeNull()
  })

  it('validates name, emptiness and missing work centres', () => {
    expect(validateRouting(INIT_STATE)).toMatch(/название/)
    expect(validateRouting({ ...INIT_STATE, name: 'x' })).toMatch(/хотя бы одну/)
    const s = routingReducer({ ...INIT_STATE, name: 'x' }, { type: 'ADD_OP', title: 'a', opType: '', wcType: '', timeMin: 1 })
    expect(validateRouting(s)).toMatch(/тип оборудования/)
  })
})
