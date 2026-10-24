import { describe, expect, it } from 'vitest'
import type { Machine, Operation, Product, Routing, Worker, WorkCenterType } from '../../lib/api'
import { buildLookups, tabSortKey, workerIncomplete, workerTypes } from './nsiLookups'
import { changedFields, sameValue } from './forms/formBridge'
import { validateWorker } from './forms/WorkerForm'
import { registryChoices } from './routing/AddOperation'
import { REGISTRIES, isDefaultRouting, opTypeLabel, productRole, routingVariantName, shopCode, shopShort, splitName } from './registries'

const wct = (id: string, name: string, group = 'Цех №1 — Литейный (корпус А)'): WorkCenterType =>
  ({ id, name, group_name: group, kind: '', characteristics: '', description: '', interchangeable: '0', created_at: '' })
const machine = (id: string, type: string): Machine =>
  ({ id, name: id, wc_type_id: type, org_unit: '', inv_no: '', serial_no: '', year_made: '', schedule: '', status: 'active', subtitle: '', pos_x: '', pos_z: '', rotation_y: '', parent_machine_id: '', created_at: '' })
const worker = (p: Partial<Worker>): Worker =>
  ({ id: 'w', tab_no: 'T0001', last_name: 'Иванов', first_name: 'Иван', middle_name: '', org_unit: 'Цех №1', position: '', grade: '3', skills: '', created_at: '', ...p })
const op = (p: Partial<Operation>): Operation => ({
  id: 'o', routing_id: 'r1', code: '', name: 'Оп', op_type: '', wc_types: '', order_no: '10', setup_required: '0',
  t_norm: '10', t_opt: '', t_pess: '', cost: '', risk_coef: '', controls: '', mechanisms: '', inputs: '', outputs: '', created_at: '', ...p,
})
const routing = (id: string, product: string, isDefault: string, version = '1'): Routing => ({ id, name: id, product_id: product, created_at: '', is_default: isDefault, version })

describe('registries vocabulary', () => {
  it('keeps one-line subtitles within 90 characters', () => {
    for (const r of REGISTRIES) expect(r.description.length, r.id).toBeLessThanOrEqual(90)
  })
  it('labels operation types and never shows raw ids', () => {
    expect(opTypeLabel('machining')).toBe('Механообработка')
    expect(opTypeLabel('')).toBe('')
    expect(opTypeLabel('laser_cut')).not.toBe('laser_cut')
  })
  it('derives product role, shop names and alternative routing names', () => {
    expect(productRole({ purchased: '1' })).toBe('raw')
    expect(productRole({ sellable: '1' })).toBe('product')
    expect(productRole({})).toBe('semi')
    expect(shopShort('Цех №1 — Литейный (корпус А)')).toBe('Цех №1 — Литейный')
    expect(shopCode('Цех №1 — Литейный (корпус А)')).toBe('Цех №1')
    expect(splitName('Насос — для химпрома')).toEqual(['Насос', 'для химпрома'])
    expect(routingVariantName('Альтернативная техкарта (взаимозаменяемые станки): ТК Валы 01', false)).toBe('Альтернатива: взаимозаменяемые станки')
    expect(isDefaultRouting({ is_default: '' })).toBe(true)
    expect(isDefaultRouting({ is_default: '0' })).toBe(false)
  })
})

describe('nsiLookups', () => {
  const wcTypes = [wct('t1', 'Пила'), wct('t2', 'Линия (альфа, OMEGA)'), wct('t3', 'Молот')]
  const lk = buildLookups({
    wcTypes,
    machines: [machine('m1', 't1'), machine('m2', 't1'), machine('m3', 't2')],
    workers: [worker({ skills: 'Пила' }), worker({ id: 'w2', skills: '' })],
    products: [] as Product[],
    operations: [
      op({ id: 'a', wc_types: 'Пила', t_norm: '30' }),
      op({ id: 'b', wc_types: 'Линия (альфа, OMEGA), Молот', order_no: '20', t_norm: '50', name: 'Длинная' }),
      op({ id: 'c', routing_id: 'old', wc_types: 'Молот', t_norm: '5' }),
    ],
    routings: [routing('r1', 'p1', '1', '2'), routing('old', 'p1', '0')],
  })
  it('counts machines, eligible operators and operations of active routings per type', () => {
    expect(lk.machinesByType.get('t1')).toBe(2)
    expect(lk.operatorsByType.get('t1')).toBe(2) // универсал + допущенный
    expect(lk.operatorsByType.get('t2')).toBe(1) // только универсал
    expect(lk.opsByType.get('t2')).toBe(1)
    expect(lk.opsByType.get('t3')).toBe(1) // операция недействующей техкарты не считается
  })
  it('summarises routings and counts product variants', () => {
    expect(lk.routingStats.get('r1')).toEqual({ ops: 2, totalMin: 80, longest: { name: 'Длинная', min: 50 } })
    expect(lk.variantsByProduct.get('p1')).toBe(2)
  })
  it('flags incomplete workers and sorts tab numbers naturally', () => {
    expect(workerIncomplete(worker({ last_name: '222', first_name: '234' }))).toBe('имя без букв')
    expect(workerIncomplete(worker({ org_unit: '', org_unit_id: '' }))).toBe('нет подразделения')
    expect(workerIncomplete(worker({}))).toBeNull()
    expect(['T0010', 'T0002', '12'].sort((a, b) => tabSortKey(a).localeCompare(tabSortKey(b)))).toEqual(['12', 'T0002', 'T0010'])
    expect(workerTypes(worker({ skills: '' }), wcTypes)).toBeNull()
    expect(workerTypes(worker({ skills: 'Молот' }), wcTypes)?.map((t) => t.id)).toEqual(['t3'])
  })
})

describe('form edits send only what changed', () => {
  it('compares numbers by value and blanks as equal', () => {
    expect(sameValue('6800.0', '6800')).toBe(true)
    expect(sameValue('', undefined)).toBe(true)
    expect(sameValue('a', 'b')).toBe(false)
  })
  it('returns a new object with the changed fields only', () => {
    const base = { name: 'Ковка', t_norm: '36.0', controls: '' }
    const next = { name: 'Ковка горячая', t_norm: '36', controls: '' }
    expect(changedFields(next, base)).toEqual({ name: 'Ковка горячая' })
    expect(base.name).toBe('Ковка')
  })
})

describe('worker validation', () => {
  const taken = new Set(['T0001'])
  it('rejects a digit-only surname with a message', () => {
    expect(validateWorker({ last: '222', first: 'Иван', tab: 'T0005', unit: 'ou-00' }, taken).last).toMatch(/буквы/)
  })
  it('requires a department and a unique T0000 tab number', () => {
    const e = validateWorker({ last: 'Петров', first: 'Пётр', tab: 'T0001', unit: '' }, taken)
    expect(e.unit).toMatch(/цех/)
    expect(e.tab).toMatch(/занят/)
    expect(validateWorker({ last: 'Петров', first: 'Пётр', tab: '42', unit: 'ou-00' }, taken).tab).toMatch(/T0042/)
    expect(validateWorker({ last: 'Петров', first: 'Пётр', tab: 'т0042', unit: 'ou-00' }, taken)).toEqual({})
  })
})

describe('constructor registry choices', () => {
  it('dedupes by name + machine type and groups by type with time', () => {
    const groups = registryChoices([
      op({ id: '1', name: 'Отрезка', wc_types: 'Пила', t_norm: '57' }),
      op({ id: '2', name: 'Отрезка', wc_types: 'Пила', t_norm: '48' }),
      op({ id: '3', name: 'Ковка', wc_types: 'Молот', t_norm: '36' }),
    ])
    expect(groups.map(([g]) => g)).toEqual(['Молот', 'Пила'])
    expect(groups[1][1]).toHaveLength(1)
    expect(groups[1][1][0].label).toMatch(/^Отрезка · 57/)
  })
})
