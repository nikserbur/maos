/**
 * Схема ↔ план (X2 P-27): загрузка станков, цехов и заводов по последнему построенному плану.
 * Источник — последний KpiBundle (`/analytics/kpi_series`), иначе результат «Плана» этой сессии.
 * Загрузка станка — по станку (machine_load), если есть, иначе по его типу оборудования;
 * у цеха/завода — максимум по станкам; узкое место — тип оборудования из KPI плана.
 * Чистые функции: хук useSceneOps только подаёт данные.
 */
import { countText, dateTimeShort, num, pct } from '../../explain/format'
import type { KpiBundle, Machine, ScheduleResult } from '../../lib/api'
import type { SceneGraph } from './graph/sceneModel'

/** Порог перегрузки: выше — ▲ «перегрузка» (метка на шкале Meter). */
export const OVERLOAD = 0.85

interface LoadRow { wc_type_id?: string; wc_name?: string; machine_id?: string; utilization: number }
interface QueueRow { wc_type_id?: string; peak?: number }

export interface OpsSource {
  planId: string | null
  /** Порядковый номер плана в истории KPI (№28); null — неизвестен. */
  seq: number | null
  createdAt: string | number | null
  wcLoad: ReadonlyArray<LoadRow>
  machineLoad: ReadonlyArray<LoadRow>
  queueByWc: ReadonlyArray<QueueRow>
  bottleneck: { wcTypeId: string; name: string; util: number } | null
}

export interface NodeOps {
  /** Загрузка 0…1 (у цеха/завода — максимум по станкам); null — не рассчитано. */
  util: number | null
  /** Откуда загрузка станка: по станку или по его типу оборудования. */
  utilBy: 'machine' | 'type' | null
  /** Пик очереди, партий (максимум по типам оборудования); null — не рассчитано. */
  queuePeak: number | null
  bottleneck: boolean
  overloaded: boolean
  /** Станков в ТО / ремонте (у станка — 0 или 1). */
  maintenance: number
  /** Станков внутри (у станка — 1). */
  machines: number
}

export interface SceneOps {
  source: OpsSource | null
  byNode: ReadonlyMap<string, NodeOps>
  /** Станков в ТО / ремонте на всей схеме. */
  maintenance: number
}

type KpiWithMachines = KpiBundle & { machine_load?: ReadonlyArray<LoadRow> }

function bottleneckOf(b: { wc_type_id?: string; wc_name?: string; utilization?: number } | undefined | null): OpsSource['bottleneck'] {
  if (!b?.wc_type_id || typeof b.utilization !== 'number') return null
  return { wcTypeId: b.wc_type_id, name: b.wc_name || 'тип оборудования', util: b.utilization }
}

/** Последний план из истории KPI (ряд — по возрастанию времени); №N — позиция в истории. */
export function opsFromKpiSeries(series: ReadonlyArray<KpiBundle>): OpsSource | null {
  if (series.length === 0) return null
  const b = series[series.length - 1] as KpiWithMachines
  return {
    planId: b.plan_id, seq: series.length, createdAt: b.created_at ?? null,
    wcLoad: b.wc_load ?? [], machineLoad: b.machine_load ?? [], queueByWc: b.queue_by_wc ?? [],
    bottleneck: bottleneckOf(b.bottleneck),
  }
}

/** Результат «Плана» этой сессии (до записи в историю или при недоступной истории). */
export function opsFromSchedule(r: ScheduleResult, builtAt: number | null, seq: number | null = null): OpsSource {
  return {
    planId: r.plan_id ?? null, seq, createdAt: builtAt,
    wcLoad: r.wc_load ?? [], machineLoad: r.machine_load ?? [], queueByWc: r.queue_by_wc ?? [],
    bottleneck: bottleneckOf(r.bottleneck),
  }
}

/** Источник: последний KpiBundle; результат «Плана» — запасной и уточняет загрузку по станкам того же плана. */
export function pickOpsSource(series: ReadonlyArray<KpiBundle> | null, plan: ScheduleResult | null, builtAt: number | null): OpsSource | null {
  const latest = series ? opsFromKpiSeries(series) : null
  if (!plan) return latest
  if (!latest) return opsFromSchedule(plan, builtAt)
  if (plan.plan_id && plan.plan_id === latest.planId && latest.machineLoad.length === 0)
    return { ...latest, machineLoad: plan.machine_load ?? [] }
  return latest
}

const EMPTY: NodeOps = { util: null, utilBy: null, queuePeak: null, bottleneck: false, overloaded: false, maintenance: 0, machines: 0 }

const maxOf = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b))

/** Загрузка всех узлов схемы по источнику (станки → цеха → заводы). */
export function buildSceneOps(graph: SceneGraph, machines: ReadonlyArray<Machine>, src: OpsSource | null): SceneOps {
  const typeOf = new Map(machines.map((m) => [m.id, m.wc_type_id]))
  const byMachine = new Map((src?.machineLoad ?? []).filter((r) => r.machine_id).map((r) => [r.machine_id as string, r.utilization]))
  const byType = new Map((src?.wcLoad ?? []).filter((r) => r.wc_type_id).map((r) => [r.wc_type_id as string, r.utilization]))
  const queueByType = new Map((src?.queueByWc ?? []).filter((r) => r.wc_type_id && typeof r.peak === 'number').map((r) => [r.wc_type_id as string, r.peak as number]))
  const out = new Map<string, NodeOps>()

  const leafOps = (id: string, inMaintenance: boolean): NodeOps => {
    const type = typeOf.get(id) ?? ''
    const own = byMachine.get(id)
    const util = typeof own === 'number' ? own : byType.get(type) ?? null
    return {
      util, utilBy: typeof own === 'number' ? 'machine' : util === null ? null : 'type',
      queuePeak: queueByType.get(type) ?? null,
      bottleneck: !!src?.bottleneck && type !== '' && type === src.bottleneck.wcTypeId,
      overloaded: util !== null && util >= OVERLOAD,
      maintenance: inMaintenance ? 1 : 0, machines: 1,
    }
  }

  const children = new Map<string, string[]>()
  for (const n of graph.nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id])
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  const visit = (id: string, seen: Set<string>): NodeOps => {
    const known = out.get(id)
    if (known) return known
    const node = byId.get(id)
    if (!node) return EMPTY
    let ops: NodeOps
    if (node.refType === 'machine') {
      ops = leafOps(id, node.status === 'setup')
    } else {
      ops = { ...EMPTY }
      for (const kid of children.get(id) ?? []) {
        if (seen.has(kid)) continue
        const k = visit(kid, new Set([...seen, kid]))
        ops = {
          util: maxOf(ops.util, k.util), utilBy: k.utilBy ?? ops.utilBy, queuePeak: maxOf(ops.queuePeak, k.queuePeak),
          bottleneck: ops.bottleneck || k.bottleneck, overloaded: false,
          maintenance: ops.maintenance + k.maintenance, machines: ops.machines + k.machines,
        }
      }
      ops = { ...ops, overloaded: ops.util !== null && ops.util >= OVERLOAD }
    }
    out.set(id, ops)
    return ops
  }
  for (const n of graph.nodes) visit(n.id, new Set([n.id]))
  const maintenance = graph.nodes.filter((n) => n.refType === 'machine' && n.status === 'setup').length
  return { source: src, byNode: out, maintenance }
}

/* ── Подписи (только format.ts) ──────────────────────────────────────────── */

/** «План №28» (без номера — «План»). */
export function planTitle(src: OpsSource): string {
  return src.seq !== null ? `План №${num(src.seq, 0)}` : 'План'
}

/** «план №28 от 24.10 14:38». */
export function planRef(src: OpsSource): string {
  const head = src.seq !== null ? `план №${num(src.seq, 0)}` : 'последний план'
  const when = src.createdAt !== null ? dateTimeShort(src.createdAt) : ''
  return when && when !== '—' ? `${head} от ${when}` : head
}

/** Переход к прогону в «Плане». */
export function planHref(src: OpsSource): string {
  return src.planId ? `#/plan/run/${encodeURIComponent(src.planId)}` : '#/plan'
}

/** «Резьбонарезной 94 %». */
export function bottleneckText(src: OpsSource): string | null {
  return src.bottleneck ? `${src.bottleneck.name} ${pct(src.bottleneck.util, 0)}` : null
}

/** Загрузка «94 %» или «не рассчитано». */
export function utilText(util: number | null): string {
  return util === null ? 'не рассчитано' : pct(util, 0)
}

export const BATCH_FORMS = ['партия', 'партии', 'партий'] as const

/** Очередь «пик 6 партий»; null — не рассчитано. */
export function queueText(peak: number | null): string | null {
  return peak === null ? null : `пик ${countText(Math.round(peak), BATCH_FORMS)}`
}
