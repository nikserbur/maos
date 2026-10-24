/**
 * Источник «Мониторинга» (владелец: «базовый сценарий = обучиться на истории и это использовать как
 * сценарий»): мониторинг всегда прогнозирует по сценарию с пресетом «Базовый» — обученный генератор,
 * а не по сценарию, отмеченному «рабочим» (тот может быть стрессом). Явный `?sc=<id>` уважается;
 * «что если» — только через панель «Что если…». Ручные отличия сценария от пресета — словами в тех же
 * единицах, что на карточках «Сценариев» (`conditionSpec().text`). Чистые функции — vitest.
 */
import type { MacroLastObs, PriceScenario } from '../../lib/api'
import { conditionSpec, type ConditionKey } from '../scenarios/conditionFields'
import { CONDITION_KEYS, defaultsFor, effectiveScenario } from '../scenarios/scenarioDefaults'
import { scenarioView, type ScenarioPreset, type ScenarioView } from '../scenarios/scenarioPresets'

type ScenarioRow = Pick<PriceScenario, 'id' | 'macro_mode'>

/** Сценарий-прогноз с пресетом «Базовый» (обучено на истории). */
export function isBaseScenario(s: Pick<PriceScenario, 'macro_mode'>): boolean {
  return scenarioView(s.macro_mode).preset?.id === 'base'
}

export interface ScenarioPrefer {
  /** `?sc=` — явный выбор (ссылка), уважается любой. */
  explicit?: string | null
  /** Рабочий сценарий контекста решения — только если он «Базовый». */
  context?: string | null
  /** Сценарий последнего плана — только если он «Базовый». */
  plan?: string | null
}

/**
 * Сценарий «Мониторинга»: явный → рабочий/плановый, если это «Базовый» → первый «Базовый» → первый
 * сценарий-прогноз (базовый режим без пресета) → '' (тогда считаем пресет «Базовый» без сценария).
 */
export function pickMonitorScenario(scenarios: readonly ScenarioRow[], prefer: ScenarioPrefer): string {
  const byId = (id?: string | null) => (id ? scenarios.find((s) => s.id === id) : undefined)
  const explicit = byId(prefer.explicit)
  if (explicit) return explicit.id
  const base = (id?: string | null) => { const s = byId(id); return s && isBaseScenario(s) ? s.id : undefined }
  return base(prefer.context) ?? base(prefer.plan) ?? scenarios.find(isBaseScenario)?.id
    ?? scenarios.find((s) => scenarioView(s.macro_mode).isForecast)?.id ?? ''
}

/**
 * Короткое имя условий «что если» — из пресета («Как 2022»), своя настройка — короткое имя режима
 * «Сценариев» («Период февр.–июль 2022»), никогда — длинный текст режима генератора. Прогноз — null.
 */
export function stressShort(view: Pick<ScenarioView, 'isForecast' | 'preset' | 'short'> | null): string | null {
  if (!view || view.isForecast) return null
  return view.preset?.short ?? (view.short || 'Своя настройка')
}

export interface ManualChange { key: ConditionKey; label: string; text: string }

type ScenarioValues = Partial<Pick<PriceScenario, 'inflation' | 'volatility' | 'market_corr' | 'fx' | 'demand'>>

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

/**
 * Поля «Условий», которые отличаются от пресета сценария (у Базового — от умолчаний): «сдвиг курса
 * доллара −35 % к генератору», «спрос −25 % к справочнику», «разброс цен 175 % от исторического».
 * Совпадение — по показанному тексту (округление строк БД не считается правкой).
 */
export function manualChanges(sc: ScenarioValues | null, preset: ScenarioPreset | null, lastObs?: MacroLastObs | null): ManualChange[] {
  if (!sc) return []
  const ctx = { lastObs }
  const eff = effectiveScenario(sc, ctx)
  const d = defaultsFor(ctx)
  const presetValues: Readonly<Partial<Record<ConditionKey, number>>> = preset?.values ?? {}
  return CONDITION_KEYS.flatMap((key) => {
    const k = key as ConditionKey
    const spec = conditionSpec(k)
    const ref = presetValues[k] ?? d[key]
    const text = spec.text(eff[key])
    return text === spec.text(ref) ? [] : [{ key: k, label: lowerFirst(spec.label), text }]
  })
}

/** «сдвиг курса доллара −35 % к генератору, спрос −25 % к справочнику». */
export function changesText(changes: readonly ManualChange[]): string {
  return changes.map((c) => `${c.label} ${c.text}`).join(', ')
}
