/**
 * Пути генератора для режима сценария (POST /api/macro/sample, n 300, seed 42): карточка пресета,
 * галерея пресетов и пути в расширенных настройках берут один кэш по (стресс, опоры, горизонт, пути) —
 * повторный вход не пересчитывает. Нужны только помесячные пути: `horizon_weeks: 0` (иначе сервер
 * строил недельную сетку на 26 недель и 6-месячный сценарий падал «недостаточно месяцев»). Ошибка —
 * человеческой фразой с «Повторить» (`retry`), сырой текст сервера — только в подсказке.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type MacroModeName, type MacroSampleResult } from '../../lib/api'
import { NBSP, num } from '../../explain/format'
import { errorText } from '../../ui/kit'
import { monthShort } from './monthText'
import type { ScenarioMacroMode } from './regimeMenu'

export const SAMPLE_PATHS = 300
export const SAMPLE_SEED = 42
const DEBOUNCE_MS = 400

const cache = new Map<string, Promise<MacroSampleResult>>()

function parts(mode: ScenarioMacroMode | MacroModeName) {
  const m = typeof mode === 'string' ? null : mode
  return { stress: m?.stress ?? null, ref: m?.ref }
}

export function sampleKey(mode: ScenarioMacroMode | MacroModeName, months: number, keepPaths: boolean): string {
  const { stress, ref } = parts(mode)
  return JSON.stringify([stress, ref ?? null, months, keepPaths])
}

/** Пути генератора (с кэшем); ошибка убирает запись — следующий вызов повторит запрос. */
export function fetchMacroSample(mode: ScenarioMacroMode | MacroModeName, months: number, keepPaths = false): Promise<MacroSampleResult> {
  const key = sampleKey(mode, months, keepPaths)
  const hit = cache.get(key)
  if (hit) return hit
  const { stress, ref } = parts(mode)
  const p = api.macro.sample({ n: SAMPLE_PATHS, seed: SAMPLE_SEED, horizon_months: months, horizon_weeks: 0, paths: keepPaths ? SAMPLE_PATHS : 0, stress, ref })
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  return p
}

/** Текст ошибки генератора: слова сервера без служебного префикса, месяцы — словами. */
export function sampleErrorText(e: unknown): string {
  return errorText(e, 'Пути генератора не построены — повторите позже')
    .replace(/^macro:\s*/i, '')
    .replace(/\b(\d{4}-\d{2})\b/g, (m) => monthShort(m) || m)
}

/** Ошибка путей словами: «Не удалось посчитать пути генератора на 6 мес»; подробность — отдельно. */
export function sampleFailText(months: number): string {
  return `Не удалось посчитать пути генератора на ${num(months, 0)}${NBSP}мес`
}

export interface MacroSampleState {
  sample: MacroSampleResult | null
  status: 'loading' | 'ready' | 'error'
  /** Текст сервера (для подсказки «подробнее»). */
  error: string
  /** Повторить запрос (кэш ошибки уже снят). */
  retry: () => void
}

/** Пути генератора для режима; `keepPaths` — нужны отдельные пути (полоса режимов). */
export function useMacroSample(mode: ScenarioMacroMode | MacroModeName, months: number, keepPaths = false): MacroSampleState {
  const horizon = Math.max(1, Math.min(36, Math.round(months)))
  const key = sampleKey(mode, horizon, keepPaths)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  const [state, setState] = useState<Omit<MacroSampleState, 'retry'>>({ sample: null, status: 'loading', error: '' })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, status: 'loading' }))
    const timer = window.setTimeout(() => {
      fetchMacroSample(mode, horizon, keepPaths)
        .then((sample) => { if (alive) setState({ sample, status: 'ready', error: '' }) })
        .catch((e: unknown) => { if (alive) setState((s) => ({ ...s, status: 'error', error: sampleErrorText(e) })) })
    }, cache.has(key) ? 0 : DEBOUNCE_MS)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [key, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry }
}
