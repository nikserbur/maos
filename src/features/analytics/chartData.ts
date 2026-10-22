/**
 * Чистые данные графиков «Аналитики»: ось «по построениям плана» (любой KPI из каталога)
 * или «внутри плана по часам» (ряды симуляции), окно периода, заголовок = имена метрик,
 * тип графика — по форме данных (категории планов → столбцы, ряд по часам → линия). Без DOM — vitest.
 */
import type { KpiBundle, SimResults } from '../../lib/api'
import { hours, num, pct } from '../../explain/format'
import { kpiDef } from './kpiCatalog'
import { kpiText } from './kpiFormat'
import { seriesColor, TIMELINE_METRICS, type AxisMode, type ChartType } from './dashboardConfig'

/** Один ряд графика: значения выровнены с labels по индексу (NaN — разрыв). */
export interface ChartSeries {
  key: string
  name: string
  color: string
  fmtY: (v: number) => string
  points: number[]
}

export interface PeriodOption { id: string; label: string; title?: string }

/** Окно по построениям: последние N планов. */
export const PLAN_PERIODS: readonly PeriodOption[] = [
  { id: '10', label: '10 последних' },
  { id: '30', label: '30 последних' },
  { id: 'all', label: 'Все построения' },
]
/** Окно внутри плана: первые N часов от старта расписания. */
export const HOUR_PERIODS: readonly PeriodOption[] = [
  { id: '24', label: 'Первые 24 ч' },
  { id: '72', label: 'Первые 72 ч' },
  { id: 'all', label: 'Весь план' },
]

export function periodOptions(axis: AxisMode): readonly PeriodOption[] {
  return axis === 'plans' ? PLAN_PERIODS : HOUR_PERIODS
}

/** Период по умолчанию при смене оси (id из periodOptions). */
export function defaultPeriod(axis: AxisMode): string {
  return axis === 'plans' ? '10' : 'all'
}

/** Тип графика по форме данных: категории построений — столбцы, ряд по часам — линия. */
export function chartKind(axis: AxisMode): ChartType {
  return axis === 'plans' ? 'bar' : 'line'
}

/** Заголовок карточки = имена метрик: «OTD», «OTD и загрузка», «A, B и C». */
export function chartTitle(names: ReadonlyArray<string>): string {
  if (names.length === 0) return 'Метрика не выбрана'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}

/** Имя метрики по ключу для оси (каталог KPI или ряды симуляции). */
export function metricName(axis: AxisMode, key: string): string {
  if (axis === 'plans') return kpiDef(key)?.name ?? key
  return TIMELINE_METRICS.find((m) => m.key === key)?.name ?? key
}

/** Метрики, которые ещё можно добавить на ось. */
export function availableMetrics(axis: AxisMode, chosen: ReadonlyArray<string>, catalogCodes: ReadonlyArray<string>): Array<{ key: string; name: string }> {
  const keys = axis === 'plans' ? catalogCodes : TIMELINE_METRICS.map((m) => m.key)
  return keys.filter((k) => !chosen.includes(k)).map((k) => ({ key: k, name: metricName(axis, k) }))
}

/** «2026-10-22T18:35:12» → «10-22 18:35»; пусто → «—». */
export const shortDate = (s?: string): string => (s || '').slice(5, 16).replace('T', ' ') || '—'

/** Последние N построений (period = 'all' — все). */
export function sliceByPeriod<T>(series: ReadonlyArray<T>, period: string): T[] {
  const n = Number(period)
  if (!Number.isFinite(n) || n <= 0) return [...series]
  return series.slice(Math.max(0, series.length - n))
}

/** Значения KPI по построениям (для спарклайна героя); NaN там, где поля нет. */
export function kpiTrack(code: string, series: ReadonlyArray<KpiBundle>): number[] {
  const def = kpiDef(code)
  return def ? series.map((b) => def.value(b)) : []
}

export interface ChartData { labels: string[]; series: ChartSeries[] }

/** Данные графика для оси и набора метрик с учётом окна периода. */
export function buildChartData(
  axis: AxisMode,
  metrics: ReadonlyArray<string>,
  series: ReadonlyArray<KpiBundle>,
  res: SimResults | null,
  period = 'all',
): ChartData {
  if (axis === 'plans') return byPlans(metrics, sliceByPeriod(series, period))
  return byHours(metrics, res, period)
}

function byPlans(metrics: ReadonlyArray<string>, series: ReadonlyArray<KpiBundle>): ChartData {
  const labels = series.map((b, i) => (b.created_at ? shortDate(b.created_at) : `#${i + 1}`))
  const rows = metrics.map((code, mi): ChartSeries | null => {
    const def = kpiDef(code)
    if (!def) return null
    return {
      key: code, name: def.name, color: seriesColor(mi),
      fmtY: (x: number) => kpiText(x, def.unit), points: series.map((b) => def.value(b)),
    }
  })
  return { labels, series: rows.filter((s): s is ChartSeries => s !== null) }
}

function byHours(metrics: ReadonlyArray<string>, res: SimResults | null, period: string): ChartData {
  const utilS = res?.util_series ?? []
  const workS = res?.workers_series ?? []
  const limit = Number(period)
  const within = (t: number) => !Number.isFinite(limit) || limit <= 0 || t <= limit
  const util = utilS.filter((p) => within(p.t))
  const work = workS.filter((p) => within(p.t))
  const srcFor = (key: string): number[] =>
    key === 'util' ? util.map((p) => p.util) : key === 'workers' ? work.map((p) => p.workers) : []
  const built = metrics.map((key, mi): ChartSeries | null => {
    const tm = TIMELINE_METRICS.find((m) => m.key === key)
    if (!tm) return null
    return {
      key, name: tm.name, color: seriesColor(mi),
      fmtY: tm.pct ? (v: number) => pct(v, 0) : (v: number) => num(v, 0), points: srcFor(key),
    }
  }).filter((s): s is ChartSeries => s !== null)
  // Ряды сэмплированы синхронно; выравниваем по минимальной длине на всякий случай.
  const len = built.length ? Math.min(...built.map((s) => s.points.length)) : 0
  const tSrc = (util.length ? util : work).slice(0, len)
  return {
    labels: tSrc.map((p) => hours(p.t, 0)),
    series: built.map((s) => ({ ...s, points: s.points.slice(0, len) })),
  }
}
