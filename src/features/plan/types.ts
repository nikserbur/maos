/**
 * Локальные расширения типов API экрана «План» (поля, добавленные бэкендом в B1;
 * общий src/lib/api.ts правит интегратор — здесь только аддитивные optional-поля).
 */
import type {
  GanttJob, MrpMaterial, SchedKpi, SchedLoad, ScheduleResult,
} from '../../lib/api'

/** KPI расписания + новые поля §4.2 (знаменатель — Σ календарного фонда станков). */
export type PlanKpi = SchedKpi & {
  setup_share?: number
  availability?: number
  machine_fund_hours?: number
  orders_per_day?: number
}

/** Загрузка ресурса: фонд раскладывается на обработку + наладку + ТО/ремонт + простой. */
export type PlanLoad = SchedLoad & {
  setup_hours?: number
  downtime_hours?: number
  fund_hours?: number
}

/** Операция на Ганте: разложение занятости (обработка, наладка, ТО/ремонт), ч. */
export type PlanBar = GanttJob & {
  proc_hours?: number
  setup_hours?: number
  downtime_hours?: number
}

/** Материал MRP + цикл обработки партии запуска собственного изготовления (B14). */
export type PlanMaterial = MrpMaterial & { lot_cycle_hours?: number }

export const kpiOf = (r: ScheduleResult): PlanKpi => r.kpi as PlanKpi
export const loadsOf = (rows: readonly SchedLoad[]): readonly PlanLoad[] => rows as readonly PlanLoad[]
export const barsOf = (r: ScheduleResult): readonly PlanBar[] => r.gantt as readonly PlanBar[]
export const materialsOf = (rows: readonly MrpMaterial[]): readonly PlanMaterial[] => rows as readonly PlanMaterial[]

/** Σ фонда станков: kpi → calendar → сумма по станкам (старые сохранённые планы). */
export function machineFundHours(r: ScheduleResult): number | undefined {
  const k = kpiOf(r)
  if (typeof k.machine_fund_hours === 'number') return k.machine_fund_hours
  const cal = r.calendar as ScheduleResult['calendar'] & { machine_fund_hours?: number }
  if (typeof cal.machine_fund_hours === 'number') return cal.machine_fund_hours
  const rows = loadsOf(r.machine_load).filter((l) => typeof l.fund_hours === 'number')
  return rows.length ? rows.reduce((a, l) => a + (l.fund_hours ?? 0), 0) : undefined
}

/** Σ продуктивного времени станков (обработка без наладок и ТО). */
export function machineBusyHours(r: ScheduleResult): number {
  return r.machine_load.reduce((a, l) => a + (l.busy_hours || 0), 0)
}

/* ── Диспетчеризация и конструктор эвристики ─────────────────────────────── */

export const RULES = [
  { id: 'auto', label: 'Авто (лучшее)' }, { id: 'EDD', label: 'EDD — по сроку' },
  { id: 'SPT', label: 'SPT — короткие вперёд' }, { id: 'CR', label: 'CR — критическое отношение' },
  { id: 'MWKR', label: 'MWKR — больше работы' }, { id: 'MS', label: 'MS — мин. запас' },
  { id: 'LPT', label: 'LPT — длинные вперёд' }, { id: 'FIFO', label: 'FIFO' },
  { id: 'custom', label: 'Конструктор эвристики' },
] as const

export type CritKey = 'duration' | 'due' | 'rem' | 'inputs' | 'setup'

/** Критерий эвристики: [критерий, направление (±), вес]. */
export interface Crit { criterion: CritKey; dir: 1 | -1; weight: number }

export const CRITERIA: ReadonlyArray<{ id: CritKey; label: string }> = [
  { id: 'duration', label: 'длительность операции' },
  { id: 'due', label: 'срок заказа' },
  { id: 'rem', label: 'остаточная работа по цепочке' },
  { id: 'inputs', label: 'число входных материалов' },
  { id: 'setup', label: 'время наладки' },
]

export const CRIT_LABEL: Record<CritKey, string> = {
  duration: 'длительность', due: 'срок заказа', rem: 'остаточная работа', inputs: 'входные материалы', setup: 'наладка',
}

export const DEFAULT_CRITS: readonly Crit[] = [{ criterion: 'duration', dir: -1, weight: 1 }]

/** Статус/качество показателя: цвет --status-* + глиф (● ▲ ○ ■), никогда не цвет отдельно. */
export type Tone = 'good' | 'warn' | 'bad' | 'idle'
export const TONE_GLYPH: Record<Tone, string> = {
  good: 'glyph-running', warn: 'glyph-setup', bad: 'glyph-down', idle: 'glyph-idle',
}

/** Текст ошибки из unknown. */
export function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}
