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
export type Unit = 'ч' | 'мин' | 'мес' | '%' | '₽' | '₽/мес' | 'ед.' | 'ед./сут' | 'шт' | 'заказов' | 'заказ/сут' | 'чел.' | 'нед' | '—'

/** Ключ единицы → слова в интерфейсе (владелец: «сокращения — нечитаемо»): «111 единиц в сутки», а не «ед./сут». */
const UNIT_WORDS: Partial<Record<Unit, { forms: PluralForms; tail?: string }>> = {
  'ед.': { forms: ['единица', 'единицы', 'единиц'] }, 'ед./сут': { forms: ['единица', 'единицы', 'единиц'], tail: 'в сутки' },
  'заказ/сут': { forms: ['заказ', 'заказа', 'заказов'], tail: 'в сутки' }, 'чел.': { forms: ['человек', 'человека', 'человек'] },
}
/** Строка num() обратно в число: «1 234,5» → 1234.5, «−3» → −3. */
const parseNum = (t: string): number => Number(t.replace(/[\s ]/g, '').replace(',', '.').replace(MINUS, '-'))

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

export const MONEY_TIERS = [
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
    case 'ед.': case 'ед./сут': case 'заказ/сут': case 'чел.': {
      const w = UNIT_WORDS[unit], text = num(value)
      return `${text}${NBSP}${w ? `${plural(parseNum(text), w.forms)}${w.tail ? ` ${w.tail}` : ''}` : unit}`
    }
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

/* ── Дата и время ─────────────────────────────────────────────────────────── */
const DT_FULL = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const DT_DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' })
const DT_DM = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
const DT_TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** «ГГГГ-ММ-ДД ЧЧ:ММ[:СС[.мс]]» без зоны — так отдаёт сервер (SQLite datetime('now') = UTC). */
const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

function toDate(v: string | number | Date): Date {
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(v)
  const s = v.trim()
  // Серверные отметки времени без зоны — это UTC: дописываем «Z», показываем в местном времени.
  return new Date(ZONELESS.test(s) ? `${s.replace(' ', 'T')}Z` : s)
}

type DateInput = string | number | Date | null | undefined

function validDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = toDate(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Дата и время по-русски: dateTime('2026-10-22 18:35:10') = «22.10.2026, 21:35» (UTC → местное); пусто/мусор → «—». */
export function dateTime(v: DateInput, opts: { time?: boolean } = {}): string {
  const d = validDate(v)
  if (!d) return DASH
  return (opts.time ?? true ? DT_FULL : DT_DATE).format(d)
}

/** Время «17:38» (местное). */
export function time(v: DateInput): string {
  const d = validDate(v)
  return d ? DT_TIME.format(d) : DASH
}

/** Коротко: «24.10 17:38» в текущем году, иначе «24.10.2025 17:38». */
export function dateTimeShort(v: DateInput, now: Date = new Date()): string {
  const d = validDate(v)
  if (!d) return DASH
  const day = d.getFullYear() === now.getFullYear() ? DT_DM.format(d) : DT_DATE.format(d)
  return `${day} ${DT_TIME.format(d)}`
}

/* ── Склонение и счётчики ─────────────────────────────────────────────────── */

export type PluralForms = readonly [one: string, few: string, many: string]

/** Форма слова по числу: plural(1, ['запись','записи','записей']) = «запись»; 2 → «записи», 5/11 → «записей», 21 → «запись». */
export function plural(n: number, forms: PluralForms): string
export function plural(n: number, one: string, few: string, many: string): string
export function plural(n: number, a: PluralForms | string, few?: string, many?: string): string {
  const [f1, f2, f5] = typeof a === 'string' ? [a, few ?? a, many ?? a] : a
  const abs = Math.abs(n)
  if (!Number.isInteger(abs)) return f2
  const n10 = abs % 10, n100 = abs % 100
  if (n10 === 1 && n100 !== 11) return f1
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return f2
  return f5
}

/** Число со словом: countText(24, ['запись','записи','записей']) = «24 записи». */
export function countText(n: number, forms: PluralForms): string {
  return `${num(n, 0)}${NBSP}${plural(n, forms)}`
}

/* ── Диапазоны, пункты, частоты ───────────────────────────────────────────── */

/** «12,3 тыс. ₽» → ["12,3", "тыс. ₽"]; «−5 %» → ["−5", "%"]; без единицы — ["…", ""]. */
function splitNumUnit(text: string): [string, string] {
  const m = /^([−+]?[\d\s ,]*\d)(?:[\s ](.+))?$/u.exec(text)
  return m ? [m[1], m[2] ?? ''] : [text, '']
}

/** Деньги двух концов в одном порядке (тыс./млн/млрд — по большему по модулю). */
function moneyPair(lo: number, hi: number): [string, string, string] {
  const big = Math.max(Math.abs(lo), Math.abs(hi))
  let tier = MONEY_TIERS.length - 1
  while (tier > 0 && big < MONEY_TIERS[tier].factor) tier--
  if (tier < MONEY_TIERS.length - 1 && roundTo(big / MONEY_TIERS[tier].factor, adaptiveDigits(big / MONEY_TIERS[tier].factor)) >= 1000) tier++
  const f = MONEY_TIERS[tier].factor
  const one = (v: number) => withSign(v / f, adaptiveDigits(Math.abs(v / f)))
  const suffix = MONEY_TIERS[tier].suffix
  return [one(lo), one(hi), `${suffix ? suffix + NBSP : ''}₽`]
}

/**
 * Диапазон с одной единицей: rangeText(54e3, 86.7e3, '₽') = «54–86,7 тыс. ₽»;
 * со знаком — словами, чтобы минус не слипался с тире: «от −150 до −50 млн ₽».
 */
export function rangeText(lo: number | null | undefined, hi: number | null | undefined, unit: Unit = '—'): string {
  if (!isNum(lo) || !isNum(hi)) return DASH
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  let ta: string, tb: string, u: string
  if (unit === '₽') {
    [ta, tb, u] = moneyPair(a, b)
  } else {
    const [na, ua] = splitNumUnit(fmtValue(a, unit))
    const [nb, ub] = splitNumUnit(fmtValue(b, unit))
    if (ua !== ub) return a < 0 ? `от ${fmtValue(a, unit)} до ${fmtValue(b, unit)}` : `${fmtValue(a, unit)} – ${fmtValue(b, unit)}`
    ;[ta, tb, u] = [na, nb, ub]
  }
  const tail = u ? `${NBSP}${u}` : ''
  if (a < 0 && ta.startsWith(MINUS)) return `от ${ta} до ${tb}${tail}`
  return `${ta}–${tb}${tail}`
}

/** Деньги разных порядков («664 ₽» и «7,76 тыс. ₽») — в одном, большем: ["0,66", "7,76", "тыс. ₽"]; не деньги — null. */
function oneMoneyTier(na: string, ua: string, nb: string, ub: string): [string, string, string] | null {
  const tier = (u: string) => MONEY_TIERS.findIndex((t) => `${t.suffix ? t.suffix + NBSP : ''}₽` === u)
  return tier(ua) < 0 || tier(ub) < 0 ? null : moneyPair(parseNum(na) * MONEY_TIERS[tier(ua)].factor, parseNum(nb) * MONEY_TIERS[tier(ub)].factor)
}

/**
 * Диапазон из двух готовых строк форматтера: общая единица — один раз, со знаком — словами; деньги разных
 * порядков — в большем: joinRange('664 ₽', '7,76 тыс. ₽') = «0,66–7,76 тыс. ₽»; разные единицы — «2 ч – 5 %».
 */
export function joinRange(a: string, b: string): string {
  if (a === DASH || b === DASH) return DASH
  let [na, ua] = splitNumUnit(a)
  let [nb, ub] = splitNumUnit(b)
  const same = ua !== ub ? oneMoneyTier(na, ua, nb, ub) : null
  if (same) [na, nb, ua, ub] = [same[0], same[1], same[2], same[2]]
  const neg = na.startsWith(MINUS)
  if (ua !== ub) return neg ? `от ${a} до ${b}` : `${a} – ${b}`
  const tail = ua ? `${NBSP}${ua}` : ''
  return neg ? `от ${na} до ${nb}${tail}` : `${na}–${nb}${tail}`
}

function pointsText(v: number, scale: number, digits: number, unit: string, opts: { signed?: boolean }): string {
  const text = withSign(v * scale, digits)
  const zero = text === '0'
  const sign = opts.signed && !zero && v > 0 ? '+' : ''
  return `${sign}${text}${NBSP}${unit}`
}

/** Базисные пункты из доли: bp(0.0047) = «47 б. п.»; { signed } — «+47 б. п.». */
export function bp(v: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (!isNum(v)) return DASH
  return pointsText(v, 10_000, 0, `б.${NBSP}п.`, opts)
}

/** Процентные пункты из разности долей: pp(0.012) = «1,2 п. п.»; { signed } — «+1,2 п. п.». */
export function pp(v: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  if (!isNum(v)) return DASH
  return pointsText(v, 100, opts.digits ?? 1, `п.${NBSP}п.`, opts)
}

/**
 * Вероятность как частота: freqText(0.03) = «в 3 из 100»; редкое — «реже 1 из 100», ноль — «ни в одном из 100».
 * Слово («сценариев») добавляет вызывающий.
 */
export function freqText(p: number | null | undefined, of = 100): string {
  if (!isNum(p)) return DASH
  const k = Math.round(Math.min(1, Math.max(0, p)) * of)
  if (p <= 0) return `ни в одном из ${num(of, 0)}`
  if (k === 0) return `реже 1 из ${num(of, 0)}`
  return `в ${num(k, 0)} из ${num(of, 0)}`
}

/* ── Прогоны ──────────────────────────────────────────────────────────────── */

export interface RunLabelInput {
  /** Порядковый номер прогона (№28). */
  seq?: number | null
  /** Идентификатор прогона: показывается номером, только если это число (хэш не показывается никогда). */
  id?: string | null
  /** Человеческое имя правила/цели (ruleLabel(…, 'short')). */
  rule?: string | null
  createdAt?: DateInput
  /** Слово-тип прогона: «План», «Портфель». */
  kind?: string
}

/** «План №28 · CR · 24.10 17:38» — одно имя прогона во всём интерфейсе; без хэшей. */
export function runLabel({ seq, id, rule, createdAt, kind = 'План' }: RunLabelInput): string {
  const n = isNum(seq) ? seq : id && /^\d+$/.test(id.trim()) ? Number(id) : null
  const head = n !== null ? `${kind} №${n}` : kind
  const when = createdAt !== undefined && createdAt !== null && createdAt !== '' ? dateTimeShort(createdAt) : ''
  return [head, rule?.trim() || '', when === DASH ? '' : when].filter(Boolean).join(' · ')
}
