import { describe, expect, it } from 'vitest'
import type { KpiBundle, Machine, SimPlan, WorkCenterType } from '../../lib/api'
import { buildGraph, focusSubgraph, graphCounts, matchNodes, opNodeId, producedProductIds, productNodeId } from './buildGraph'
import { buildModel, inputsFromText, pert } from './model'
import { buildOverlay, edgeVolume, edgeWidth, isBottleneck, wcUtilization } from './overlay'
import { buildResources, engineEligible, parseSkills, resourceTotals } from './resources'
import type { OperationRow, ProcessData, ProductRow, RoutingRow, WorkerRow } from './types'

const wct = (id: string, name: string): WorkCenterType => ({
  id, name, group_name: 'Цех', kind: 'cnc', characteristics: '[]', description: '', interchangeable: '', created_at: '',
})
const machine = (id: string, wcTypeId: string, status = 'active'): Machine => ({
  id, name: id, wc_type_id: wcTypeId, org_unit: '', inv_no: '', serial_no: '', year_made: '', schedule: '', status,
  subtitle: '', pos_x: '0', pos_z: '0', rotation_y: '0', parent_machine_id: '', created_at: '',
})
const product = (id: string, name: string, extra: Partial<ProductRow> = {}): ProductRow => ({
  id, code: id.toUpperCase(), name, unit: 'шт', parent_id: '', qty_in_parent: '1', batch_size: '1', stock: '0',
  purchased: '0', created_at: '', sellable: '0', base_cost: '0', base_price: '0', demand_max: '0', ...extra,
})
const routing = (id: string, productId: string, extra: Partial<RoutingRow> = {}): RoutingRow => ({
  id, name: `ТК ${productId}`, product_id: productId, created_at: '', ...extra,
})
const op = (id: string, routingId: string, orderNo: number, extra: Partial<OperationRow> = {}): OperationRow => ({
  id, routing_id: routingId, code: `ОП${orderNo}`, name: `Операция ${id}`, op_type: '', wc_types: '', order_no: String(orderNo),
  setup_required: '0', t_norm: '20', t_opt: '10', t_pess: '60', cost: '0', risk_coef: '0.05', controls: '', mechanisms: '',
  inputs: '', outputs: '', created_at: '', ...extra,
})
const worker = (id: string, skills: string): WorkerRow => ({
  id, tab_no: id, last_name: id, first_name: 'И', middle_name: '', org_unit: '', position: '', grade: '3', skills, created_at: '',
})

function fixture(): ProcessData {
  return {
    products: [
      product('raw-1', 'Прокат', { purchased: '1', unit: 'кг' }),
      product('raw-np', 'Лента без поставщика'),
      product('semi-1', 'Заготовка вала'),
      product('fin-1', 'Насос', { sellable: '1', base_price: '1000' }),
      product('orphan', 'Никому не нужен'),
    ],
    routings: [
      routing('r-semi', 'semi-1'),
      routing('r-fin', 'fin-1', { version: 2, is_default: 1 }),
      routing('r-old', 'fin-1', { version: 1, is_default: 0 }),
    ],
    operations: [
      op('f20', 'r-fin', 20),
      op('f30', 'r-fin', 100),
      op('f10', 'r-fin', 10),
      op('s10', 'r-semi', 10, { t_opt: '30', t_norm: '30', t_pess: '30' }),
      op('old', 'r-old', 10),
      op('lone', '', 10),
    ],
    wcTypes: [wct('wct-a', 'Токарный'), wct('wct-b', 'Фрезерный'), wct('wct-c', 'Сборка')],
    machines: [machine('m1', 'wct-a'), machine('m2', 'wct-a'), machine('m3', 'wct-b'), machine('m4', 'wct-b', 'repair'), machine('m5', 'wct-c')],
    workers: [worker('w1', 'Фрезерный'), worker('w2', 'Фрезерный'), worker('w3', 'Токарный')],
    links: {
      wc_types: [
        { operation_id: 's10', wc_type_id: 'wct-a' },
        { operation_id: 'f10', wc_type_id: 'wct-b' },
        { operation_id: 'f10', wc_type_id: 'wct-a' },
        { operation_id: 'f20', wc_type_id: 'wct-a' },
        { operation_id: 'f30', wc_type_id: 'wct-c' },
      ],
      inputs: [
        { operation_id: 's10', product_id: 'raw-1', qty: 2 },
        { operation_id: 'f10', product_id: 'semi-1', qty: '1' },
        { operation_id: 'f20', product_id: 'raw-np', qty: 0.5 },
        { operation_id: 'f20', product_id: 'raw-1', qty: 3 },
        { operation_id: 'f30', product_id: 'ghost', qty: 1 },
      ],
      time_norms: [{ operation_id: 'f20', wc_type_id: 'wct-a', t_opt: 40, t_norm: 50, t_pess: 90, setup_time: 7 }],
    },
  }
}

describe('buildModel (зеркало load_model)', () => {
  it('takes only default routings and orders operations numerically by order_no', () => {
    const m = buildModel(fixture())
    expect(m.products.get('fin-1')!.opIds).toEqual(['f10', 'f20', 'f30'])
    expect(m.products.get('fin-1')!.routings.map((r) => r.id)).toEqual(['r-fin'])
    expect(m.stats.ignoredOps).toBe(2)
    expect(m.ops.has('old')).toBe(false)
    expect(m.linkSource).toBe('engine')
  })

  it('computes PERT like the engine, incl. 15 % σ fallback and time_norms override', () => {
    expect(pert(10, 20, 60)).toEqual({ tExp: 25, sigma: 50 / 6, fallback: false })
    expect(pert(0, 0, 0).tExp).toBe(30)
    const m = buildModel(fixture())
    const s10 = m.ops.get('s10')!
    expect(s10.sigmaFallback).toBe(true)
    expect(s10.sigma).toBeCloseTo(0.15 * 30, 9)
    const f20 = m.ops.get('f20')!
    expect(f20.pairNorm).toBe(true)
    expect(f20.tExp).toBeCloseTo((40 + 200 + 90) / 6, 9)
    expect(f20.setupTime).toBe(7)
  })

  it('keeps the leading wc type first and drops inputs to unknown products with a warning', () => {
    const m = buildModel(fixture())
    expect(m.ops.get('f10')!.wcTypeIds).toEqual(['wct-b', 'wct-a'])
    expect(m.ops.get('f30')!.inputs).toEqual([])
    expect(m.stats.unresolvedInputs).toBe(1)
    expect(m.warnings.some((w) => w.includes('не найденных'))).toBe(true)
    expect(m.consumersOf.get('raw-1')).toEqual(['s10', 'f20'])
  })

  it('falls back to text columns when the server exposes no link tables', () => {
    const data = fixture()
    data.links = null
    data.operations = [
      op('s10', 'r-semi', 10, { wc_types: 'Токарный', inputs: JSON.stringify([{ productId: 'raw-1', qty: 2 }]) }),
      op('f10', 'r-fin', 10, { wc_types: 'Фрезерный, Токарный', inputs: 'Заготовка вала, Неизвестное' }),
    ]
    const m = buildModel(data)
    expect(m.linkSource).toBe('text')
    expect(m.ops.get('s10')!.wcTypeIds).toEqual(['wct-a'])
    expect(m.ops.get('s10')!.inputs).toEqual([{ productId: 'raw-1', qty: 2 }])
    expect(m.ops.get('f10')!.wcTypeIds).toEqual(['wct-b', 'wct-a'])
    expect(m.ops.get('f10')!.inputs).toEqual([{ productId: 'semi-1', qty: 1 }])
    expect(m.stats.unresolvedInputs).toBe(1)
    expect(m.warnings[0]).toMatch(/не отдаёт/)
  })

  it('parses CSV inputs by name, code or id and aggregates duplicates', () => {
    const m = buildModel(fixture())
    expect(inputsFromText('RAW-1, Прокат, semi-1', m.products)).toEqual({
      inputs: [{ productId: 'raw-1', qty: 2 }, { productId: 'semi-1', qty: 1 }],
      unresolved: 0,
    })
    expect(inputsFromText('', m.products)).toEqual({ inputs: [], unresolved: 0 })
  })
})

describe('buildResources (матрица компетенций движка)', () => {
  it('flags labour-constrained types and caps capacity at min(machines, operators)', () => {
    const data = fixture()
    const res = buildResources(buildModel(data), data)
    const a = res.get('wct-a')!
    expect([a.machines, a.effectiveOperators, a.capacity, a.laborConstrained]).toEqual([2, 1, 1, true])
    const b = res.get('wct-b')!
    expect([b.machines, b.effectiveOperators, b.capacity, b.laborConstrained]).toEqual([1, 2, 1, false])
  })

  it('lets any worker run a type nobody is skilled for (engine fallback)', () => {
    const data = fixture()
    const c = buildResources(buildModel(data), data).get('wct-c')!
    expect(c.eligibleWorkerIds).toEqual([])
    expect(c.fallbackAll).toBe(true)
    expect(c.effectiveOperators).toBe(3)
    expect(c.capacity).toBe(1)
  })

  it('mirrors std::tolower: only ASCII is case-folded, long tokens match as substrings', () => {
    expect(parseSkills(' Токарный ,\tCNC-5 ,')).toEqual(['Токарный', 'cnc-5'])
    expect(engineEligible([], 'Любой', 'x')).toBe(true)
    expect(engineEligible(['токарный'], 'Токарный', 'wct-a')).toBe(false)
    expect(engineEligible(['WCT-A'.toLowerCase()], 'Токарный', 'WCT-A')).toBe(true)
    expect(engineEligible(['Токар'], 'Токарный с ЧПУ', 'x')).toBe(true)
    expect(engineEligible(['ab'], 'abc', 'x')).toBe(false)
  })

  it('sums totals across types', () => {
    const data = fixture()
    const t = resourceTotals(buildResources(buildModel(data), data).values(), data.workers.length)
    expect(t).toEqual({ machines: 4, capacity: 3, laborConstrainedTypes: 1, typesWithoutMachines: 0, workers: 3 })
  })
})

describe('buildGraph', () => {
  const data = fixture()
  const model = buildModel(data)
  const res = buildResources(model, data)

  it('classifies raw / semi / product nodes and skips isolated products', () => {
    const g = buildGraph(model, res)
    const kind = (id: string) => g.nodes.find((n) => n.id === id)?.kind
    expect(kind(productNodeId('raw-1'))).toBe('raw')
    expect(kind(productNodeId('semi-1'))).toBe('semi')
    expect(kind(productNodeId('fin-1'))).toBe('product')
    expect(kind(productNodeId('orphan'))).toBeUndefined()
    expect(g.isolatedProducts).toBe(1)
    expect(g.nodes.find((n) => n.id === productNodeId('raw-np'))!.noRouting).toBe(true)
    expect(g.nodes.find((n) => n.id === productNodeId('raw-1'))!.noRouting).toBe(false)
    // 4 входа + 2 перехода между операциями + 2 выхода в изделие.
    expect(graphCounts(g)).toEqual({ raw: 2, op: 4, semi: 1, product: 1, edges: 8 })
  })

  it('wires inputs → operations → product exactly like the engine expansion', () => {
    const g = buildGraph(model, res)
    const has = (from: string, to: string, kind: string) => g.edges.some((e) => e.from === from && e.to === to && e.kind === kind)
    expect(has(productNodeId('raw-1'), opNodeId('s10'), 'input')).toBe(true)
    expect(has(opNodeId('s10'), productNodeId('semi-1'), 'output')).toBe(true)
    expect(has(productNodeId('semi-1'), opNodeId('f10'), 'input')).toBe(true)
    expect(has(opNodeId('f10'), opNodeId('f20'), 'sequence')).toBe(true)
    expect(has(opNodeId('f20'), opNodeId('f30'), 'sequence')).toBe(true)
    expect(has(opNodeId('f30'), productNodeId('fin-1'), 'output')).toBe(true)
    const e = g.edges.find((x) => x.from === productNodeId('raw-1') && x.to === opNodeId('s10'))!
    expect([e.qty, e.unit]).toEqual([2, 'кг'])
  })

  it('puts machine / operator badges on operations', () => {
    const g = buildGraph(model, res)
    const f10 = g.nodes.find((n) => n.id === opNodeId('f10'))!
    expect(f10.wcTypeId).toBe('wct-b')
    expect(f10.machines).toBe(3) // wct-b (1) + wct-a (2)
    expect(f10.operators).toBe(3) // w1, w2 ∪ w3
    const s10 = g.nodes.find((n) => n.id === opNodeId('s10'))!
    expect(s10.laborConstrained).toBe(true)
    expect(s10.colorIndex).toBe(model.wcTypes.get('wct-a')!.colorIndex)
  })

  it('collapses a routing into its product and aggregates input quantities', () => {
    const g = buildGraph(model, res, { collapsed: new Set(['fin-1']) })
    expect(g.nodes.some((n) => n.kind === 'op' && n.productId === 'fin-1')).toBe(false)
    const fin = g.nodes.find((n) => n.id === productNodeId('fin-1'))!
    expect(fin.collapsedOps).toBe(3)
    const into = g.edges.filter((e) => e.to === productNodeId('fin-1'))
    expect(into.map((e) => [e.from, e.qty]).sort()).toEqual([
      [productNodeId('raw-1'), 3],
      [productNodeId('raw-np'), 0.5],
      [productNodeId('semi-1'), 1],
    ])
    expect(producedProductIds(model)).toEqual(['fin-1', 'semi-1'])
  })

  it('focuses on the full route of a node (ancestors and descendants)', () => {
    const g = buildGraph(model, res)
    const f = focusSubgraph(g, productNodeId('semi-1'))
    const ids = new Set(f.nodes.map((n) => n.id))
    expect(ids.has(productNodeId('raw-1'))).toBe(true)
    expect(ids.has(opNodeId('s10'))).toBe(true)
    expect(ids.has(productNodeId('fin-1'))).toBe(true)
    expect(ids.has(productNodeId('raw-np'))).toBe(false) // вход другой операции — не на маршруте semi-1
    expect(f.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true)
    expect(focusSubgraph(g, 'nope')).toBe(g)
  })

  it('finds nodes by name or code, case-insensitively', () => {
    const g = buildGraph(model, res)
    expect([...matchNodes(g, 'заготовка')]).toEqual([productNodeId('semi-1')])
    expect(matchNodes(g, 'оп100').has(opNodeId('f30'))).toBe(true)
    expect(matchNodes(g, '   ').size).toBe(0)
  })
})

describe('plan overlay', () => {
  const kpi: KpiBundle = {
    plan_id: 'pl-1', created_at: '2026-10-01 10:00:00',
    kpi: { makespan: 120, utilization: 0.4 },
    wc_load: [
      { wc_type_id: 'wct-a', wc_name: 'Токарный', utilization: 0.92, busy_hours: 92, idle_hours: 8 },
      { wc_type_id: 'wct-b', wc_name: 'Фрезерный', utilization: 0.3, busy_hours: 30, idle_hours: 70 },
    ],
    bottleneck: { wc_type_id: 'wct-a', wc_name: 'Токарный', utilization: 0.92 },
    queue_by_wc: [{ wc_type_id: 'wct-a', peak: 5 }],
  }
  const task = (op_id: string, product_id: string, order_idx: number, start: number, end: number) => ({
    machine_id: 'm1', product_id, product_name: '', op_id, op_name: '', order_idx, start, end,
  })
  const plan: SimPlan = {
    plan_id: 'pl-1', makespan: 118,
    tasks: [task('f10', 'fin-1', 0, 0, 4), task('f10', 'fin-1', 1, 4, 10), task('s10', 'semi-1', 0, 0, 2)],
  }

  it('reads utilisation, bottleneck, queues and planned hours of the same plan', () => {
    const o = buildOverlay(kpi, plan)!
    expect(wcUtilization('wct-a', o)).toBe(0.92)
    expect(isBottleneck('wct-a', o)).toBe(true)
    expect(isBottleneck('wct-b', o)).toBe(false)
    expect(o.queuePeak.get('wct-a')).toBe(5)
    expect(o.opHours.get('f10')).toBe(10)
    expect(o.opTasks.get('f10')).toBe(2)
    expect(o.productOrders.get('fin-1')).toBe(2)
    expect(o.makespan).toBe(118)
  })

  it('ignores a task feed from another plan and returns null when there is no plan', () => {
    const o = buildOverlay(kpi, { ...plan, plan_id: 'other' })!
    expect(o.opHours.size).toBe(0)
    expect(o.makespan).toBe(120)
    expect(buildOverlay({ plan_id: null, kpi: {} }, null)).toBeNull()
    expect(wcUtilization('wct-a', null)).toBeNull()
  })

  it('scales edge width by planned volume when a plan is present', () => {
    const o = buildOverlay(kpi, plan)!
    const e = { id: 'e', from: 'a', to: 'b', kind: 'input' as const, qty: 1, unit: 'шт', opIds: ['f10'] }
    const thin = { ...e, opIds: ['s10'] }
    expect(edgeVolume(e, o)).toBe(10)
    expect(edgeWidth(e, 1, o, 10)).toBeGreaterThan(edgeWidth(thin, 1, o, 10))
    expect(edgeWidth(e, 4, null, 0)).toBeLessThan(edgeWidth({ ...e, qty: 4 }, 4, null, 0))
  })
})
