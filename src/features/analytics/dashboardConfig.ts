import { api } from '../../lib/api'

/** Типы визуализации настраиваемого графика. */
export type ChartType = 'line' | 'area' | 'bar'
/** Ось X: «по построениям плана» (любой KPI) или «внутри плана по часам» (2 ряда). */
export type AxisMode = 'plans' | 'timeline'

/**
 * Метрики оси «внутри плана»: единственные временные ряды, что даёт симуляция
 * (загрузка оборудования и число занятых операторов во времени 0..Cmax).
 */
export const TIMELINE_METRICS = [
  { key: 'util', name: 'Загрузка оборудования', pct: true, info: 'sim.avg_utilization' },
  { key: 'workers', name: 'Занятые операторы', pct: false, info: 'sim.required_operators' },
] as const

export interface ChartConfig {
  type: ChartType
  axis: AxisMode
  /** axis='plans' → коды KPI из KPI_CATALOG; axis='timeline' → ключи TIMELINE_METRICS. */
  metrics: string[]
}
export interface DashboardConfig {
  /** Коды KPI, закреплённые плитками вверху (первый — герой-плитка). */
  pinned: string[]
  /** Ровно два настраиваемых графика. */
  charts: [ChartConfig, ChartConfig]
}

/**
 * Набор по умолчанию: герой — длина расписания с хвостом; вместо средней загрузки (величина без
 * отклонения) — число просроченных заказов. Второй график — просрочка с хвостом CVaR: OTD у
 * хорошего плана — ровные 100 % и ничего не рассказывает.
 */
export const DEFAULT_DASHBOARD: DashboardConfig = {
  pinned: ['MAKESPAN', 'OTD', 'N_LATE', 'THRU', 'BN_UTIL', 'COST'],
  charts: [
    { type: 'line', axis: 'plans', metrics: ['MAKESPAN', 'MK_CVAR'] },
    { type: 'line', axis: 'plans', metrics: ['TARD', 'TARD_CVAR'] },
  ],
}

/** Второй график по умолчанию для оси (при смене оси). */
export const SECOND_DEFAULT: Readonly<Record<AxisMode, string[]>> = {
  plans: ['TARD', 'TARD_CVAR'],
  timeline: ['workers'],
}

/**
 * Палитра серий — токены графиков (--chart-1…7, проверены на CVD и контраст в
 * обеих темах); 8-й слот («прочее») рядам не выдаётся. var() работает и в SVG fill/stroke.
 */
export const SERIES_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)',
] as const

export const seriesColor = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length]

const KEY = 'analytics.dashboard'

function normalizeChart(c: Partial<ChartConfig> | undefined, fallback: ChartConfig): ChartConfig {
  if (!c || typeof c !== 'object') return fallback
  const type: ChartType = c.type === 'area' || c.type === 'bar' ? c.type : 'line'
  const axis: AxisMode = c.axis === 'timeline' ? 'timeline' : 'plans'
  const metrics = Array.isArray(c.metrics) && c.metrics.length
    ? c.metrics.filter((m): m is string => typeof m === 'string')
    : fallback.metrics
  return { type, axis, metrics: metrics.length ? metrics : fallback.metrics }
}

/** Приведение произвольного сохранённого значения к валидному конфигу (защита от мусора в БД). */
export function normalizeDashboard(v: Partial<DashboardConfig> | null | undefined): DashboardConfig {
  if (!v || typeof v !== 'object') return DEFAULT_DASHBOARD
  const pinned = Array.isArray(v.pinned)
    ? v.pinned.filter((s): s is string => typeof s === 'string')
    : DEFAULT_DASHBOARD.pinned
  const charts = Array.isArray(v.charts) ? v.charts : []
  return {
    pinned,
    charts: [
      normalizeChart(charts[0], DEFAULT_DASHBOARD.charts[0]),
      normalizeChart(charts[1], DEFAULT_DASHBOARD.charts[1]),
    ],
  }
}

export interface LoadedDashboard {
  config: DashboardConfig
  /** Текст ошибки, если сохранённый набор прочитать не удалось (показан дефолт). */
  error: string | null
}

/** Загрузка конфига дашборда из БД проекта; при сбое — дефолт и текст ошибки для UI. */
export async function loadDashboard(): Promise<LoadedDashboard> {
  try {
    return { config: normalizeDashboard(await api.prefs.get<DashboardConfig>(KEY)), error: null }
  } catch (e) {
    return { config: DEFAULT_DASHBOARD, error: e instanceof Error ? e.message : 'нет связи с сервером' }
  }
}

/** Сохранение конфига в БД проекта. Возвращает null или текст ошибки (UI покажет «не сохранено»). */
export async function saveDashboard(cfg: DashboardConfig): Promise<string | null> {
  try {
    await api.prefs.set(KEY, cfg)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'нет связи с сервером'
  }
}
