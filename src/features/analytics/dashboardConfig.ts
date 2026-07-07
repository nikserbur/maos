import { api } from '../../lib/api'

/** Типы визуализации настраиваемого графика. */
export type ChartType = 'line' | 'area' | 'bar'
/** Ось X: «по построениям плана» (любой KPI) или «внутри плана по часам» (2 ряда). */
export type AxisMode = 'plans' | 'timeline'

/**
 * Метрики оси «внутри плана»: единственные временные ряды, что даёт симуляция
 * (загрузка оборудования и число занятых операторов во времени 0..makespan).
 */
export const TIMELINE_METRICS = [
  { key: 'util', name: 'Загрузка оборудования', pct: true },
  { key: 'workers', name: 'Занятые операторы', pct: false },
] as const

export interface ChartConfig {
  type: ChartType
  axis: AxisMode
  /** axis='plans' → коды KPI из KPI_CATALOG; axis='timeline' → ключи TIMELINE_METRICS. */
  metrics: string[]
}
export interface DashboardConfig {
  /** Коды KPI, закреплённые карточками вверху. */
  pinned: string[]
  /** Ровно два настраиваемых графика. */
  charts: [ChartConfig, ChartConfig]
}

export const DEFAULT_DASHBOARD: DashboardConfig = {
  pinned: ['MAKESPAN', 'OTD', 'UTIL', 'THRU', 'BN_UTIL', 'COST'],
  charts: [
    { type: 'line', axis: 'plans', metrics: ['MAKESPAN'] },
    { type: 'area', axis: 'plans', metrics: ['OTD'] },
  ],
}

/** Палитра серий (детерминированно по индексу метрики в графике). */
export const SERIES_COLORS = [
  'var(--accent)', 'var(--intent-warning)', 'var(--intent-success)',
  'var(--intent-danger)', '#8b5cf6', '#22d3ee',
] as const

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

/** Загрузка конфига дашборда из БД проекта (best-effort → дефолт при ошибке). */
export async function loadDashboard(): Promise<DashboardConfig> {
  try {
    return normalizeDashboard(await api.prefs.get<DashboardConfig>(KEY))
  } catch {
    return DEFAULT_DASHBOARD
  }
}

/** Сохранение конфига в БД проекта (best-effort — молча игнорируем сбой сети). */
export async function saveDashboard(cfg: DashboardConfig): Promise<void> {
  try { await api.prefs.set(KEY, cfg) } catch { /* автосейв не критичен */ }
}
