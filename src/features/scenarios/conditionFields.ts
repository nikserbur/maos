/**
 * Поля «Условий» — одна спецификация на экран сценария, сравнение и мониторинг (владелец: «параметры
 * ужасные и неверные»). На каждое поле: подпись обычным регистром, единица, перевод «хранится в БД ↔
 * показывается» (инфляция в месяц ↔ % г/г с шагом 0,1; разброс 0,06 ↔ 100 % от исторического; курс и
 * спрос ×1 ↔ сдвиг 0 %), разумный диапазон, однострочный эффект из чисел и откуда умолчание.
 * Где действует (одно число — везде): инфляция и сдвиг курса — опора путей генератора (бэкенд: ref.cpi,
 * ref.fx), значит и цены изделий, и Портфель с кассой; разброс — веер и Портфель; спрос — потолок продаж
 * в Портфеле (уровень цен не трогает); связь цен — веер и сырьё, а в Портфеле — β «Распределений»
 * (показывается рядом). Чистые функции — vitest.
 */
import type { MacroLastObs } from '../../lib/api'
import { NBSP, num, signed } from '../../explain/format'
import { monthShort } from './monthText'
import { SCENARIO_DEFAULTS, inflationFromYoy, yoyFromMonthly, type DefaultsContext } from './scenarioDefaults'

export type ConditionKey = 'inflation' | 'volatility' | 'market_corr' | 'fx' | 'demand'

export interface ConditionContext extends DefaultsContext {
  /** Горизонт прогноза сценария, мес. */
  months: number
  /** ρ ≈ β·β из «Распределений», если β у изделий одинаковы. */
  rhoFromBeta?: number | null
  /** Статус паспорта норматива связи цен (r1.30). */
  corrStatus?: string
  /** Типичный исход генератора к горизонту (медиана путей): инфляция г/г, %, и курс, ₽. */
  generator?: { cpiEnd: number; fxEnd: number } | null
}

export interface ConditionSpec {
  key: ConditionKey
  group: 'prices' | 'market'
  label: string
  unit?: string
  /** Хранимое (доля, множитель) → показываемое (% г/г, %, сдвиг). */
  toShown: (stored: number) => number
  toStored: (shown: number) => number
  range: [number, number]
  min: number
  max: number
  step: number
  info?: string
  /** Пояснение в «i»: что это и где действует. */
  hint: (ctx: ConditionContext) => string
  /** Одна строка под значением; `isDefault` — значение не задано (умолчание из данных). */
  effect: (stored: number, ctx: ConditionContext, isDefault?: boolean) => string
  /** Откуда значение по умолчанию: статус паспорта и источник словами. */
  origin: (ctx: ConditionContext) => { status: string; source: string }
  /** Значение текстом (сравнение сценариев). */
  text: (stored: number) => string
}

const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits
const NEUTRAL_VOL = SCENARIO_DEFAULTS.volatility
const pctText = (v: number, digits = 1) => `${num(v, digits)}${NBSP}%`

function lastObsSource(o: MacroLastObs | null | undefined): string {
  const when = monthShort(o?.month)
  return when ? `ЦБ РФ, ${when}` : 'ЦБ РФ'
}

const inflation: ConditionSpec = {
  key: 'inflation', group: 'prices', label: 'Инфляция', unit: `%${NBSP}г/г`,
  toShown: (m) => round(yoyFromMonthly(m) * 100, 1),
  toStored: (y) => inflationFromYoy(y),
  range: [2, 20], min: -5, max: 60, step: 0.1, info: 'forecast.inflation',
  hint: () => 'Опора путей инфляции генератора. По умолчанию — последняя годовая инфляция ЦБ РФ, дальше пути генератора; '
    + 'своё значение сдвигает пути вокруг него. Действует на цены изделий и сырья, Портфель и кассу.',
  effect: (m, ctx, isDefault) => {
    const g = ctx.generator
    const y0 = ctx.lastObs?.cpi_yoy_pp
    if (isDefault && g && typeof y0 === 'number') return `генератор: ${pctText(y0)} → ${pctText(g.cpiEnd)} г/г через ${num(ctx.months, 0)}${NBSP}мес`
    if (isDefault) return 'пути генератора от последнего значения ЦБ РФ'
    return `пути инфляции вокруг ${pctText(yoyFromMonthly(m) * 100)} г/г — в ценах, Портфеле и кассе`
  },
  origin: (ctx) => (ctx.lastObs ? { status: 'О', source: `генератор · ${lastObsSource(ctx.lastObs)}` } : { status: 'техн.', source: 'запасное значение: генератор недоступен' }),
  text: (m) => `${num(round(yoyFromMonthly(m) * 100, 1), 1)}${NBSP}%${NBSP}г/г`,
}

const volatility: ConditionSpec = {
  key: 'volatility', group: 'prices', label: 'Разброс цен', unit: '% от исторического',
  toShown: (v) => round((v / NEUTRAL_VOL) * 100, 0),
  toStored: (s) => (NEUTRAL_VOL * s) / 100,
  range: [50, 300], min: 20, max: 600, step: 10,
  hint: () => 'Множитель к разбросу, подобранному по истории каждого ряда цен: 100 % — как в истории. Действует на веер цен и на разброс цен в Портфеле.',
  effect: (v) => {
    const s = (v / NEUTRAL_VOL) * 100
    if (Math.abs(s - 100) < 0.5) return 'вееры цен — как колебания в истории'
    return s > 100 ? `вееры цен в ${num(s / 100, 1)} раза шире исторических` : `вееры цен на ${num(100 - s, 0)}${NBSP}% уже исторических`
  },
  origin: () => ({ status: 'О', source: 'по истории каждого ряда' }),
  text: (v) => `${num(round((v / NEUTRAL_VOL) * 100, 0), 0)}${NBSP}% от исторического`,
}

const marketCorr: ConditionSpec = {
  key: 'market_corr', group: 'prices', label: 'Связь цен между изделиями',
  toShown: (v) => round(v, 2), toStored: (v) => v,
  range: [0, 0.9], min: 0, max: 0.98, step: 0.05,
  hint: (ctx) => `Общий рыночный фактор: 0 — цены независимы, 1 — движутся вместе. Это поле действует на веер цен и закупочные цены сырья; `
    + `в Портфеле связь изделий задаёт «Зависимость от рынка (β)» в «Распределениях»${typeof ctx.rhoFromBeta === 'number' ? ` — сейчас ${num(ctx.rhoFromBeta, 2)}` : ''}.`,
  effect: (v, ctx) => {
    const word = v < 0.3 ? 'слабая' : v < 0.7 ? 'умеренная' : 'сильная'
    return typeof ctx.rhoFromBeta === 'number'
      ? `${word} · веер и сырьё ${num(v, 2)}, Портфель ${num(ctx.rhoFromBeta, 2)}`
      : `${word} · веер и сырьё; в Портфеле — по изделиям`
  },
  origin: (ctx) => ({ status: ctx.corrStatus || 'НОРМ', source: 'норматив предприятия' }),
  text: (v) => num(v, 2),
}

const fx: ConditionSpec = {
  key: 'fx', group: 'market', label: 'Сдвиг курса доллара', unit: '% к курсу по прогнозу',
  toShown: (f) => round((f - 1) * 100, 1), toStored: (s) => 1 + s / 100,
  range: [-20, 30], min: -50, max: 100, step: 1,
  hint: () => 'Сдвиг уровня курса во всех путях генератора с первого месяца. Действует в Портфеле и кассе и на цены — '
    + 'через эластичность к курсу (сырьё сильнее, изделия слабее).',
  effect: (f, ctx) => {
    const s0 = ctx.lastObs?.usd_rub
    const g = ctx.generator
    if (Math.abs(f - 1) < 1e-9) {
      if (typeof s0 === 'number' && g) return `генератор: ${num(s0, 1)} → ${num(g.fxEnd, 1)}${NBSP}₽ за доллар через ${num(ctx.months, 0)}${NBSP}мес`
      return typeof s0 === 'number' ? `сейчас ${num(s0, 2)}${NBSP}₽ за доллар, дальше — пути генератора` : 'курс — по путям генератора'
    }
    return typeof s0 === 'number' ? `${num(s0, 2)} → ${num(s0 * f, 2)}${NBSP}₽ за доллар · в Портфеле, кассе и ценах` : `курс ${signed(f - 1, '%')} во всех путях`
  },
  origin: () => ({ status: 'О', source: 'пути генератора' }),
  text: (f) => (Math.abs(f - 1) < 1e-9 ? 'как в прогнозе' : `${signed(f - 1, '%')} к курсу по прогнозу`),
}

const demand: ConditionSpec = {
  key: 'demand', group: 'market', label: 'Спрос', unit: '% к справочнику',
  toShown: (d) => round((d - 1) * 100, 1), toStored: (s) => 1 + s / 100,
  range: [-50, 50], min: -70, max: 100, step: 1,
  hint: () => 'Сдвиг потолка продаж изделий из справочника НСИ — действует в Портфеле. Цены изделий от него не меняются; '
    + 'спрос сам по себе не случайный.',
  effect: (d) => (Math.abs(d - 1) < 1e-9 ? 'потолок продаж — как в справочнике' : `потолок продаж ${signed(d - 1, '%')} к справочнику (Портфель)`),
  origin: () => ({ status: 'Н', source: 'справочник НСИ' }),
  text: (d) => (Math.abs(d - 1) < 1e-9 ? 'как в справочнике' : `${signed(d - 1, '%')} к справочнику`),
}

export const CONDITION_SPECS: readonly ConditionSpec[] = [inflation, volatility, marketCorr, fx, demand]

export function conditionSpec(key: ConditionKey): ConditionSpec {
  return CONDITION_SPECS.find((s) => s.key === key) as ConditionSpec
}

export const CONDITION_GROUPS: ReadonlyArray<{ id: ConditionSpec['group']; title: string; affects: string }> = [
  { id: 'prices', title: 'Цены', affects: 'веер цен, Портфель и касса' },
  { id: 'market', title: 'Курс и спрос', affects: 'курс — везде, спрос — потолок продаж в Портфеле' },
]
