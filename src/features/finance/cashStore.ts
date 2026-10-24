/**
 * Хранилище денежного слоя (волна F): последний результат POST /api/optimize/cash
 * (CVaR-LP с кассой + водопад + цена ликвидности), статус и ошибка — переживают смену
 * экрана; читают результат плана (плитки кассы), «Аналитика» (категория «Деньги»),
 * карта методологии ([4] транши, [5] CFaR). Обновления иммутабельные.
 */
import { useSyncExternalStore } from 'react'
import { api, type CashLpResult, type OptimizeParams, type OptResult } from '../../lib/api'

export interface CashState {
  result: CashLpResult | null
  /** Полный ответ /optimize/cash (портфель + cash_lp) — для сверки с портфелем. */
  opt: OptResult | null
  /** Параметры последнего запуска — для «пересчитать» и манифеста. */
  params: OptimizeParams | null
  running: boolean
  error: string | null
  ranAt: number | null
}

const INITIAL: CashState = { result: null, opt: null, params: null, running: false, error: null, ranAt: null }

let state: CashState = INITIAL
let seq = 0
/** Текущий запуск: «Отменить» прерывает ожидание ответа (сам запрос API без сигнала — ответ игнорируется). */
let controller: AbortController | null = null
const listeners = new Set<() => void>()

function emit(next: CashState): void {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const getSnapshot = (): CashState => state

export function useCashStore(): CashState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function getCashState(): CashState {
  return state
}

/**
 * Запуск CVaR-LP с кассой на сценарии портфеля. `schedule_ref_id` — план Стадии 1, из
 * которого берётся профиль отгрузок; без него профиль равномерный [К]. Устаревшие ответы
 * (запущен новый расчёт) игнорируются.
 */
export async function runCash(params: OptimizeParams): Promise<CashLpResult | null> {
  const token = ++seq
  controller?.abort()
  const ac = new AbortController()
  controller = ac
  emit({ ...state, running: true, error: null, params })
  try {
    const aborted = new Promise<never>((_, reject) => {
      ac.signal.addEventListener('abort', () => reject(new DOMException('Расчёт кассы отменён', 'AbortError')), { once: true })
    })
    const opt = await Promise.race([api.optimize.runCash({ cash: true, ...params }), aborted])
    if (token !== seq) return null
    const result = opt.cash_lp ?? null
    emit({ ...state, running: false, result, opt, ranAt: Date.now(), error: result ? null : 'ответ без блока cash_lp' })
    return result
  } catch (e) {
    if (token !== seq) return null
    emit({ ...state, running: false, error: e instanceof Error ? e.message : 'Ошибка расчёта кассы' })
    return null
  }
}

/** «Отменить» расчёт кассы: ожидание прерывается, позднее пришедший ответ игнорируется, прежний результат остаётся. */
export function cancelCash(): void {
  if (!state.running) return
  seq += 1
  controller?.abort()
  controller = null
  emit({ ...state, running: false, error: null })
}

/** Только для тестов. */
export function resetCashStore(): void {
  seq += 1
  emit(INITIAL)
}
