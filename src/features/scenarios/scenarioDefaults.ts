/**
 * Умолчания сценария — один источник для шапки, «Условий», тела PUT (payloadOf), пресетов и сравнения
 * (X2 «показанное значение = значение движка»). Незаданное поле показывается тем числом, с которым
 * считает бэкенд: разброс цен 0,06 = ×1 к истории (Optimizer.h, VOL_REF прогноза), инфляция —
 * последнее наблюдение ЦБ РФ из генератора (г/г → в месяц; без генератора — 1 %/мес, как бэкенд
 * main.cpp scenario_inflation_default), max_share 0,6, α 0,1… `numOr` сохраняет 0. Горизонт — один на
 * всё (DEFAULT_HORIZON_MONTHS = 12: новый сценарий, пресеты, /api/forecast). «Вернуть» условие не пишет
 * умолчание числом: поле становится пустым, PUT шлёт его в `reset` → NULL в БД, и умолчание дальше
 * следует за данными (новое наблюдение ЦБ). Чистые функции.
 */
import type { MacroLastObs, PriceScenario } from '../../lib/api'

/** Горизонт сценария по умолчанию, мес — один для нового сценария, пресетов и прогноза (бэкенд kDefaultHorizonMonths). */
export const DEFAULT_HORIZON_MONTHS = 12

export const SCENARIO_DEFAULTS = {
  objective: 'cvar',
  alpha: 0.1,
  max_share: 0.6,
  market_corr: 0.5,
  /** ×1 к разбросу истории (нейтраль движка). */
  volatility: 0.06,
  months: DEFAULT_HORIZON_MONTHS,
  fx: 1,
  demand: 1,
  /** Запасное значение без генератора (как бэкенд); с генератором — `defaultsFor({ lastObs })`. */
  inflation: 0.01,
  horizon_hours: 720,
  mode: 'stochastic',
} as const

/** Устаревшие поля (не в расчёте), но тело PUT обязано вернуть их как есть. */
export const LEGACY_DEFAULTS = { sanctions: 0, tax_change: 0, energy: 1, logistics: 1, key_rate: 8 } as const

/** Числовые поля условий, которые пользователь правит. */
export type NumericKey = 'alpha' | 'max_share' | 'market_corr' | 'volatility' | 'months' | 'fx' | 'demand' | 'inflation'

/** Поля вкладки «Условия» (для «изменено N полей · вернуть все»). */
export const CONDITION_KEYS: readonly NumericKey[] = ['inflation', 'volatility', 'market_corr', 'fx', 'demand']
/** Поля критерия (шапка). */
export const CRITERION_KEYS: readonly NumericKey[] = ['alpha', 'max_share']
/** Условия, которые БД хранит как NULL = «умолчание движка» (возврат — через `reset` в PUT). */
export const RESETTABLE_KEYS = ['inflation', 'fx', 'demand', 'volatility'] as const
export type ResettableKey = (typeof RESETTABLE_KEYS)[number]
const isResettable = (k: string): k is ResettableKey => (RESETTABLE_KEYS as readonly string[]).includes(k)

/** Контекст умолчаний: точка старта генератора (ЦБ РФ) — откуда берётся инфляция по умолчанию. */
export interface DefaultsContext { lastObs?: MacroLastObs | null }

const EPS = 1e-9
/** Инфляция хранится в месяц; совпадение с умолчанием — до сотой доли процента в год. */
const EPS_INFLATION = 1e-6

/** Инфляция г/г, п. п. → в месяц, доля: 6,35 → 0,00514. */
export function inflationFromYoy(yoyPp: number): number {
  return Math.pow(1 + yoyPp / 100, 1 / 12) - 1
}

/** В месяц, доля → г/г, доля: 0,00514 → 0,0635. */
export function yoyFromMonthly(monthly: number): number {
  return Math.pow(1 + monthly, 12) - 1
}

/** Умолчания с учётом генератора. */
export function defaultsFor(ctx: DefaultsContext = {}): Record<NumericKey, number> & { objective: string } {
  const yoy = ctx.lastObs?.cpi_yoy_pp
  return {
    objective: SCENARIO_DEFAULTS.objective, alpha: SCENARIO_DEFAULTS.alpha, max_share: SCENARIO_DEFAULTS.max_share,
    market_corr: SCENARIO_DEFAULTS.market_corr, volatility: SCENARIO_DEFAULTS.volatility, months: SCENARIO_DEFAULTS.months,
    fx: SCENARIO_DEFAULTS.fx, demand: SCENARIO_DEFAULTS.demand,
    inflation: typeof yoy === 'number' && Number.isFinite(yoy) ? inflationFromYoy(yoy) : SCENARIO_DEFAULTS.inflation,
  }
}

/** Число из строки БД или умолчание; 0 сохраняется, пусто/мусор → умолчание. */
export function numOr(x: unknown, d: number): number {
  if (x === undefined || x === null) return d
  if (typeof x === 'string' && x.trim() === '') return d
  const v = Number(x)
  return Number.isFinite(v) ? v : d
}

/** Поле не задано в БД (NULL/пусто) — движок берёт своё умолчание. */
export function isUnset(x: unknown): boolean {
  return x === undefined || x === null || (typeof x === 'string' && x.trim() === '')
}

/** Значение совпадает с умолчанием (с допуском на округление строк БД). */
export function isDefaultValue(key: NumericKey, value: number, ctx: DefaultsContext = {}): boolean {
  return Math.abs(value - defaultsFor(ctx)[key]) < (key === 'inflation' ? EPS_INFLATION : EPS)
}

export interface EffectiveScenario {
  objective: string
  alpha: number
  max_share: number
  market_corr: number
  volatility: number
  months: number
  fx: number
  demand: number
  inflation: number
  /** Поле не задано или равно умолчанию. */
  isDefault: Readonly<Record<NumericKey | 'objective', boolean>>
}

type ScenarioLike = Partial<Pick<PriceScenario, NumericKey | 'objective'>>
const NUMERIC: readonly NumericKey[] = ['alpha', 'max_share', 'market_corr', 'volatility', 'months', 'fx', 'demand', 'inflation']

/** Эффективные значения: то, с чем считает движок. */
export function effectiveScenario(sc: ScenarioLike, ctx: DefaultsContext = {}): EffectiveScenario {
  const d = defaultsFor(ctx)
  const values = Object.fromEntries(NUMERIC.map((k) => [k, numOr(sc[k], d[k])])) as Record<NumericKey, number>
  const objective = sc.objective || SCENARIO_DEFAULTS.objective
  const isDefault = {
    ...Object.fromEntries(NUMERIC.map((k) => [k, isUnset(sc[k]) || isDefaultValue(k, values[k], ctx)])) as Record<NumericKey, boolean>,
    objective: objective === SCENARIO_DEFAULTS.objective,
  }
  return { objective, ...values, isDefault }
}

/** Поля из списка, отличающиеся от умолчания (для «изменено N полей»). */
export function changedKeys(sc: ScenarioLike, keys: readonly NumericKey[] = CONDITION_KEYS, ctx: DefaultsContext = {}): NumericKey[] {
  const eff = effectiveScenario(sc, ctx)
  return keys.filter((k) => !eff.isDefault[k])
}

/**
 * Патч «вернуть к умолчанию»: условие, которое БД хранит как NULL, становится пустым (PUT отправит его
 * в `reset`, умолчание дальше следует за данными); остальные (α, доля, связь цен) — числом умолчания.
 */
export function resetPatch(keys: readonly NumericKey[], ctx: DefaultsContext = {}): Partial<Pick<PriceScenario, NumericKey>> {
  const d = defaultsFor(ctx)
  return Object.fromEntries(keys.map((k) => [k, isResettable(k) ? '' : String(d[k])])) as Partial<Pick<PriceScenario, NumericKey>>
}

/** Незаданные (пустые) условия сценария — для `reset` тела PUT. */
export function unsetKeys(sc: Partial<Pick<PriceScenario, ResettableKey>>): ResettableKey[] {
  return RESETTABLE_KEYS.filter((k) => isUnset(sc[k]))
}

/**
 * Происхождение поля критерия для бейджа: умолчание → статус паспорта (◆ норматив…), иначе —
 * «■ вручную» (изменённое поле не подписывается нормативом).
 */
export function fieldBadge(key: NumericKey, value: number, passportStatus?: string): { provenance: 'manual' | 'default'; status?: string } {
  return isDefaultValue(key, value) ? { provenance: 'default', status: passportStatus } : { provenance: 'manual' }
}

/** Конец горизонта = начало + N месяцев («2026-10-01» + 6 → «2027-04-01»); без начала — ''. */
export function endDateOf(start: string | undefined, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start ?? '')
  if (!m || !Number.isFinite(months)) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + Math.round(months), Number(m[3])))
  return d.toISOString().slice(0, 10)
}
