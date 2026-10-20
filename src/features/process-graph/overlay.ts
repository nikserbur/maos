/**
 * Наложение последнего плана Стадии 1 на граф: загрузка типов РЦ и узкое место —
 * из KPI-блока плана (GET /api/analytics/kpi, тот же kpi_json, что видит «Аналитика»),
 * плановые часы операций — из ленты задач того же плана (GET /api/simulation/plan).
 */
import type { KpiBundle, SimPlan } from '../../lib/api'
import type { GraphEdge, PlanOverlay, WcLoad } from './types'

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export function buildOverlay(kpi: KpiBundle, plan: SimPlan | null): PlanOverlay | null {
  if (!kpi.plan_id) return null
  const wcLoad = new Map<string, WcLoad>()
  for (const r of kpi.wc_load ?? []) {
    if (!r.wc_type_id) continue
    wcLoad.set(r.wc_type_id, {
      name: r.wc_name ?? r.wc_type_id,
      utilization: finite(r.utilization),
      busyHours: finite(r.busy_hours),
      idleHours: finite(r.idle_hours),
    })
  }
  const bn = kpi.bottleneck
  const bottleneck = bn?.wc_type_id
    ? { wcTypeId: bn.wc_type_id, name: bn.wc_name ?? bn.wc_type_id, utilization: finite(bn.utilization) }
    : null
  const queuePeak = new Map<string, number>()
  for (const q of kpi.queue_by_wc ?? []) if (q.wc_type_id) queuePeak.set(q.wc_type_id, finite(q.peak))

  const opHours = new Map<string, number>()
  const opTasks = new Map<string, number>()
  const orders = new Map<string, Set<number>>()
  // Лента задач берётся только того же плана, иначе бейджи смешали бы два расчёта.
  const tasks = plan && plan.plan_id === kpi.plan_id ? plan.tasks : []
  for (const t of tasks) {
    if (!t.op_id) continue
    const h = Math.max(0, finite(t.end) - finite(t.start))
    opHours.set(t.op_id, (opHours.get(t.op_id) ?? 0) + h)
    opTasks.set(t.op_id, (opTasks.get(t.op_id) ?? 0) + 1)
    if (t.product_id) {
      const s = orders.get(t.product_id) ?? new Set<number>()
      s.add(t.order_idx)
      orders.set(t.product_id, s)
    }
  }
  const productOrders = new Map<string, number>()
  for (const [pid, s] of orders) productOrders.set(pid, s.size)

  const kpiNums: Record<string, number> = {}
  for (const [k, v] of Object.entries(kpi.kpi ?? {})) if (typeof v === 'number' && Number.isFinite(v)) kpiNums[k] = v
  return {
    planId: kpi.plan_id,
    createdAt: kpi.created_at ?? '',
    makespan: finite(plan && plan.plan_id === kpi.plan_id ? plan.makespan : kpiNums.makespan),
    wcLoad,
    bottleneck,
    queuePeak,
    opHours,
    opTasks,
    productOrders,
    kpi: kpiNums,
  }
}

/** Плановый объём ребра = Σ плановых часов операций, через которые идёт поток. */
export function edgeVolume(edge: GraphEdge, overlay: PlanOverlay | null): number {
  if (!overlay) return 0
  let s = 0
  for (const oid of edge.opIds) s += overlay.opHours.get(oid) ?? 0
  return s
}

/** Загрузка ведущего типа РЦ операции (доля 0…1) или null. */
export function wcUtilization(wcTypeId: string | null, overlay: PlanOverlay | null): number | null {
  if (!wcTypeId || !overlay) return null
  const r = overlay.wcLoad.get(wcTypeId)
  return r ? r.utilization : null
}

export function isBottleneck(wcTypeId: string | null, overlay: PlanOverlay | null): boolean {
  return Boolean(wcTypeId && overlay?.bottleneck && overlay.bottleneck.wcTypeId === wcTypeId)
}

/** Толщина ребра: база по норме расхода, с планом — по плановому объёму (√-шкала). */
export function edgeWidth(edge: GraphEdge, maxQty: number, overlay: PlanOverlay | null, maxVolume: number): number {
  if (overlay && maxVolume > 0) return 1.25 + 4.5 * Math.sqrt(edgeVolume(edge, overlay) / maxVolume)
  if (edge.kind === 'input' && edge.qty !== null && maxQty > 0) return 1.25 + 2.25 * Math.sqrt(Math.min(1, edge.qty / maxQty))
  return 1.5
}
