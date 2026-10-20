/**
 * Модульное хранилище экрана «План» (A1 H1): построенный план, ручные правки Ганта,
 * параметры запуска и активная программа переживают смену экрана — экран
 * размонтируется, а состояние остаётся здесь. Подписка — useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'
import type { ScheduleResult } from '../../lib/api'

export interface PlanParams {
  rule: string
  samples: string
  wRisk: string
  /** '' — реестр заказов; иначе id прогона Стадии 2 (портфель). */
  runId: string
  useCalendar: boolean
}

export interface PlanState {
  params: PlanParams
  activePlan: string
  result: ScheduleResult | null
  /** Ручные правки Ганта: job_idx → «не раньше», ч. */
  pins: ReadonlyMap<number, number>
  running: boolean
  error: string | null
  /** Когда построен текущий результат (ms epoch). */
  builtAt: number | null
}

export const INITIAL_PARAMS: PlanParams = { rule: 'auto', samples: '500', wRisk: '0.5', runId: '', useCalendar: true }

const EMPTY_PINS: ReadonlyMap<number, number> = new Map()

const initialState = (): PlanState => ({
  params: INITIAL_PARAMS,
  activePlan: '',
  result: null,
  pins: EMPTY_PINS,
  running: false,
  error: null,
  builtAt: null,
})

let state: PlanState = initialState()
let runSeq = 0
const listeners = new Set<() => void>()

function commit(next: PlanState): void {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}

export function getPlanState(): PlanState {
  return state
}

export function subscribePlan(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Снимок хранилища; ссылки на неизменённые части стабильны. */
export function usePlanStore(): PlanState {
  return useSyncExternalStore(subscribePlan, getPlanState, getPlanState)
}

export const planActions = {
  /** Смена программы (runId) сбрасывает ручные правки — они относятся к старым операциям. */
  setParam<K extends keyof PlanParams>(key: K, value: PlanParams[K]): void {
    if (state.params[key] === value) return
    const pins = key === 'runId' ? EMPTY_PINS : state.pins
    commit({ ...state, params: { ...state.params, [key]: value }, pins })
  },

  setActivePlan(id: string): void {
    if (state.activePlan === id) return
    commit({ ...state, activePlan: id, pins: EMPTY_PINS })
  },

  addPin(jobIdx: number, startHours: number): void {
    const pins = new Map(state.pins)
    pins.set(jobIdx, Math.max(0, startHours))
    commit({ ...state, pins })
  },

  clearPins(): void {
    if (state.pins.size === 0) return
    commit({ ...state, pins: EMPTY_PINS })
  },

  setError(error: string | null): void {
    if (state.error === error) return
    commit({ ...state, error })
  },

  /** Начало расчёта; возвращает токен — устаревшие ответы игнорируются. */
  beginRun(): number {
    runSeq += 1
    commit({ ...state, running: true, error: null })
    return runSeq
  },

  /** Успешный расчёт. Правки сохраняются: следующий пересчёт учитывает их все (как раньше). */
  finishRun(token: number, result: ScheduleResult): void {
    if (token !== runSeq) return
    commit({ ...state, running: false, error: null, result, builtAt: Date.now() })
  },

  /** Ошибка расчёта: прежний результат сохраняется, показывается ошибка. */
  failRun(token: number, error: string): void {
    if (token !== runSeq) return
    commit({ ...state, running: false, error })
  },

  /** Только для тестов. */
  reset(): void {
    runSeq += 1
    commit(initialState())
  },
}
