/**
 * Единые форматтеры чисел интерфейса MAOS (ru-RU) — заменяют локальные копии
 * money()/pct() на экранах. Контракт: docs/AUDIT-2026-10.md §4.3.
 *
 * Соглашения:
 *  - разделитель групп разрядов — неразрывный пробел (Intl ru-RU), десятичный — запятая;
 *  - отрицательные числа — со знаком «минус» U+2212, а не дефисом;
 *  - число и единица разделяются неразрывным пробелом («12,3 %», «1,2 млн ₽»);
 *  - пустое/нечисловое значение (null, undefined, NaN, ±∞) → «—».
 */

/** Единицы измерения реестра метрик. `%` — значение передаётся ДОЛЕЙ (0,934 → «93,4 %»). */
export type Unit =
  | 'ч'
  | 'мин'
  | 'мес'
  | '%'
  | '₽'
  | '₽/мес'
  | 'ед.'
  | 'ед./сут'
  | 'шт'
  | 'заказов'
  | 'заказ/сут'
  | 'чел.'
  | 'нед'
  | '—'

/** Значение для подстановки: число, готовая строка или «нет данных». */
export type FormatInput = number | string | null | undefined

export const DASH = '—'
export const MINUS = '−'
export const NBSP = ' '

const formatters = new Map<string, Intl.NumberFormat>()

function nf(maxFractionDigits: number): Intl.NumberFormat {
  const key = String(maxFractionDigits)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })
    formatters.set(key, f)
  }
  return f
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Число знаков после запятой по величине: ≥100 → 0, ≥10 → 1, иначе 2. */
function adaptiveDigits(abs: number): number {
  if (abs >= 100) return 0
  if (abs >= 10) return 1
  return 2
}

function roundTo(abs: number, digits: number): number {
  const p = 10 ** digits
  return Math.round(abs * p) / p
}

/** Модуль числа строкой и признак «после округления это ноль» (тогда знак не ставится). */
function absText(v: number, digits: number): { text: string; zero: boolean } {
  const abs = Math.abs(v)
  return { text: nf(digits).format(abs), zero: roundTo(abs, digits) === 0 }
}

function withSign(v: number, digits: number): string {
  const { text, zero } = absText(v, digits)
  return v < 0 && !zero ? MINUS + text : text
}

/** Число с группировкой разрядов; `digits` — максимум знаков после запятой (по умолчанию — по величине). */
export function num(v: number | null | undefined, digits?: number): string {
  if (!isNum(v)) return DASH
  return withSign(v, digits ?? adaptiveDigits(Math.abs(v)))
}

/** Доля → проценты: pct(0.934) = «93,4 %». */
export function pct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return DASH
  return `${withSign(v * 100, digits)}${NBSP}%`
}

/** Часы: hours(1123.44) = «1 123,4 ч». */
export function hours(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return DASH
  return `${withSign(v, digits)}${NBSP}ч`
}

const MONEY_TIERS = [
  { factor: 1, suffix: '' },
  { factor: 1e3, suffix: 'тыс.' },
  { factor: 1e6, suffix: 'млн' },
  { factor: 1e9, suffix: 'млрд' },
] as const

export interface MoneyOptions {
  /** Сокращать до тыс./млн/млрд (по умолчанию да, ~3 значащие цифры). */
  compact?: boolean
}

/** Рубли: money(1234567) = «1,23 млн ₽»; money(1234567, { compact: false }) = «1 234 567 ₽». */
export function money(v: number | null | undefined, opts: MoneyOptions = {}): string {
  if (!isNum(v)) return DASH
  const compact = opts.compact ?? true
  if (!compact) return `${withSign(v, 0)}${NBSP}₽`

  const abs = Math.abs(v)
  let tier = MONEY_TIERS.length - 1
  while (tier > 0 && abs < MONEY_TIERS[tier].factor) tier--
  let scaled = abs / MONEY_TIERS[tier].factor
  let digits = adaptiveDigits(scaled)
  // 999 960 → «1000 тыс.» недопустимо: при округлении до 1000 переходим на следующий порядок.
  if (tier < MONEY_TIERS.length - 1 && roundTo(scaled, digits) >= 1000) {
    tier++
    scaled = abs / MONEY_TIERS[tier].factor
    digits = adaptiveDigits(scaled)
  }
  const { text, zero } = absText(scaled, digits)
  const sign = v < 0 && !zero ? MINUS : ''
  const suffix = MONEY_TIERS[tier].suffix
  return `${sign}${text}${NBSP}${suffix ? suffix + NBSP : ''}₽`
}

/** Склонение «заказ»: 1 заказ, 3 заказа, 5 заказов; дробное число → «заказа» (3,4 заказа). */
function ordersWord(v: number, digits: number): string {
  const r = roundTo(Math.abs(v), digits)
  if (!Number.isInteger(r)) return 'заказа'
  const n10 = r % 10, n100 = r % 100
  if (n10 === 1 && n100 !== 11) return 'заказ'
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'заказа'
  return 'заказов'
}

/** Значение с единицей. Строки возвращаются как есть (готовый текст, имя РЦ и т. п.). */
export function fmtValue(value: FormatInput, unit?: Unit): string {
  if (value === null || value === undefined) return DASH
  if (typeof value === 'string') return value.trim() === '' ? DASH : value
  if (!isNum(value)) return DASH
  switch (unit) {
    case 'ч': return hours(value)
    case 'мин': return `${num(value, 0)}${NBSP}мин`
    case 'мес': return `${num(value, 1)}${NBSP}мес`
    case 'нед': return `${num(value, 1)}${NBSP}нед`
    case '%': return pct(value)
    case '₽': return money(value)
    case '₽/мес': return `${money(value)}/мес`
    case 'шт': return `${num(value, 1)}${NBSP}шт`
    case 'заказов': {
      const digits = 1
      return `${num(value, digits)}${NBSP}${ordersWord(value, digits)}`
    }
    case 'ед.':
    case 'ед./сут':
    case 'заказ/сут':
    case 'чел.':
      return `${num(value)}${NBSP}${unit}`
    case '—':
    case undefined:
      return num(value)
  }
}

/** Со знаком: signed(0.12, '%') = «+12 %», signed(−1.5e6, '₽') = «−1,5 млн ₽»; ноль без знака. */
export function signed(value: number | null | undefined, unit: Unit = '—'): string {
  if (!isNum(value)) return DASH
  const text = fmtValue(Math.abs(value), unit)
  if (/^0([,\s ]|$)/.test(text) && !/[1-9]/.test(text)) return text
  return (value < 0 ? MINUS : '+') + text
}

/* ── Подстановка живых значений в формулу ─────────────────────────────────── */

/** Плейсхолдер формулы: `{key}`, key — латиница, цифры, «_». */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g

export interface FormulaVariable {
  key: string
  unit?: Unit
}

export type FormulaPart =
  | { kind: 'text'; text: string }
  | { kind: 'value'; key: string; text: string; known: boolean }

/** Ключи всех плейсхолдеров формулы в порядке появления (с повторами). */
export function placeholders(formula: string): string[] {
  return Array.from(formula.matchAll(PLACEHOLDER), (m) => m[1])
}

/** Формула, разбитая на текст и подставленные значения (для подсветки значений в UI). */
export function bindFormulaParts(
  formula: string,
  values?: Readonly<Record<string, FormatInput>>,
  variables: readonly FormulaVariable[] = [],
): FormulaPart[] {
  const unitOf = new Map(variables.map((v) => [v.key, v.unit]))
  const parts: FormulaPart[] = []
  let last = 0
  for (const m of formula.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: formula.slice(last, at) })
    const key = m[1]
    const raw = values?.[key]
    const text = fmtValue(raw, unitOf.get(key))
    parts.push({ kind: 'value', key, text, known: text !== DASH })
    last = at + m[0].length
  }
  if (last < formula.length) parts.push({ kind: 'text', text: formula.slice(last) })
  return parts
}

/** Формула с подставленными значениями; неизвестные/пустые → «—». */
export function bindFormula(
  formula: string,
  values?: Readonly<Record<string, FormatInput>>,
  variables: readonly FormulaVariable[] = [],
): string {
  return bindFormulaParts(formula, values, variables).map((p) => p.text).join('')
}
