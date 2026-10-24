/**
 * Модель симуляции (чистые функции): строки прогонов (план + KPI), часы модельного времени в
 * календаре плана («24.10 · смена 2 · 14:00»), состояние объекта в момент t (занятость, очередь,
 * текущая операция). Числа и даты — только через src/explain/format.ts.
 */
import type { KpiBundle, SimPlanSummary, SimTaskDto } from '../../lib/api'
import { dateTimeShort, hours, num, time } from '../../explain/format'

export interface SimRun {
  id: string
  createdAt: string
  nTasks: number
  makespan: number
  /** OTD из KPI прогона (NaN — KPI нет). */
  otd: number
  /** Средняя загрузка из KPI прогона (NaN — KPI нет). */
  utilization: number
}

/** «22.10 18:55» из строки бэкенда (UTC → местное); нечитаемая дата — «—». */
export function fmtRunDate(s: string): string {
  return dateTimeShort(s)
}

const kpiOf = (b: KpiBundle | undefined, key: string): number =>
  b && typeof b.kpi?.[key] === 'number' ? b.kpi[key] : Number.NaN

/** Планы (новые сверху, как отдаёт бэкенд) + KPI по plan_id. */
export function mergeRuns(plans: ReadonlyArray<SimPlanSummary>, series: ReadonlyArray<KpiBundle>): SimRun[] {
  const byId = new Map(series.filter((b) => b.plan_id).map((b) => [b.plan_id as string, b]))
  return plans.map((p) => {
    const b = byId.get(p.id)
    return {
      id: p.id, createdAt: p.created_at,
      nTasks: Number(p.n_tasks) || 0, makespan: Number(p.makespan) || 0,
      otd: kpiOf(b, 'otd'), utilization: kpiOf(b, 'utilization'),
    }
  })
}

/** Горизонт плана: «61 ч (2,5 дн)». */
export function fmtHorizon(makespanH: number): string {
  return `${hours(makespanH, 0)} (${num(makespanH / 24, 1)} дн)`
}

/** Смена по часу суток: 6–14 — первая, 14–22 — вторая, 22–6 — третья. */
export function shiftOf(hour: number): 1 | 2 | 3 {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  return h >= 6 && h < 14 ? 1 : h >= 14 && h < 22 ? 2 : 3
}

const HOUR_MS = 3_600_000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/** Начало плана в мс: дата календаря — местная полночь, отметка сервера без зоны — UTC (как в format.ts). */
export function planStartMs(startAt: string | number | null): number {
  if (startAt === null) return Number.NaN
  if (typeof startAt === 'number') return startAt
  const s = startAt.trim()
  const d = DATE_ONLY.exec(s)
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).getTime()
  return new Date(ZONELESS.test(s) ? `${s.replace(' ', 'T')}Z` : s).getTime()
}

/**
 * Часы симуляции в календаре плана: начало плана + t ч → «24.10 · смена 2 · 14:00».
 * Без даты начала — «день 2 · 14:00» от начала горизонта.
 */
export function fmtSimClock(startAt: string | number | null, tHours: number): string {
  const start = planStartMs(startAt)
  if (!Number.isFinite(start)) {
    const total = Math.max(0, Math.floor(tHours))
    return `день ${num(Math.floor(total / 24) + 1, 0)} · ${String(total % 24).padStart(2, '0')}:00`
  }
  const at = new Date(Math.floor((start + tHours * HOUR_MS) / HOUR_MS) * HOUR_MS)
  const day = dateTimeShort(at).split(' ')[0]
  return `${day} · смена ${shiftOf(at.getHours())} · ${time(at)}`
}

export interface NodeSimStats {
  /** Доля занятости станков объекта с начала горизонта до t (0…1). */
  busyShare: number
  /** Партий ждут станок (готовы к операции, но не начаты). */
  queue: number
  /** Текущая операция (у цеха — первая из идущих). */
  current: SimTaskDto | null
  /** Сколько операций идёт сейчас. */
  active: number
}

/**
 * Состояние объекта (станок или цех — набор станков) в момент t: занятость с начала горизонта,
 * очередь (предыдущая операция заказа закончилась, эта ещё не началась), текущая операция.
 */
export function nodeSimStats(tasks: ReadonlyArray<SimTaskDto>, machineIds: ReadonlySet<string>, t: number): NodeSimStats {
  const prevEnd = new Map<SimTaskDto, number>()
  const byOrder = new Map<number, SimTaskDto[]>()
  for (const task of tasks) {
    const list = byOrder.get(task.order_idx)
    if (list) list.push(task)   // локальный накопитель: O(n) на тысячах задач (тик 4 Гц)
    else byOrder.set(task.order_idx, [task])
  }
  byOrder.forEach((arr) => {
    const sorted = [...arr].sort((a, b) => a.start - b.start)
    sorted.forEach((task, i) => prevEnd.set(task, i === 0 ? task.start : sorted[i - 1].end))
  })
  let busy = 0
  let queue = 0
  let active = 0
  let current: SimTaskDto | null = null
  for (const task of tasks) {
    if (!machineIds.has(task.machine_id)) continue
    busy += Math.max(0, Math.min(task.end, t) - task.start)
    if (task.start <= t && t < task.end) { active++; current ??= task }
    const ready = prevEnd.get(task)
    if (ready !== undefined && ready <= t && t < task.start) queue++
  }
  const capacity = Math.max(1, machineIds.size) * Math.max(t, 1e-9)
  return { busyShare: t > 0 ? Math.min(1, busy / capacity) : 0, queue, current, active }
}
