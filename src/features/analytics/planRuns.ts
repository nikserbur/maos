/**
 * Построения плана в «Аналитике»: один порядковый номер на всё приложение экрана («План №28»),
 * подписи выбора («№28 · E 419 ч · 618 оп · 24.10 14:38») и база сравнения (предыдущее построение).
 * Номер — по времени создания (старое = №1) по объединению списка планов (/simulation/plans,
 * последние 40) и ряда KPI (/analytics/kpi_series, все с KPI): F5 и смена окна номер не меняют.
 * Без DOM — vitest.
 */
import type { KpiBundle, SimPlanSummary } from '../../lib/api'
import { NBSP, dateTimeShort, hours, num, runLabel } from '../../explain/format'

export interface PlanRef {
  id: string
  seq: number
  createdAt: string
  nTasks: number
  /** E[Cmax] из KPI построения (NaN — у плана нет KPI). */
  makespanMean: number
  /** Детерминированная длина из списка планов (запасной вариант подписи). */
  makespanDet: number
}

interface Stamp { id: string; createdAt: string }

/** Порядковые номера построений: старое — №1; при равном времени — порядок записи в БД. */
export function planSeqMap(plans: ReadonlyArray<SimPlanSummary>, series: ReadonlyArray<KpiBundle>): Map<string, number> {
  const seen = new Set<string>()
  const stamps: Stamp[] = []
  const add = (id: string | null | undefined, createdAt: string | undefined) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    stamps.push({ id, createdAt: createdAt ?? '' })
  }
  for (const b of series) add(b.plan_id, b.created_at)
  // Список планов — по убыванию rowid: разворачиваем, чтобы равные отметки шли в порядке записи.
  for (const p of [...plans].reverse()) add(p.id, p.created_at)
  const ordered = [...stamps].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return new Map(ordered.map((s, i) => [s.id, i + 1]))
}

const field = (b: KpiBundle | undefined, f: string): number => {
  const v = b?.kpi?.[f]
  return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
}

/** Построения для выбора — новые сверху, с номером и E[Cmax] из ряда KPI. */
export function planRefs(plans: ReadonlyArray<SimPlanSummary>, series: ReadonlyArray<KpiBundle>): PlanRef[] {
  const seq = planSeqMap(plans, series)
  const byId = new Map(series.filter((b) => b.plan_id).map((b) => [b.plan_id as string, b]))
  return plans
    .map((p) => {
      const b = byId.get(p.id)
      return {
        id: p.id, seq: seq.get(p.id) ?? 0, createdAt: p.created_at,
        nTasks: Number(p.n_tasks) || 0,
        makespanMean: field(b, 'makespan_mean') > 0 ? field(b, 'makespan_mean') : Number.NaN,
        makespanDet: Number(p.makespan) || 0,
      }
    })
    .sort((a, b) => b.seq - a.seq)
}

/** «План №28». */
export function planTitle(seq: number | null | undefined): string {
  return runLabel({ seq: seq && seq > 0 ? seq : null })
}

/** «№28». */
export function planNo(seq: number | null | undefined): string {
  return seq && seq > 0 ? `№${num(seq, 0)}` : '№?'
}

/** «№28 · E 419 ч · 618 оп · 24.10 14:38» — подпись построения в списке выбора. */
export function planOptionLabel(p: PlanRef): string {
  const mk = Number.isFinite(p.makespanMean)
    ? `E${NBSP}${hours(p.makespanMean, 0)}`
    : `дет.${NBSP}${hours(p.makespanDet, 0)}`
  return [planNo(p.seq), mk, `${num(p.nTasks, 0)}${NBSP}оп`, dateTimeShort(p.createdAt)].join(' · ')
}

/** Предыдущее построение (номер на 1 меньше среди доступных); нет — null. */
export function previousPlan(refs: ReadonlyArray<PlanRef>, id: string): PlanRef | null {
  const cur = refs.find((r) => r.id === id)
  if (!cur) return null
  const older = refs.filter((r) => r.seq < cur.seq).sort((a, b) => b.seq - a.seq)
  return older[0] ?? null
}
