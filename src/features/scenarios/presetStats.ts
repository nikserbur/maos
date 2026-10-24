/**
 * Цифры пресетов (X2 «ответ — цифрой с единицей и словами»): что было тогда по истории ЦБ РФ
 * («тогда: ставка 8,5 → 20 %»), что даёт генератор сейчас («ставка 14 → 10,4 %»), пик и дно — только
 * если путь действительно уходит выше/ниже сегодняшней точки (иначе «пик» у падающего ряда = старт).
 * «Медиана путей» словами — «типичный исход». Чистые функции — vitest.
 */
import type { MacroLastObs, MacroRegimes, MacroSampleResult } from '../../lib/api'
import { NBSP, num } from '../../explain/format'
import { addMonths, monthRuns } from './monthText'

/** Нижняя граница ставки в путях генератора, % годовых — зеркало бэкенда (kKeyFloorPp), если сервер её не сообщил. */
export const KEY_FLOOR_PP = 4.25

type HistorySeries = 'key_pp' | 'cpi_yoy_pp' | 'usd_rub'
const THEN_SERIES: ReadonlyArray<{ k: HistorySeries; title: string; unit: string; digits: number }> = [
  { k: 'key_pp', title: 'ставка', unit: '%', digits: 2 },
  { k: 'cpi_yoy_pp', title: 'инфляция', unit: '%', digits: 1 },
  { k: 'usd_rub', title: 'доллар', unit: '₽', digits: 0 },
]

export interface ThenPart { title: string; from: number; to: number; unit: string; digits: number }

/** «Что было тогда»: от месяца перед окном до самого сильного отклонения внутри окна, по рядам. */
export function historyThenParts(history: MacroRegimes['history'] | undefined, window: { from: string; months: number } | undefined): ThenPart[] {
  if (!history || !window) return []
  const at = history.month.indexOf(window.from)
  if (at < 1) return []
  return THEN_SERIES.flatMap(({ k, title, unit, digits }) => {
    const s = history[k]
    const v0 = s[at - 1]
    const span = s.slice(at, at + window.months)
    if (!span.length || !Number.isFinite(v0)) return []
    const ext = span.reduce((a, v) => (Math.abs(v - v0) > Math.abs(a - v0) ? v : a), span[0])
    return [{ title, from: v0, to: ext, unit, digits }]
  })
}

const partText = (p: ThenPart): string => `${p.title} ${num(p.from, p.digits)} → ${num(p.to, p.digits)}${NBSP}${p.unit}`

/** «тогда: ставка 8,5 → 20 %, инфляция 8,7 → 17,8 %, доллар 78 → 51 ₽»; нет истории или окна — ''. */
export function historyThen(history: MacroRegimes['history'] | undefined, window: { from: string; months: number } | undefined): string {
  const parts = historyThenParts(history, window)
  return parts.length ? `тогда: ${parts.map(partText).join(', ')}` : ''
}

/** Ряд истории окна (с месяцем перед ним) — для мини-графика карточки пресета. */
export function historyWindow(history: MacroRegimes['history'] | undefined, window: { from: string; months: number } | undefined, k: HistorySeries): number[] {
  if (!history || !window) return []
  const at = history.month.indexOf(window.from)
  return at < 1 ? [] : history[k].slice(at - 1, at + window.months)
}

/** Месяцы кризисного режима истории словами: «дек. 2014 – февр. 2015, … , март 2023». */
export function crisisMonthsText(regimes: MacroRegimes | null): string {
  const r = regimes?.regimes[regimes.crisis_index]
  return r ? monthRuns(r.months) : ''
}

/** Последний допустимый месяц начала окна длиной `months` (история кончается last). */
export function lastWindowStart(last: string, months: number): string {
  return addMonths(last, -(Math.max(1, months) - 1))
}

export interface PathStat { start: number; end: number; lo: number; hi: number; peak: number; trough: number }
export type SampleStats = Record<'key' | 'fx' | 'cpi', PathStat>

const START_KEY: Record<keyof SampleStats, keyof MacroLastObs> = { key: 'key_pp', fx: 'usd_rub', cpi: 'cpi_yoy_pp' }

/** Итог путей генератора: старт (сегодня, ЦБ РФ), типичный исход к горизонту, «9 из 10 путей», пик и дно. */
export function sampleStats(r: MacroSampleResult): SampleStats {
  const one = (k: keyof SampleStats): PathStat => {
    const q = r.monthly[k]
    const last = q.p50.length - 1
    const start = Number(r.last_obs?.[START_KEY[k]])
    return { start: Number.isFinite(start) ? start : q.p50[0], end: q.p50[last], lo: q.p05[last], hi: q.p95[last], peak: Math.max(...q.p50), trough: Math.min(...q.p50) }
  }
  return { key: one('key'), fx: one('fx'), cpi: one('cpi') }
}

/** Порог «заметно»: 1 п. п. для ставки и инфляции, 5 % уровня — для курса. */
function margin(k: keyof SampleStats, s: PathStat): number {
  return k === 'fx' ? Math.abs(s.start) * 0.05 : 1
}

/**
 * Пик или дно типичного пути — только если он уходит заметно выше сегодняшнего значения и конца (пик)
 * или заметно ниже (дно); иначе null. У падающего ряда «пик» = старт — его не называем.
 */
export function pathExtreme(k: keyof SampleStats, s: PathStat): { word: 'пик' | 'дно'; value: number } | null {
  const m = margin(k, s)
  if (s.peak - Math.max(s.start, s.end) > m) return { word: 'пик', value: s.peak }
  if (Math.min(s.start, s.end) - s.trough > m) return { word: 'дно', value: s.trough }
  return null
}

/** @deprecated — `pathExtreme` (пик относительно старта, а не только конца). */
export function notablePeak(s: Pick<PathStat, 'peak' | 'end'> & Partial<PathStat>): number | null {
  const start = s.start ?? s.end
  return s.peak - Math.max(start, s.end) > Math.max(1, Math.abs(s.end) * 0.05) ? s.peak : null
}

export interface StatCell { k: keyof SampleStats; title: string; text: string; note: string }

const UNIT: Record<keyof SampleStats, { title: string; unit: string; digits: number }> = {
  key: { title: 'Ставка', unit: '%', digits: 1 },
  fx: { title: 'Доллар', unit: '₽', digits: 0 },
  cpi: { title: 'Инфляция', unit: '%', digits: 1 },
}

/** Три ячейки «Ставка 14 → 10,4 %» · «Доллар 84 → 96 ₽» · «Инфляция 6,4 → 5,6 %» (+ «пик 25 %» мелко). */
export function statCells(st: SampleStats): StatCell[] {
  return (['key', 'fx', 'cpi'] as const).map((k) => {
    const s = st[k]
    const u = UNIT[k]
    const ext = pathExtreme(k, s)
    return {
      k, title: u.title,
      text: `${num(s.start, u.digits)} → ${num(s.end, u.digits)}${NBSP}${u.unit}`,
      note: ext ? `${ext.word} ${num(ext.value, u.digits)}${NBSP}${u.unit}` : '',
    }
  })
}

/** Одна строка: «типичный исход через 12 мес: ставка 14 → 10,7 % (пик 25,4 %), доллар 84 → 75 ₽, инфляция 6,4 → 6 %». */
export function effectLine(st: SampleStats, months: number): string {
  const cells = statCells(st).map((c) => `${c.title.toLowerCase()} ${c.text}${c.note ? ` (${c.note})` : ''}`)
  return `типичный исход через ${num(months, 0)}${NBSP}мес: ${cells.join(', ')}`
}
