/**
 * Откуда «Мониторинг» берёт условия: сценарий с пресетом «Базовый» (обучено на истории) — по умолчанию,
 * явный `?sc=` — по ссылке, «что если» — только из панели («?mode=manual&wp=…»). Здесь же — пути
 * генератора, инфляция генератора, параметры /api/forecast и ключ кэша. Нет «Базового» сценария —
 * считаем пресет «Базовый» с умолчаниями (честно подписано), а не первый попавшийся сценарий.
 */
import { useMemo } from 'react'
import type { ForecastParams, MacroLastObs, PriceScenario } from '../../lib/api'
import type { HashParams } from '../../shell/router'
import type { RefsState } from '../method-map/useMethodMapState'
import { fromMacroMode, toMacroMode, type ScenarioMacroMode } from '../scenarios/regimeMenu'
import { effectiveScenario, type EffectiveScenario } from '../scenarios/scenarioDefaults'
import { presetMacroMode, scenarioView, type ScenarioPreset } from '../scenarios/scenarioPresets'
import { useMacroSample, type MacroSampleState } from '../scenarios/useMacroSample'
import { FORECAST_BACKTEST, FORECAST_RUNS } from './forecastModel'
import { forecastKey } from './forecastStore'
import { anchorOf, fanFromPaths, generatorInflation } from './macroModel'
import { manualChanges, pickMonitorScenario, stressShort, type ManualChange } from './monitorSource'
import { useMacroRegimes } from './useMacroRegimes'
import { whatIfFromParams, whatIfPreset, whatIfRequest, type WhatIf } from './whatIfModel'

export interface MonitorSource {
  scId: string
  sc: PriceScenario | null
  /** Считаем «что если» (или пресет «Базовый» без сценария). */
  manual: boolean
  /** «Что если» выбрано пользователем в панели (а не запасной расчёт без сценария). */
  whatIfOn: boolean
  whatIf: WhatIf
  /** Пресет условий: «что если» — из панели, сценарий — его пресет; своя настройка — null. */
  preset: ScenarioPreset | null
  months: number
  eff: EffectiveScenario
  /** Короткое имя стресса («Как 2022»); прогноз — null. */
  stressName: string | null
  /** Ручные отличия сценария от его пресета (единицы «Сценариев»). */
  changes: readonly ManualChange[]
  /** Есть ли среди сценариев «Базовый». */
  baseId: string | null
  macro: MacroSampleState
  regimes: ReturnType<typeof useMacroRegimes>
  lastObs: MacroLastObs | null
  anchor: string | null
  genCpi: number | null
  params: ForecastParams
  key: string
  /** «Что если» без своей инфляции ждёт генератор: иначе движок молча возьмёт своё значение. */
  waitGen: boolean
}

export function useMonitorSource(refs: RefsState, hp: HashParams, prefer: { context?: string; plan?: string }): MonitorSource {
  const scId = pickMonitorScenario(refs.scenarios, { explicit: hp.sc, context: prefer.context, plan: prefer.plan })
  const baseId = pickMonitorScenario(refs.scenarios, {}) || null
  const sc = refs.full[scId] ?? refs.scenarios.find((s) => s.id === scId) ?? null
  const whatIfOn = hp.mode === 'manual'
  const manual = whatIfOn || (refs.status !== 'loading' && refs.status !== 'idle' && !scId)
  const regimes = useMacroRegimes()
  const lastObsRef = regimes?.last_obs ?? refs.macro?.last_obs ?? null
  const eff = effectiveScenario(sc ?? {}, { lastObs: lastObsRef })
  const whatIf = useMemo(() => whatIfFromParams(hp, eff.months), [hp, eff.months])

  const scMode = toMacroMode(fromMacroMode(sc?.macro_mode), eff.months)
  const scM: ScenarioMacroMode | null = typeof scMode === 'string' ? null : scMode
  const view = manual ? null : scenarioView(sc?.macro_mode, [], eff.months)
  const preset = manual ? whatIfPreset(whatIf) : view?.preset ?? null
  const months = manual ? whatIf.months : eff.months
  const mode = manual ? presetMacroMode(whatIfPreset(whatIf), months) : scMode
  const stressName = manual ? (whatIfPreset(whatIf).isForecast ? null : whatIfPreset(whatIf).short) : stressShort(view)
  const changes = useMemo(() => (manual ? [] : manualChanges(sc, view?.preset ?? null, lastObsRef)), [manual, sc, view?.preset, lastObsRef])

  const macro = useMacroSample(mode, months, true)
  const lastObs = macro.sample?.last_obs ?? lastObsRef
  const anchor = lastObs?.month ?? null
  const genCpi = generatorInflation(macro.sample ? fanFromPaths(macro.sample.paths, 'cpi', anchorOf(macro.sample, 'cpi')) : null, lastObs?.cpi_yoy_pp ?? null)

  const params = useMemo<ForecastParams>(() => (manual
    ? whatIfRequest(whatIf, { generatorCpi: genCpi, usdNow: lastObs?.usd_rub ?? null, volatility: eff.volatility, corr: eff.market_corr }, { runs: FORECAST_RUNS, backtest: FORECAST_BACKTEST })
    : { scenario_id: scId, runs: FORECAST_RUNS, backtest: FORECAST_BACKTEST, macro_stress: scM?.stress ?? null, macro_ref: scM?.ref }),
  [manual, whatIf, genCpi, lastObs?.usd_rub, eff.volatility, eff.market_corr, scId, scM])
  const waitGen = manual && whatIf.inflation === null && genCpi === null && macro.status === 'loading'
  const key = manual ? `manual|${JSON.stringify(params)}` : forecastKey(scId, sc?.macro_mode, months)
  return { scId, sc, manual, whatIfOn, whatIf, preset, months, eff, stressName, changes, baseId, macro, regimes, lastObs, anchor, genCpi, params, key, waitGen }
}
