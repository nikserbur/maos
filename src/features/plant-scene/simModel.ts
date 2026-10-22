/**
 * Модель панели симуляции: строки прогонов (план + KPI), форматирование дат/длительностей
 * — только через src/explain/format.ts (X1 §10 2.7).
 */
import type { KpiBundle, SimPlanSummary } from '../../lib/api'
import { hours, num } from '../../explain/format'

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

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** «22.10 18:55» из строки бэкенда («2026-10-22 18:55:01»); нечитаемая дата — как есть. */
export function fmtRunDate(s: string): string {
  const d = new Date(s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? s : DATE_FMT.format(d)
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

/** Модельное время: «день 2 · 06:00». */
export function fmtClock(tHours: number): { day: string; time: string } {
  const total = Math.floor(tHours)
  const day = Math.floor(total / 24)
  const hour = total % 24
  return { day: num(day, 0), time: `${String(hour).padStart(2, '0')}:00` }
}
