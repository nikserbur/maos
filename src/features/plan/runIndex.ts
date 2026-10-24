/**
 * Индекс прогонов Стадии 1 (X2 «один прогон — один номер и одно время везде»): бэкенд хранит планы
 * (`GET /api/simulation/plans`, новые первыми) и их KPI (`GET /api/analytics/kpi_series`, в порядке
 * построения). Номер прогона №N — позиция в ряду KPI (1 — первый построенный), время — created_at
 * сервера (UTC без зоны, разбирает format.ts). Один модульный кэш на экран, историю, шапку и мастер;
 * после нового прогона — `refreshRunIndex()`. Состояния загрузки/ошибки различаются (X2 «честные состояния»).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, type KpiBundle, type SimPlanSummary } from '../../lib/api'

export interface RunRow {
  id: string
  /** Номер прогона (№28); null — у прогона нет KPI в ряду (старый план). */
  seq: number | null
  createdAt: string
  nTasks: number
  makespan: number
  kpi: KpiBundle | null
}

export interface RunIndexState {
  rows: RunRow[] | null
  loading: boolean
  error: unknown
}

/** Слияние списка планов и ряда KPI: номер — позиция в ряду KPI; KPI-only прогоны ряда тоже попадают в список. */
export function mergeRuns(plans: readonly SimPlanSummary[], series: readonly KpiBundle[]): RunRow[] {
  const seqOf = new Map<string, number>()
  const byId = new Map<string, KpiBundle>()
  series.forEach((b, i) => {
    if (!b.plan_id) return
    seqOf.set(b.plan_id, i + 1)
    byId.set(b.plan_id, b)
  })
  const rows: RunRow[] = plans.map((p) => ({
    id: p.id, seq: seqOf.get(p.id) ?? null, createdAt: p.created_at,
    nTasks: Number(p.n_tasks) || 0, makespan: Number(p.makespan) || 0, kpi: byId.get(p.id) ?? null,
  }))
  const known = new Set(rows.map((r) => r.id))
  for (const b of series) {
    if (!b.plan_id || known.has(b.plan_id)) continue
    rows.push({ id: b.plan_id, seq: seqOf.get(b.plan_id) ?? null, createdAt: b.created_at ?? '', nTasks: 0, makespan: Number(b.kpi?.makespan) || 0, kpi: b })
  }
  return rows.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || b.createdAt.localeCompare(a.createdAt))
}

/** Число из ряда KPI или NaN («не рассчитано», не ноль). */
export const kpiOf = (b: KpiBundle | null | undefined, f: string): number => (b && typeof b.kpi?.[f] === 'number' ? b.kpi[f] : Number.NaN)

let state: RunIndexState = { rows: null, loading: false, error: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function commit(next: RunIndexState): void {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): RunIndexState => state

/** Перечитать индекс (после нового прогона); параллельные вызовы сливаются в один запрос. */
export function refreshRunIndex(): Promise<void> {
  if (inflight) return inflight
  commit({ ...state, loading: true })
  inflight = Promise.all([api.simulation.plans(), api.analytics.kpiSeries().catch(() => [] as KpiBundle[])])
    .then(([plans, series]) => commit({ rows: mergeRuns(plans, series), loading: false, error: null }))
    .catch((e: unknown) => commit({ ...state, loading: false, error: e }))
    .finally(() => { inflight = null })
  return inflight
}

/** Индекс прогонов; первый подписчик запускает загрузку. */
export function useRunIndex(): RunIndexState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (state.rows === null && !state.loading && state.error === null) void refreshRunIndex()
  }, [])
  return s
}

export function findRun(rows: readonly RunRow[] | null, id: string | null | undefined): RunRow | undefined {
  return id && rows ? rows.find((r) => r.id === id) : undefined
}

/** Только для тестов. */
export function resetRunIndex(): void {
  inflight = null
  state = { rows: null, loading: false, error: null }
}
