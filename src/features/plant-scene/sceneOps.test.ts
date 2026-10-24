import { describe, expect, it } from 'vitest'
import { buildSceneOps, opsFromKpiSeries, pickOpsSource, planRef, planTitle, queueText } from './sceneOps'
import type { SceneGraph, SceneNode } from './graph/sceneModel'
import type { KpiBundle, Machine, ScheduleResult } from '../../lib/api'

const node = (id: string, parentId: string | null, refType: SceneNode['refType'], status: SceneNode['status'] = 'running'): SceneNode => ({
  id, parentId, refType, kind: 'marketing', title: id, subtitle: '', position: [0, 0], scale: 1, status, kpis: [],
})
const machine = (id: string, wc: string): Machine => ({ id, wc_type_id: wc } as Machine)

const graph: SceneGraph = {
  nodes: [
    node('factory:f', null, 'factory'),
    node('shop:a', 'factory:f', 'shop'),
    node('shop:b', 'factory:f', 'shop'),
    node('m1', 'shop:a', 'machine'),
    node('m2', 'shop:a', 'machine', 'setup'),
    node('m3', 'shop:b', 'machine'),
  ],
  edges: [],
}
const machines = [machine('m1', 'thread'), machine('m2', 'lathe'), machine('m3', 'lathe')]

const bundle = (id: string, extra: Partial<KpiBundle> = {}): KpiBundle => ({
  plan_id: id, created_at: '2026-10-24 11:38:00', kpi: {},
  wc_load: [{ wc_type_id: 'thread', wc_name: 'Резьбонарезной', utilization: 0.94, busy_hours: 0, idle_hours: 0 },
            { wc_type_id: 'lathe', wc_name: 'Токарный', utilization: 0.4, busy_hours: 0, idle_hours: 0 }],
  bottleneck: { wc_type_id: 'thread', wc_name: 'Резьбонарезной', utilization: 0.94 },
  queue_by_wc: [{ wc_type_id: 'thread', peak: 6 }, { wc_type_id: 'lathe', peak: 2 }],
  ...extra,
})

describe('загрузка схемы по плану', () => {
  it('последний план истории — источник; №N — позиция в истории', () => {
    const src = opsFromKpiSeries([bundle('p1'), bundle('p2')])
    expect(src?.planId).toBe('p2')
    expect(src && planTitle(src)).toBe('План №2')
    expect(src && planRef(src)).toMatch(/^план №2 от \d\d\.\d\d \d\d:\d\d$/)
  })

  it('станок берёт загрузку типа, цех и завод — максимум; узкое место поднимается вверх', () => {
    const ops = buildSceneOps(graph, machines, opsFromKpiSeries([bundle('p1')]))
    expect(ops.byNode.get('m1')).toMatchObject({ util: 0.94, utilBy: 'type', bottleneck: true, overloaded: true, queuePeak: 6 })
    expect(ops.byNode.get('m3')).toMatchObject({ util: 0.4, bottleneck: false, overloaded: false })
    expect(ops.byNode.get('shop:a')).toMatchObject({ util: 0.94, bottleneck: true, maintenance: 1, machines: 2 })
    expect(ops.byNode.get('shop:b')).toMatchObject({ util: 0.4, bottleneck: false, maintenance: 0 })
    expect(ops.byNode.get('factory:f')).toMatchObject({ util: 0.94, machines: 3, maintenance: 1 })
    expect(ops.maintenance).toBe(1)
  })

  it('без плана — «не рассчитано» (null), а не ноль; ТО всё равно считается', () => {
    const ops = buildSceneOps(graph, machines, null)
    expect(ops.byNode.get('shop:a')).toMatchObject({ util: null, queuePeak: null, maintenance: 1 })
  })

  it('результат «Плана» того же плана уточняет загрузку по станкам; без истории — запасной источник', () => {
    const plan = { plan_id: 'p1', machine_load: [{ machine_id: 'm3', utilization: 0.9, busy_hours: 0, idle_hours: 0 }], wc_load: [], queue_by_wc: [],
      bottleneck: { wc_type_id: 'lathe', wc_name: 'Токарный', utilization: 0.9 } } as unknown as ScheduleResult
    const merged = pickOpsSource([bundle('p1')], plan, 1)
    expect(buildSceneOps(graph, machines, merged).byNode.get('m3')).toMatchObject({ util: 0.9, utilBy: 'machine', overloaded: true })
    const fallback = pickOpsSource(null, plan, 1)
    expect(fallback?.planId).toBe('p1')
    expect(fallback && planTitle(fallback)).toBe('План')
  })

  it('очередь словами с числом', () => {
    expect(queueText(6)).toBe('пик 6\u00a0партий')
    expect(queueText(1)).toBe('пик 1\u00a0партия')
    expect(queueText(null)).toBeNull()
  })
})
