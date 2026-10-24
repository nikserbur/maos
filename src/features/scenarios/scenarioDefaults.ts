/**
 * Умолчания сценария — один источник для шапки, «Условий», тела PUT (payloadOf), шаблонов и
 * сравнения (X2 «показанное значение = значение движка»): незаданное поле показывается тем
 * числом, с которым считает бэкенд (main.cpp: max_share 0,6, α 0,1…). `numOr` сохраняет 0
 * (ρ = 0 переживает перезагрузку), в отличие от `Number(x) || d`. Чистые функции — vitest.
 */
import type { PriceScenario } from '../../lib/api'

export const SCENARIO_DEFAULTS = {
  objective: 'cvar',
  alpha: 0.1,
  max_share: 0.6,
  market_corr: 0.5,
  volatility: 0.05,
  months: 6,
  fx: 1,
  demand: 1,
  inflation: 0,
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

const EPS = 1e-9

/** Число из строки БД или умолчание; 0 сохраняется, пусто/мусор → умолчание. */
export function numOr(x: unknown, d: number): number {
  if (x === undefined || x === null) return d
  if (typeof x === 'string' && x.trim() === '') return d
  const v = Number(x)
  return Number.isFinite(v) ? v : d
}

/** Значение совпадает с умолчанием (с допуском на округление строк БД). */
export function isDefaultValue(key: NumericKey, value: number): boolean {
  return Math.abs(value - SCENARIO_DEFAULTS[key]) < EPS
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
  /** Поле не задано или равно умолчанию — показывается «○ по умолчанию». */
  isDefault: Readonly<Record<NumericKey | 'objective', boolean>>
}

type ScenarioLike = Partial<Pick<PriceScenario, NumericKey | 'objective'>>

/** Эффективные значения: то, с чем считает движок. */
export function effectiveScenario(sc: ScenarioLike): EffectiveScenario {
  const v = (k: NumericKey) => numOr(sc[k], SCENARIO_DEFAULTS[k])
  const values = {
    alpha: v('alpha'), max_share: v('max_share'), market_corr: v('market_corr'), volatility: v('volatility'),
    months: v('months'), fx: v('fx'), demand: v('demand'), inflation: v('inflation'),
  }
  const objective = sc.objective || SCENARIO_DEFAULTS.objective
  const isDefault = {
    alpha: isDefaultValue('alpha', values.alpha), max_share: isDefaultValue('max_share', values.max_share),
    market_corr: isDefaultValue('market_corr', values.market_corr), volatility: isDefaultValue('volatility', values.volatility),
    months: isDefaultValue('months', values.months), fx: isDefaultValue('fx', values.fx),
    demand: isDefaultValue('demand', values.demand), inflation: isDefaultValue('inflation', values.inflation),
    objective: objective === SCENARIO_DEFAULTS.objective,
  }
  return { objective, ...values, isDefault }
}

/** Поля из списка, отличающиеся от умолчания (для «изменено N полей»). */
export function changedKeys(sc: ScenarioLike, keys: readonly NumericKey[] = CONDITION_KEYS): NumericKey[] {
  const eff = effectiveScenario(sc)
  return keys.filter((k) => !eff.isDefault[k])
}

/** Патч «вернуть все к умолчанию» для перечисленных полей (строки, как хранит БД). */
export function resetPatch(keys: readonly NumericKey[]): Partial<Pick<PriceScenario, NumericKey>> {
  return Object.fromEntries(keys.map((k) => [k, String(SCENARIO_DEFAULTS[k])])) as Partial<Pick<PriceScenario, NumericKey>>
}

/**
 * Происхождение поля для бейджа: умолчание → статус паспорта (◆ норматив, ○ по умолчанию…),
 * иначе — «■ вручную» (статус паспорта не передаётся: изменённое поле не подписывается нормативом).
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
