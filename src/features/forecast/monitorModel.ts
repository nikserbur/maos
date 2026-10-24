/**
 * Модель экрана «Мониторинг» (владелец: «невзрачно»; X2 «сначала ответ», «честные состояния»):
 *  - один словарь важности сигнала: ✕ требует решения · ▲ внимание · ○ не рассчитано · ◆ к сведению;
 *  - деловой статус экрана по сигналам ✕ ▲ ◆ («Внимание: сырьё дорожает до +44 %») отдельно от полноты
 *    данных («○ Не рассчитано: касса»): нехватка данных не перекрывает содержательные сигналы;
 *  - вердикт одной фразой простыми словами (сбыт, сырьё, вывод для маржи, ставка) и строка доверия;
 *  - календарные месяцы от последнего наблюдения ЦБ («к марту 2027», «сент. 2026» — словарь Сценариев);
 *  - защита от «половинчатого» веера (`usableFan`): ошибка генератора не роняет экран;
 *  - сводное движение цен по роли (медиана Δ по позициям, типичная полоса 8 из 10, индекс медианы).
 * Чистые функции — vitest. Числа — только через src/explain/format.ts.
 */
import type { ForecastProduct, ForecastResult } from '../../lib/api'
import { NBSP, num, pct, plural, pp, rangeText } from '../../explain/format'
import { addMonths, monthShort } from '../scenarios/monthText'
import { median, nowValue, qualitySummary, reliabilityText, signedPct } from './forecastModel'

/* ── Важность сигнала ─────────────────────────────────────────────────────── */

export type Severity = 'crit' | 'warn' | 'missing' | 'info'
export type MonitorLevel = Severity | 'ok'

export interface SeverityEntry { glyph: '✕' | '▲' | '○' | '◆' | '●'; word: string; rank: number }

/** Один словарь: глиф + слово; цвет — только у ✕ и ▲ (на глифе и полосе карточки). */
export const SEVERITY: Readonly<Record<MonitorLevel, SeverityEntry>> = {
  crit: { glyph: '✕', word: 'требует решения', rank: 0 },
  warn: { glyph: '▲', word: 'внимание', rank: 1 },
  missing: { glyph: '○', word: 'не рассчитано', rank: 2 },
  info: { glyph: '◆', word: 'к сведению', rank: 3 },
  ok: { glyph: '●', word: 'в пределах порогов', rank: 4 },
}

/** Понизить важность на ступень (ненадёжный сигнал): ✕ → ▲ → ◆. */
export function downgrade(s: Severity): Severity {
  return s === 'crit' ? 'warn' : s === 'warn' ? 'info' : s
}

/** Сигнал глазами статуса: важность, заголовок и короткая формулировка. */
export interface StatusSignal { severity: Severity; title: string; short?: string }

export interface MonitorStatus {
  /** Деловой статус — только по сигналам ✕ ▲ ◆; «не рассчитано» — в `missing`. */
  level: 'crit' | 'warn' | 'ok'
  /** «Требует решения» · «Внимание» · «В пределах порогов». */
  title: string
  /** Главный сигнал коротко: «сырьё дорожает до +44 %»; null — тревог нет. */
  lead: string | null
  /** Ещё тревог (✕ и ▲) кроме главной. */
  more: number
  /** Сигналов «к сведению». */
  info: number
  /** Чего не хватает: короткие формулировки сигналов ○ («касса», «план»). */
  missing: readonly string[]
}

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

/**
 * Статус экрана по сигналам (они уже отсортированы по важности и влиянию): худшая тревога словами,
 * а не голым числом; полнота данных — отдельно и не перекрывает ✕ ▲. Без тревог, но с пропусками —
 * «в пределах порогов по рассчитанному», а не ложное «всё в норме».
 */
export function monitorStatus(signals: ReadonlyArray<StatusSignal>): MonitorStatus {
  const alarms = signals.filter((x) => x.severity === 'crit' || x.severity === 'warn')
  const missing = signals.filter((x) => x.severity === 'missing').map((x) => x.short ?? lowerFirst(x.title))
  const info = signals.filter((x) => x.severity === 'info').length
  const top = alarms.find((x) => x.severity === 'crit') ?? alarms[0]
  if (top) {
    const level = top.severity === 'crit' ? 'crit' : 'warn'
    return { level, title: level === 'crit' ? 'Требует решения' : 'Внимание', lead: top.short ?? lowerFirst(top.title), more: alarms.length - 1, info, missing }
  }
  return { level: 'ok', title: missing.length ? 'В пределах порогов по рассчитанному' : 'В пределах порогов', lead: null, more: 0, info, missing }
}

/* ── Календарь от последнего наблюдения ЦБ ────────────────────────────────── */

const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'] as const
const MONTH_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'] as const

function ymParts(ym: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '')
  const month = m ? Number(m[2]) - 1 : -1
  return m && month >= 0 && month < 12 ? { year: Number(m[1]), month } : null
}

/** «сентябрь 2026» — для строк происхождения («данные ЦБ по сентябрь 2026»). */
export function monthName(ym: string | null | undefined): string {
  const p = ymParts(ym)
  return p ? `${MONTH_NOM[p.month]}${NBSP}${p.year}` : ''
}

/** Срок горизонта словами: «к марту 2027»; без опоры — «за 6 мес». */
export function horizonBy(anchor: string | null | undefined, months: number): string {
  const p = ymParts(anchor ? addMonths(anchor, months) : '')
  return p ? `к ${MONTH_DAT[p.month]} ${p.year}` : `за ${num(months, 0)}${NBSP}мес`
}

/** Подписи оси веера в календарных месяцах от опоры: «сейчас · сент. 2026», «март 2027». */
export function calendarLabel(anchor: string | null | undefined): (offset: number) => string {
  return (o) => {
    const m = anchor ? monthShort(addMonths(anchor, o)) : ''
    if (o === 0) return m ? `сейчас · ${m}` : 'сейчас'
    return m || (o > 0 ? `+${o}${NBSP}мес` : `−${-o}${NBSP}мес`)
  }
}

/* ── Веер: годен ли к показу ──────────────────────────────────────────────── */

const filled = (a: unknown): a is number[] => Array.isArray(a) && a.length > 0

/**
 * Веер можно рисовать: квантили есть, одной длины, без `error`. Бэкенд при сбое генератора отдаёт
 * `rate = {id, role, error}` без квантилей — такой ряд считается недоступным, а не роняет экран.
 */
export function usableFan(p: ForecastProduct | null | undefined): p is ForecastProduct {
  if (!p || typeof p !== 'object') return false
  if (fanError(p)) return false
  return filled(p.p50) && filled(p.p10) && filled(p.p90) && p.p10.length === p.p50.length && p.p90.length === p.p50.length
}

/** Текст ошибки ряда (сырой — только для «Подробнее»). */
export function fanError(p: unknown): string | null {
  if (!p || typeof p !== 'object' || !('error' in p)) return null
  const e = (p as { error?: unknown }).error
  return typeof e === 'string' && e.trim() ? e : e ? String(e) : null
}

/** Ответ прогноза с пригодными веерами: негодная ставка → null (+ текст ошибки отдельно). */
export function normalizeForecast(res: ForecastResult | null): { res: ForecastResult | null; rateError: string | null } {
  if (!res) return { res: null, rateError: null }
  const rate = usableFan(res.rate) ? res.rate : null
  const rateError = rate ? null : fanError(res.rate) ?? (res.macro && !res.macro.available ? res.macro.error || null : null)
  const products = Array.isArray(res.products) ? res.products.filter(usableFan) : []
  return { res: { ...res, rate, products }, rateError }
}

/* ── Фаза прогноза на экране ──────────────────────────────────────────────── */

export type ForecastPhase = 'pending' | 'failed' | 'ready'

/**
 * Скелет — только пока ответа нет и он действительно ожидается (X2 «честные состояния»): ошибка без
 * данных — «не рассчитано» с «Повторить», а не вечная загрузка.
 */
export function forecastPhase(s: { hasResult: boolean; loading: boolean; error: unknown; waiting: boolean; refsReady: boolean }): ForecastPhase {
  if (s.hasResult) return 'ready'
  if (s.loading || s.waiting) return 'pending'
  if (s.error !== null && s.error !== undefined) return 'failed'
  return s.refsReady ? 'failed' : 'pending'
}

/* ── Сводное движение цен по роли ─────────────────────────────────────────── */

export interface PriceMove {
  n: number
  /** Медиана по позициям изменения медианы к горизонту (доля). */
  median: number
  /** Типичная полоса «8 из 10 исходов»: медианы по позициям P10 и P90 к «сейчас». */
  lo: number
  hi: number
  /** Индекс медианы «сейчас = 100» по месяцам (медиана по позициям). */
  index: number[]
}

export function priceMove(products: readonly ForecastProduct[], role: 'product' | 'raw'): PriceMove | null {
  const rows = products.filter((p) => p.role === role && usableFan(p)).flatMap((p) => {
    const now = nowValue(p)
    const last = p.p50.length - 1
    if (!(now > 0) || !Number.isFinite(p.p50[last])) return []
    return [{ d: p.p50[last] / now - 1, lo: p.p10[last] / now - 1, hi: p.p90[last] / now - 1, idx: p.p50.map((v) => (v / now) * 100) }]
  })
  if (rows.length === 0) return null
  const len = Math.min(...rows.map((r) => r.idx.length))
  const index = Array.from({ length: len }, (_, t) => median(rows.map((r) => r.idx[t])) ?? 100)
  return {
    n: rows.length,
    median: median(rows.map((r) => r.d)) ?? 0,
    lo: median(rows.map((r) => r.lo)) ?? 0,
    hi: median(rows.map((r) => r.hi)) ?? 0,
    index,
  }
}

/** Полоса не исключает обратного знака: P10 и P90 по разные стороны от «сейчас» — сигнал движения ненадёжен. */
export function bandSpansNow(p: ForecastProduct): boolean {
  const now = nowValue(p)
  const last = p.p50.length - 1
  return now > 0 && p.p10[last] < now && p.p90[last] > now
}

/* ── Вердикт и строка доверия ─────────────────────────────────────────────── */

/** Порог «почти без изменений» для цен и для разрыва «сбыт − сырьё». */
const FLAT_MOVE = 0.005
const FLAT_GAP = 0.01

function moveClause(what: string, m: PriceMove | null): string | null {
  if (!m) return null
  return Math.abs(m.median) < FLAT_MOVE ? `${what} почти без изменений` : `${what} ${moveText(m.median)}`
}

/** Вывод для маржи из разрыва медиан роста: сбыт обгоняет сырьё — маржа скорее растёт. */
function marginClause(goods: PriceMove | null, raw: PriceMove | null): string | null {
  if (!goods || !raw) return null
  const gap = goods.median - raw.median
  if (Math.abs(gap) < FLAT_GAP) return 'цены идут вровень, маржа почти не меняется'
  const by = pp(Math.abs(gap), { digits: Math.abs(gap) >= 0.1 ? 0 : 1 })
  return gap > 0 ? `сбыт обгоняет сырьё на ~${by}, маржа скорее растёт` : `сырьё обгоняет сбыт на ~${by}, маржа под давлением`
}

function rateClause(rate: ForecastProduct | null | undefined, narrow: boolean): string | null {
  if (!usableFan(rate)) return null
  const t = rate.p50.length - 1
  return `ставка ЦБ — около ${pct(rate.p50[t] / 100, 1)} (8 из 10 исходов: ${rangeText(rate.p10[t] / 100, rate.p90[t] / 100, '%')}${narrow ? ', полоса занижена' : ''})`
}

export interface HeadlineInput {
  res: Pick<ForecastResult, 'products' | 'rate'>
  /** «к марту 2027». */
  by: string
  /** Имя условий «что если» («Как 2022») — тогда «в условиях …», а не «прогноз». */
  stress?: string | null
  /** Проверка генератора: полоса ставки узковата — приписать «полоса занижена». */
  rateNarrow?: boolean
}

/**
 * «К марту 2027 цены сбыта +7,6 %, сырьё +5 % — сбыт обгоняет сырьё на ~2,6 п. п., маржа скорее растёт;
 * ставка ЦБ — около 13,5 % (8 из 10 исходов: 11,4–18,1 %).»
 */
export function headlineText({ res, by, stress, rateNarrow = false }: HeadlineInput): string {
  const goods = priceMove(res.products, 'product')
  const raw = priceMove(res.products, 'raw')
  const prices = [moveClause('цены сбыта', goods), moveClause('сырьё', raw)].filter((c): c is string => Boolean(c))
  const margin = marginClause(goods, raw)
  const rate = rateClause(res.rate, rateNarrow)
  if (prices.length === 0 && !rate) return 'Прогноз рассчитан, но рядов цен и ставки в нём нет.'
  const lead = stress ? `В условиях «${stress}» ${by}` : `${by.charAt(0).toUpperCase()}${by.slice(1)}`
  const pricePart = prices.length ? `${prices.join(', ')}${margin ? ` — ${margin}` : ''}` : ''
  return `${lead} ${[pricePart, rate].filter(Boolean).join('; ')}.`
}

/** «Надёжность прогноза цен: надёжен 25 · осторожно 39 · ненадёжен 12 из 76 позиций · проверка на 6 скрытых месяцах». */
export function trustText(products: readonly ForecastProduct[]): string {
  const s = qualitySummary(products)
  if (s.total === 0) return 'Качество прогноза цен не проверено: истории для проверки нет'
  const k = s.backtestK
  const of = plural(products.length, ['позиции', 'позиций', 'позиций'])
  return `Надёжность прогноза цен: ${reliabilityText(products)} ${of} · проверка на ${num(k, 0)} ${plural(k, ['скрытом месяце', 'скрытых месяцах', 'скрытых месяцах'])}`
}

/**
 * Диапазон изменения со знаком у обеих границ и одной единицей: «от −15 до +70 %»; точность — как у
 * значения плитки. Пробелы неразрывные: диапазон не рвётся посередине.
 */
export function signedRangeText(lo: number, hi: number, digits: number): string {
  const s = (v: number) => {
    const t = num(v * 100, digits)
    return v > 0 && /[1-9]/.test(t) ? `+${t}` : t
  }
  return `от${NBSP}${s(Math.min(lo, hi))}${NBSP}до${NBSP}${s(Math.max(lo, hi))}${NBSP}%`
}

/** Точность изменения цены: целые от 10 %, иначе один знак (как `moveText`). */
export const moveDigits = (v: number): number => (Math.abs(v) >= 0.1 ? 0 : 1)

/** «+7,6 %» — Δ с одним знаком после запятой до 10 %. */
export const moveText = (v: number): string => signedPct(v, Math.abs(v) >= 0.1 ? 0 : 1)

/** Ряды цен (без ставки) — «Все 76 рядов цен». */
export const PRICE_SERIES = ['ряд цен', 'ряда цен', 'рядов цен'] as const
