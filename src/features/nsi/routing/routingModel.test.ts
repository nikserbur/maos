import { describe, expect, it } from 'vitest'
import type { Operation, WorkCenterType } from '../../../lib/api'
import {
  INIT_STATE, capacityBottleneck, longestId, opsFromApi, payloadFromState, routingReducer, saveBlocker, sortOps, totalMinutes,
  typesFromNames, unknownInputOps, validateRouting,
} from './routingModel'

const add = (s = INIT_STATE, title = 'Отрезка', t = 30) => routingReducer(s, { type: 'ADD_OP', title, wcType: 'Пила', timeMin: t })

const op = (p: Partial<Operation>): Operation => ({
  id: 'x', routing_id: 'r', code: '', name: '', op_type: '', wc_types: '', order_no: '10', setup_required: '0',
  t_norm: '', t_opt: '', t_pess: '', cost: '', risk_coef: '', controls: '', mechanisms: '', inputs: '', outputs: '', created_at: '',
  ...p,
})

const WC: WorkCenterType[] = [
  { id: 'wc-pila', name: 'Пила' },
  { id: 'wc-line', name: 'Формовочная линия (альфа-сет, OMEGA)' },
  { id: 'wc-mol', name: 'Молот' },
].map((t) => ({ group_name: '', kind: '', characteristics: '', description: '', interchangeable: '0', created_at: '', ...t }))

describe('routingReducer', () => {
  it('adds operations with increasing order and selects the new one', () => {
    const s1 = add()
    const s2 = add(s1, 'Ковка', 60)
    expect(sortOps(s2.ops).map((o) => o.title)).toEqual(['Отрезка', 'Ковка'])
    expect(s2.ops[1].order).toBeGreaterThan(s2.ops[0].order)
    expect(s2.selectedId).toBe(s2.ops[1].id)
    expect(s2.dirty).toBe(true)
    expect(s2.ops[0]).toMatchObject({ tOpt: 30, tPess: 30, setupMin: 0, inputsKnown: true })
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

  it('finds the longest operation, the capacity bottleneck and sums minutes', () => {
    const s = add(add(), 'Ковка', 60)
    const [first, second] = sortOps(s.ops)
    expect(longestId(s.ops)).toBe(second.id)
    expect(totalMinutes(s.ops)).toBe(90)
    // 30 мин на одном станке тяжелее, чем 60 мин на трёх.
    const bn = capacityBottleneck(s.ops, (o) => (o.id === first.id ? 1 : 3))
    expect(bn).toMatchObject({ id: first.id, minutes: 30, machines: 1, perMachine: 30 })
  })
})

describe('typesFromNames', () => {
  it('matches whole names, including names that contain commas', () => {
    expect(typesFromNames('Формовочная линия (альфа-сет, OMEGA), Молот', WC).map((t) => t.id)).toEqual(['wc-line', 'wc-mol'])
    expect(typesFromNames('Пила', WC).map((t) => t.id)).toEqual(['wc-pila'])
    expect(typesFromNames('Пилорама', WC)).toEqual([])
    expect(typesFromNames('', WC)).toEqual([])
  })
})

describe('API round trip', () => {
  const api: Operation[] = [
    op({ id: '1', code: 'OP-020', name: 'Ковка', op_type: 'machining', wc_types: 'Молот', order_no: '20', t_norm: '36', t_opt: '30', t_pess: '50', risk_coef: '0.05', controls: 'ГОСТ, ТУ', inputs: '[]', outputs: 'поковка' }),
    op({ id: '2', code: 'OP-010', name: 'Отрезка', wc_types: 'Пила', order_no: '10', t_norm: '57', t_opt: '57', t_pess: '57', inputs: '[{"productId":"p","name":"пруток","qty":1,"unit":"шт"}]' }),
    op({ id: '3', routing_id: 'other', name: 'Чужая', t_norm: '1' }),
  ]

  it('reads only this routing in order and parses IDEF0 fields', () => {
    const ops = opsFromApi(api, 'r', WC)
    expect(ops.map((o) => o.title)).toEqual(['Отрезка', 'Ковка'])
    expect(ops[0].inputs[0].name).toBe('пруток')
    expect(ops[1].controls).toEqual(['ГОСТ', 'ТУ'])
    expect(ops[1].wcTypeIds).toEqual(['wc-mol'])
  })

  it('loses no field: every operation field round-trips unchanged', () => {
    const full = op({
      id: 'a', code: 'OP-030', name: 'Обточка шеек', op_type: 'machining', wc_types: 'Формовочная линия (альфа-сет, OMEGA), Молот',
      order_no: '30', setup_required: '1', setup_time: '25.0', t_norm: '33.0', t_opt: '25.0', t_pess: '63.0', cost: '1200',
      risk_coef: '0.07', labor_rate: '450.0', controls: 'ГОСТ 1', mechanisms: 'Разряд 5', outputs: 'вал',
      inputs: '[{"productId":"p1","name":"заготовка","qty":0.25,"unit":"шт"}]',
      wc_type_ids: ['wc-line', 'wc-mol'],
    })
    const state = routingReducer(INIT_STATE, { type: 'INIT', name: 'ТК', productId: 'fin-1', ops: opsFromApi([full], 'r', WC) })
    const sent = payloadFromState(state, WC).operations?.[0]
    expect(sent).toBeDefined()
    const textFields = ['code', 'name', 'op_type', 'order_no', 'setup_required', 'cost', 'controls', 'mechanisms', 'outputs'] as const
    for (const k of textFields) expect(sent?.[k], k).toBe(full[k])
    const numFields = ['setup_time', 't_norm', 't_opt', 't_pess', 'risk_coef', 'labor_rate'] as const
    for (const k of numFields) expect(Number(sent?.[k]), k).toBe(Number(full[k]))
    expect(sent?.wc_type_ids).toEqual(['wc-line', 'wc-mol'])
    expect(sent?.wc_types).toBe(full.wc_types)
    expect(JSON.parse(String(sent?.inputs))).toEqual(JSON.parse(full.inputs))
  })

  it('writes the payload shape the server expects (wc_type_ids by name, order_no, joined tags)', () => {
    const state = routingReducer(INIT_STATE, { type: 'INIT', name: 'ТК', productId: 'fin-1', ops: opsFromApi(api, 'r', WC) })
    const payload = payloadFromState(state, WC)
    expect(payload.name).toBe('ТК')
    expect(payload.product_id).toBe('fin-1')
    expect(payload.operations?.[0]).toMatchObject({ code: 'OP-010', name: 'Отрезка', wc_types: 'Пила', wc_type_ids: ['wc-pila'], order_no: '10', t_norm: '57' })
    expect(payload.operations?.[1]).toMatchObject({ controls: 'ГОСТ,ТУ', outputs: 'поковка', wc_type_ids: ['wc-mol'], t_opt: '30', t_pess: '50', inputs: '[]' })
    expect(validateRouting(state)).toBeNull()
    expect(saveBlocker(state)).toBeNull()
  })

  it('blocks saving when an operation’s inputs were not loaded', () => {
    const ops = opsFromApi([op({ name: 'Литьё', wc_types: 'Пила', inputs: '' }), op({ name: 'Ковка', order_no: '20', wc_types: 'Молот', inputs: '[]' })], 'r', WC)
    expect(ops[0].inputsKnown).toBe(false)
    expect(ops[1].inputsKnown).toBe(true)
    const state = routingReducer(INIT_STATE, { type: 'INIT', name: 'ТК', productId: '', ops })
    expect(unknownInputOps(state.ops)).toEqual([1])
    expect(saveBlocker(state)).toMatch(/№ 1/)
  })

  it('validates name, emptiness and missing work centres', () => {
    expect(validateRouting(INIT_STATE)).toMatch(/название/)
    expect(validateRouting({ ...INIT_STATE, name: 'x' })).toMatch(/хотя бы одну/)
    const s = routingReducer({ ...INIT_STATE, name: 'x' }, { type: 'ADD_OP', title: 'a', wcType: '', timeMin: 1 })
    expect(validateRouting(s)).toMatch(/тип оборудования/)
  })
})

describe('version plan and canvas layout', () => {
  it('names the next version and the one that is active now', async () => {
    const { versionPlan } = await import('./routingVersion')
    const products = [{ id: 'p1', code: 'ГП-0001', name: 'Вал' }] as never
    const routings = [
      { id: 'r1', name: 'ТК', product_id: 'p1', created_at: '', version: '1', is_default: '1' },
      { id: 'alt', name: 'Альт', product_id: 'p1', created_at: '', version: '1', is_default: '0' },
    ]
    const own = versionPlan({ productId: 'p1', products, routings, editing: routings[0], setupLoss: 0 })
    expect(own.consequence).toMatch(/версию v2 — станет действующей для ГП-0001 Вал \(сейчас действует v1\)/)
    expect(own.confirmLabel).toBe('Сохранить как v2')
    const alt = versionPlan({ productId: 'p1', products, routings, editing: routings[1], setupLoss: 3 })
    expect(alt.confirmLabel).toBe('Сделать действующей')
    expect(alt.consequence).toMatch(/станет альтернативой/)
    expect(alt.notes[0]).toMatch(/у 3\u00a0операций/)
    expect(versionPlan({ productId: '', products, routings, editing: null, setupLoss: 0 }).consequence).toMatch(/без изделия|не привязана/)
  })

  it('lays 8 operations out three per row on a 1040 px canvas (fit zoom ≈ 1)', async () => {
    const { layoutFor } = await import('./RoutingCanvas')
    expect(layoutFor(8, 'wc', { w: 1040, h: 560 }).perRow).toBe(3)
    expect(layoutFor(8, 'wc').perRow).toBe(4)
    expect(layoutFor(3, 'wc', { w: 1600, h: 700 }).perRow).toBe(3)
  })
})
