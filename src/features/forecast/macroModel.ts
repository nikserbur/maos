/**
 * «Внешние условия» на «Мониторинге»: ставка, инфляция г/г и курс ₽ за $ — один обученный генератор
 * (MacroSampler, ряды Банка России). Квантили P10/P50/P90 считаются здесь по траекториям того же
 * генератора с тем же стрессом и опорой, что у сценария (ответ /macro/sample даёт только P5/P95).
 * Качество — по отложенной проверке генератора (сводка /macro/summary): попадание в полосу и CRPS
 * против прогноза «как вчера» — словами и частотой. Чистые функции — vitest.
 */
import type { MacroHoldoutVar, MacroPath, MacroRegimes, MacroSampleResult } from '../../lib/api'
import type { FanSeries } from '../../ui/charts'
import { num, pct } from '../../explain/format'
import { COVERAGE_NOMINAL, timesText, type QualityLevel } from './forecastModel'

export type MacroKey = 'key' | 'cpi' | 'fx'

/** Квантиль отсортированного массива (ближайший ранг, как в бэкенде). */
function q(sorted: readonly number[], f: number): number {
  return sorted[Math.round(f * (sorted.length - 1))]
}

/**
 * Веер ряда по траекториям: месяц 0 — последнее наблюдение (опора), дальше P10/P50/P90 по месяцам.
 * Пустые или битые траектории — пустой веер (карточка покажет «нет данных»).
 */
export function fanFromPaths(paths: readonly MacroPath[], key: MacroKey, anchor: number): FanSeries {
  const rows = paths.map((p) => p.monthly?.[key]).filter((r): r is number[] => Array.isArray(r) && r.length > 0)
  if (rows.length === 0 || !Number.isFinite(anchor)) return { p10: [], p50: [], p90: [] }
  const H = Math.min(...rows.map((r) => r.length))
  const p10 = [anchor], p50 = [anchor], p90 = [anchor]
  for (let t = 0; t < H; t++) {
    const col = rows.map((r) => r[t]).filter(Number.isFinite).sort((a, b) => a - b)
    if (col.length === 0) break
    p10.push(q(col, 0.1)); p50.push(q(col, 0.5)); p90.push(q(col, 0.9))
  }
  return { p10, p50, p90, history: [anchor] }
}

/** Опора ряда — последнее наблюдение ЦБ (ставка и инфляция — в %, курс — ₽ за $). */
export function anchorOf(sample: Pick<MacroSampleResult, 'last_obs'>, key: MacroKey): number {
  const o = sample.last_obs
  return key === 'key' ? o.key_pp : key === 'cpi' ? o.cpi_yoy_pp : o.usd_rub
}

/**
 * Инфляция генератора г/г (доля) — среднее медианного пути за горизонт: то, с чем было бы честно
 * считать цены вместо постоянной инфляции движка. Нет пути — последнее наблюдение.
 */
export function generatorInflation(cpi: FanSeries | null, lastObsPct: number | null): number | null {
  const path = cpi?.p50.slice(1) ?? []
  if (path.length) return path.reduce((a, v) => a + v, 0) / path.length / 100
  return lastObsPct === null || !Number.isFinite(lastObsPct) ? null : lastObsPct / 100
}

/** Инфляция г/г (доля) → постоянная месячная для движка цен: (1 + y)^(1/12) − 1. */
export const yoyToMonthly = (yoy: number): number => Math.pow(1 + yoy, 1 / 12) - 1
/** Месячная → г/г. */
export const monthlyToYoy = (m: number): number => Math.pow(1 + m, 12) - 1

const COVERAGE_BAD = 0.5
const COVERAGE_WARN = 0.7
const SKILL_BAD = -0.5

export interface MacroQuality { level: QualityLevel; sentence: string }

/**
 * Качество веера генератора по отложенной проверке: «проверено на отложенных данных: внутри полосы
 * 8 из 10 · точнее «как вчера» на 12 %». Пороги — как у `qualityOf` рядов цен.
 */
export function macroQuality(v: MacroHoldoutVar | null | undefined): MacroQuality {
  if (!v || !Number.isFinite(v.coverage80) || !(v.mean_CRPS_persistence > 0)) return { level: 'none', sentence: 'качество не проверено' }
  const ratio = v.mean_CRPS / v.mean_CRPS_persistence
  const skill = 1 - ratio
  const cov = v.coverage80
  const level: QualityLevel = skill < SKILL_BAD || cov < COVERAGE_BAD ? 'bad' : skill < 0 || cov < COVERAGE_WARN ? 'warn' : 'ok'
  const hits = `внутри полосы ${num(Math.round(cov * 10), 0)} из 10 (норма ${num(Math.round(COVERAGE_NOMINAL * 10), 0)} из 10)`
  const naive = ratio > 1 ? `хуже «как вчера» ${timesText(ratio)}` : `точнее «как вчера» на ${pct(skill, 0)}`
  return { level, sentence: `проверено на отложенных данных: ${hits} · ${naive}` }
}

/**
 * Полоса генератора узковата: на отложенных данных факт попадал в полосу «8 из 10» реже 7 из 10 раз.
 * Возвращает долю попаданий (для «факт внутри 4 из 10, норма 8»), иначе null.
 */
export function narrowBand(v: MacroHoldoutVar | null | undefined): number | null {
  return v && Number.isFinite(v.coverage80) && v.coverage80 < COVERAGE_WARN ? v.coverage80 : null
}

/** Месяцев истории на карточке «Внешних условий». */
export const MACRO_HISTORY_MONTHS = 24

const HISTORY_KEY: Record<MacroKey, 'key_pp' | 'cpi_yoy_pp' | 'usd_rub'> = { key: 'key_pp', cpi: 'cpi_yoy_pp', fx: 'usd_rub' }

/**
 * Хвост истории ЦБ до месяца опоры включительно (`n` месяцев) — для веера; нет истории или опоры
 * в ней — null (карточка оставит то, что есть).
 */
export function historyTail(history: MacroRegimes['history'] | undefined, key: MacroKey, anchorMonth: string | null, n = MACRO_HISTORY_MONTHS): number[] | null {
  if (!history || !anchorMonth) return null
  const at = history.month.indexOf(anchorMonth)
  const s = history[HISTORY_KEY[key]]
  if (at < 0 || !Array.isArray(s) || s.length <= at) return null
  const tail = s.slice(Math.max(0, at - n + 1), at + 1)
  return tail.every(Number.isFinite) ? tail : null
}

/** Веер с историей ЦБ вместо прежней (последняя точка истории — опора веера). */
export function withHistory<T extends FanSeries>(fan: T, tail: number[] | null): T {
  return tail && tail.length > 1 ? { ...fan, history: tail } : fan
}
