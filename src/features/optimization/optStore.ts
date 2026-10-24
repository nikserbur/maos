/**
 * Модульное хранилище экрана «Оптимизация» (useSyncExternalStore): параметры,
 * последний результат, статус прогона и ошибка переживают переключение экранов
 * (AppShell размонтирует неактивный экран). Обновления иммутабельные.
 */
import { useSyncExternalStore } from 'react'
import type { Objective, OptResultExt } from './optTypes'

export interface OptForm {
  scenarioId: string
  objective: Objective
  samples: string
  alpha: string
  maxShare: string
  /** Горизонт плана, мес → horizon_hours = мес × 720. */
  horizonMonths: string
  /** Запросить точное решение LP (HiGHS) рядом с эвристикой. */
  exact: boolean
}

export interface OptError {
  message: string
  /** validation — пустые справочники (повтор бесполезен); api — сбой запроса. */
  kind: 'validation' | 'api'
}

/** Критерий, унаследованный из сценария (UX-V2 §8 п. 3): форма показывает «из сценария» или «переопределено для прогона». */
export interface OptInherited {
  scenarioId: string
  scenarioName: string
  objective: Objective
  alpha: string
  maxShare: string
}

/** Откуда результат: только что рассчитан или восстановлен из истории прогонов (F5, X2 «конвейер переживает перезагрузку»). */
export type OptOrigin = 'run' | 'history'

export interface OptState {
  form: OptForm
  /** Значения критерия из открытого сценария; null — сценарий не загружен. */
  inherited: OptInherited | null
  result: OptResultExt | null
  running: boolean
  error: OptError | null
  /** Момент расчёта результата (мс), для подписи «рассчитано в …». */
  ranAt: number | null
  origin: OptOrigin | null
}

const INITIAL: OptState = {
  form: {
    scenarioId: '',
    objective: 'cvar',
    samples: '3000',
    alpha: '0.10',
    maxShare: '0.35',
    horizonMonths: '12',
    exact: false,
  },
  inherited: null,
  result: null,
  running: false,
  error: null,
  ranAt: null,
  origin: null,
}

let state: OptState = INITIAL
const listeners = new Set<() => void>()

function emit(next: OptState): void {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): OptState => state

export function useOptStore(): OptState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getOptState(): OptState {
  return state
}

export function patchOptForm(patch: Partial<OptForm>): void {
  emit({ ...state, form: { ...state.form, ...patch } })
}

/** Сценарий открыт: критерий/α/доля наследуются в форму (переопределения прогона сбрасываются при смене сценария). */
export function inheritCriterion(inh: OptInherited): void {
  const changedScenario = state.inherited?.scenarioId !== inh.scenarioId
  const form = changedScenario ? { ...state.form, objective: inh.objective, alpha: inh.alpha, maxShare: inh.maxShare } : state.form
  emit({ ...state, inherited: inh, form })
}

/** Какие поля критерия переопределены на прогон относительно сценария. */
export function criterionOverrides(s: OptState): { objective: boolean; alpha: boolean; maxShare: boolean } {
  const i = s.inherited
  if (!i) return { objective: false, alpha: false, maxShare: false }
  return {
    objective: s.form.objective !== i.objective,
    alpha: Number(s.form.alpha) !== Number(i.alpha),
    maxShare: Number(s.form.maxShare) !== Number(i.maxShare),
  }
}

export function startOptRun(): void {
  emit({ ...state, running: true, error: null })
}

/** Результат получен: новый прогон (время — сейчас) или прогон из истории (время — из журнала прогонов). */
export function finishOptRun(result: OptResultExt, opts: { origin?: OptOrigin; ranAt?: number | null } = {}): void {
  const origin = opts.origin ?? 'run'
  // Время прогона из истории неизвестно — «не сейчас», а пусто (честно: без выдуманной отметки).
  const ranAt = opts.ranAt ?? (origin === 'run' ? Date.now() : null)
  emit({ ...state, running: false, error: null, result, ranAt, origin })
}

export function failOptRun(error: OptError): void {
  emit({ ...state, running: false, error })
}

export function clearOptError(): void {
  if (state.error) emit({ ...state, error: null })
}
