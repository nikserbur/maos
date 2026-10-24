/**
 * Чистые данные графиков «Аналитики»: ось «по построениям плана» (любой KPI из каталога)
 * или «внутри плана по часам» (ряды симуляции), окно периода. Хронология — линия (X2: время →
 * линия), подписи X — номера построений «№19» (дата — в подсказке). Пара «показатель + его хвост
 * CVaR» сливается в одну серию `--chart-1` с полосой хвоста (без второго цвета). Заголовок —
 * утверждение («… последние 5 — в пределах 380–420 ч»); ровный ряд схлопывается в строку-итог.
 * Без DOM — vitest.
 */
import type { KpiBundle, SimResults } from '../../lib/api'
import { dateTimeShort, hours, joinRange, num, pct, plural } from '../../explain/format'
import { kpiDef, kpiLabel } from './kpiCatalog'
import { kpiText } from './kpiFormat'
import { seriesColor, TIMELINE_METRICS, type AxisMode, type ChartType } from './dashboardConfig'

/** Полоса хвоста серии: от значения (E) до CVaR — тем же цветом, 14 %. */
export interface ChartBand { lo: number[]; hi: number[]; label: string }

/** Один ряд графика: значения выровнены с labels по индексу (NaN — разрыв). */
export interface ChartSeries {
  key: string
  name: string
  color: string
  fmtY: (v: number) => string
  points: number[]
  band?: ChartBand
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

/** Допустимый период для оси (из адреса может прийти мусор). */
export function normalizePeriod(axis: AxisMode, period: string | null | undefined): string {
  return periodOptions(axis).some((p) => p.id === period) ? (period as string) : defaultPeriod(axis)
}

/** Тип графика: обе оси — хронология, поэтому линия (столбцы для времени — X2 «форма по задаче»). */
export function chartKind(_axis: AxisMode): ChartType {
  return 'line'
}

/** Перечень имён метрик: «OTD», «OTD и загрузка», «A, B и C». */
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

export interface ChartData {
  labels: string[]
  series: ChartSeries[]
  /** Подсказка по индексу X: дата построения («24.10 14:38»). */
  tips: string[]
}

/** Номер построения → подпись оси «№19» (номер — из planSeqMap экрана, иначе позиция в ряду). */
export function planAxisLabel(b: KpiBundle, index: number, seqOf?: ReadonlyMap<string, number>): string {
  const seq = (b.plan_id && seqOf?.get(b.plan_id)) || index + 1
  return `№${num(seq, 0)}`
}

/** Данные графика для оси и набора метрик с учётом окна периода. */
export function buildChartData(
  axis: AxisMode,
  metrics: ReadonlyArray<string>,
  series: ReadonlyArray<KpiBundle>,
  res: SimResults | null,
  period = 'all',
  seqOf?: ReadonlyMap<string, number>,
): ChartData {
  if (axis === 'plans') return byPlans(metrics, series, period, seqOf)
  return byHours(metrics, res, period)
}

function byPlans(metrics: ReadonlyArray<string>, all: ReadonlyArray<KpiBundle>, period: string, seqOf?: ReadonlyMap<string, number>): ChartData {
  const win = sliceByPeriod(all.map((b, i) => ({ b, i })), period)
  const labels = win.map(({ b, i }) => planAxisLabel(b, i, seqOf))
  const tips = win.map(({ b }) => dateTimeShort(b.created_at))
  const bundles = win.map(({ b }) => b)
  // Хвост, выбранный вместе со своим показателем, не рисуется отдельной серией — он полоса показателя.
  const tails = new Set(metrics.map((c) => kpiDef(c)?.tail).filter((t): t is string => Boolean(t) && metrics.includes(t as string)))
  const rows: ChartSeries[] = []
  for (const code of metrics) {
    const def = kpiDef(code)
    if (!def || tails.has(code)) continue
    const points = bundles.map((b) => def.value(b))
    const tailDef = def.tail && metrics.includes(def.tail) ? kpiDef(def.tail) : undefined
    rows.push({
      key: code, name: tailDef ? kpiLabel(def) : def.name, color: seriesColor(rows.length),
      fmtY: (x: number) => kpiText(x, def.unit), points,
      band: tailDef ? { lo: points, hi: bundles.map((b) => tailDef.value(b)), label: 'хвост CVaR' } : undefined,
    })
  }
  return { labels, series: rows, tips }
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
  const labels = tSrc.map((p) => hours(p.t, 0))
  return { labels, series: built.map((s) => ({ ...s, points: s.points.slice(0, len) })), tips: labels }
}

/* ── Ровный ряд → строка-итог ─────────────────────────────────────────────── */

const finite = (xs: ReadonlyArray<number>): number[] => xs.filter(Number.isFinite)
const isConstant = (xs: ReadonlyArray<number>): boolean => {
  const f = finite(xs)
  if (f.length === 0) return true
  const tol = 1e-9 * Math.max(1, Math.abs(f[0]))
  return f.every((x) => Math.abs(x - f[0]) <= tol)
}

export interface FlatInfo {
  /** «OTD 100 % во всех 10 построениях». */
  text: string
  count: number
}

/** Все значения окна одинаковы (≥ 2 точек) — график из одинаковых точек не несёт информации. */
export function flatInfo(axis: AxisMode, data: ChartData): FlatInfo | null {
  const count = data.labels.length
  if (count < 2 || data.series.length === 0) return null
  const flat = data.series.every((s) => finite(s.points).length > 0 && isConstant(s.points) && (!s.band || isConstant(s.band.hi)))
  if (!flat) return null
  const parts = data.series.map((s) => {
    const v = finite(s.points)[0]
    const tail = s.band ? finite(s.band.hi)[0] : undefined
    return `${s.name} ${s.fmtY(v)}${tail !== undefined && tail !== v ? ` (хвост ${s.fmtY(tail)})` : ''}`
  })
  const where = axis === 'plans'
    ? `во всех ${num(count, 0)} ${plural(count, ['построении', 'построениях', 'построениях'])}`
    : 'на всём окне'
  return { text: `${parts.join(' · ')} ${where}`, count }
}

/** Чем заменить ровный показатель: метрика той же темы, которая обычно различает построения. */
const FLAT_SUGGEST: Readonly<Record<string, string>> = {
  OTD: 'FLOW', N_LATE: 'FLOW', TARD: 'FLOW', TARD_CVAR: 'FLOW', UTIL: 'BN_UTIL', BN_UTIL: 'WAIT', P_BREACH: 'CFAR', P_COVENANT: 'DSCR_MIN_P05',
}

export function flatSuggestion(metrics: ReadonlyArray<string>, exclude: ReadonlyArray<string> = []): string | null {
  const taken = new Set([...metrics, ...exclude])
  const first = metrics[0]
  const cand = [FLAT_SUGGEST[first], 'FLOW', 'MAKESPAN', 'WAIT'].filter((c): c is string => Boolean(c) && Boolean(kpiDef(c)))
  return cand.find((c) => !taken.has(c)) ?? null
}

/* ── Заголовок-утверждение ────────────────────────────────────────────────── */

const RECENT = 5

/**
 * «Длина расписания по построениям: последние 5 — в пределах 380–420 ч» · «Загрузка оборудования
 * по часам: пик 92 % на 48 ч». Без данных или с несколькими сериями — перечень имён.
 */
export function statementTitle(axis: AxisMode, data: ChartData, names: ReadonlyArray<string>): string {
  const plain = chartTitle(data.series.length ? data.series.map((x) => x.name) : names)
  if (data.series.length !== 1) return axis === 'plans' ? `${plain} по построениям` : `${plain} по часам`
  const s = data.series[0]
  if (axis === 'timeline') {
    let at = -1
    s.points.forEach((v, i) => { if (Number.isFinite(v) && (at < 0 || v > s.points[at])) at = i })
    return at < 0 ? `${plain} по часам` : `${plain} по часам: пик ${s.fmtY(s.points[at])} на ${data.labels[at]}`
  }
  const recent = finite(s.points.slice(-RECENT))
  if (recent.length === 0) return `${plain} по построениям`
  if (recent.length === 1) return `${plain}: одно построение — ${s.fmtY(recent[0])}`
  const lo = Math.min(...recent), hi = Math.max(...recent)
  const k = recent.length
  const range = lo === hi ? `все ${s.fmtY(lo)}` : `в пределах ${joinRange(s.fmtY(lo), s.fmtY(hi))}`
  return `${plain} по построениям: ${k === s.points.length ? 'все' : 'последние'} ${num(k, 0)} — ${range}`
}
