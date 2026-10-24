/**
 * «Что если…» на «Мониторинге» (владелец: «курс 1 ×, спрос 1 × — бессмысленные множители»; X2
 * «состояние в адресе»): пресет из той же галереи, что в «Сценариях» (scenarioPresets), горизонт и
 * необязательные поправки в настоящих единицах — инфляция % в год, курс ₽ за $, спрос — отклонение
 * «% к справочнику» (словарь «Сценариев»: conditionSpec).
 * Пусто — «из генератора» / «текущий курс» / значение пресета. Состояние живёт в адресе
 * (`?mode=manual&wp=…&wm=…&wi=…&wu=…&wd=…`) — F5 возвращает тот же расчёт.
 * Перевод в параметры движка цен: инфляция г/г → постоянная месячная, курс → множитель к текущему.
 * Чистые функции — vitest.
 */
import type { ForecastParams } from '../../lib/api'
import type { HashParams } from '../../shell/router'
import { NBSP, num, pct } from '../../explain/format'
import { conditionSpec } from '../scenarios/conditionFields'
import { PRESETS, getPreset, presetMacroMode, type ScenarioPreset } from '../scenarios/scenarioPresets'
import { yoyToMonthly } from './macroModel'

export interface WhatIf {
  /** id пресета галереи «Сценариев». */
  preset: string
  months: number
  /** Инфляция г/г (доля); null — из генератора. */
  inflation: number | null
  /** Курс ₽ за $; null — текущий (последнее наблюдение ЦБ). */
  usd: number | null
  /** Спрос к справочнику (1 = как в справочнике); null — как у пресета (экспертная оценка) или 1. */
  demand: number | null
}

export const HORIZON_MIN = 1
export const HORIZON_MAX = 36

const clampMonths = (m: number) => Math.max(HORIZON_MIN, Math.min(HORIZON_MAX, Math.round(m)))

/** Пресет «что если»: из галереи, неизвестный id — Базовый. */
export function whatIfPreset(w: Pick<WhatIf, 'preset'>): ScenarioPreset {
  return getPreset(w.preset) ?? PRESETS[0]
}

function numParam(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Адрес → «что если»; мусор → значения по умолчанию. */
export function whatIfFromParams(hp: HashParams, months: number): WhatIf {
  const wi = numParam(hp.wi)
  const wu = numParam(hp.wu)
  const wd = numParam(hp.wd)
  return {
    preset: whatIfPreset({ preset: hp.wp ?? '' }).id,
    months: clampMonths(numParam(hp.wm) ?? months),
    inflation: wi === null ? null : wi / 100,
    usd: wu !== null && wu > 0 ? wu : null,
    demand: wd !== null && wd > 0 ? wd / 100 : null,
  }
}

/** «Что если» → параметры адреса (пустые поправки не пишутся). */
export function whatIfToParams(w: WhatIf): Record<string, string | null> {
  return {
    mode: 'manual',
    wp: w.preset === PRESETS[0].id ? null : w.preset,
    wm: String(clampMonths(w.months)),
    wi: w.inflation === null ? null : String(Math.round(w.inflation * 1000) / 10),
    wu: w.usd === null ? null : String(Math.round(w.usd * 100) / 100),
    wd: w.demand === null ? null : String(Math.round(w.demand * 100)),
  }
}

/** Ключи адреса «что если» — сбросить при возврате к сценарию. */
export const WHAT_IF_CLEAR: Readonly<Record<string, null>> = { mode: null, wp: null, wm: null, wi: null, wu: null, wd: null }

/** Спрос, с которым пойдёт расчёт: поправка, иначе экспертное значение пресета, иначе 100 %. */
export function resolvedDemand(w: WhatIf): number {
  return w.demand ?? whatIfPreset(w).values.demand ?? 1
}

export interface WhatIfContext {
  /** Инфляция генератора г/г (доля) для пресета; null — неизвестна. */
  generatorCpi: number | null
  /** Текущий курс ₽ за $ (последнее наблюдение ЦБ); null — неизвестен. */
  usdNow: number | null
  /** Волатильность и корреляция цен сценария — если пресет не задаёт своих. */
  volatility: number
  corr: number
}

/** Параметры /api/forecast для «что если»; инфляция не известна — движок возьмёт своё значение. */
export function whatIfRequest(w: WhatIf, ctx: WhatIfContext, extra: Pick<ForecastParams, 'runs' | 'backtest'>): ForecastParams {
  const p = whatIfPreset(w)
  const mode = presetMacroMode(p, clampMonths(w.months))
  const infl = w.inflation ?? ctx.generatorCpi
  return {
    months: clampMonths(w.months), demand: resolvedDemand(w),
    fx: w.usd !== null && ctx.usdNow ? w.usd / ctx.usdNow : 1,
    volatility: p.values.volatility ?? ctx.volatility, corr: p.values.market_corr ?? ctx.corr,
    ...(infl === null ? {} : { inflation: yoyToMonthly(infl) }),
    macro_stress: mode.stress ?? null, ...(mode.ref ? { macro_ref: mode.ref } : {}), ...extra,
  }
}

/** «Как 2022 · 6 мес · инфляция 8 % в год · курс 95 ₽ за $ · спрос −10 % к справочнику». */
export function whatIfLabel(w: WhatIf): string {
  const parts = [whatIfPreset(w).short, `${num(w.months, 0)}${NBSP}мес`]
  if (w.inflation !== null) parts.push(`инфляция ${pct(w.inflation, 1)} в год`)
  if (w.usd !== null) parts.push(`курс ${num(w.usd, 1)}${NBSP}₽ за $`)
  if (w.demand !== null) parts.push(`спрос ${conditionSpec('demand').text(w.demand)}`)
  return parts.join(' · ')
}
