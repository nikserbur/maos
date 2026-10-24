/**
 * Модульное хранилище экрана «План» (A1 H1): построенный план, ручные правки Ганта,
 * параметры запуска и активная программа переживают смену экрана — экран
 * размонтируется, а состояние остаётся здесь. Подписка — useSyncExternalStore.
 *
 * G3 (X1 §5 п. 2): результат переживает F5 и повторный вход — последние прогоны кэшируются
 * в localStorage (`readPlanCache`/`writePlanCache`, чистые функции), при старте экрана
 * `hydrate()` поднимает последний, а строка истории открывает любой из кэшированных.
 * Бэкенд хранит только KPI прогонов (kpi_series), полный ответ /api/schedule — нет.
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
  /** Начало горизонта (ISO-дата) — для оси дат Ганта; null — неизвестно. */
  startDate: string | null
  /** Результат поднят из кэша (не считался в этой сессии). */
  restored: boolean
  /** Адрес результата: plan_id бэкенда или `local-<время>` (маршрут `#/plan/run/<key>`). */
  resultKey: string | null
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
  startDate: null,
  restored: false,
  resultKey: null,
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

/* ── Кэш последних результатов (чистые функции над Storage) ─────────────── */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface CachedPlan {
  planId: string
  result: ScheduleResult
  builtAt: number
  startDate: string | null
}

export const PLAN_CACHE_KEY = 'maos.plan.results'
/** Сколько прогонов держим: ответ /api/schedule ~100–300 КБ, квота localStorage ~5 МБ. */
export const PLAN_CACHE_MAX = 3

const isCached = (x: unknown): x is CachedPlan => {
  if (!x || typeof x !== 'object') return false
  const c = x as Partial<CachedPlan>
  return typeof c.planId === 'string' && typeof c.builtAt === 'number' && !!c.result && typeof c.result === 'object'
    && Array.isArray((c.result as ScheduleResult).gantt) && !!(c.result as ScheduleResult).kpi
}

/** Список кэшированных прогонов, новые первыми; битый JSON — пустой список. */
export function readPlanCache(storage: StorageLike | null | undefined): CachedPlan[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(PLAN_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isCached) : []
  } catch {
    return []
  }
}

/** Добавить прогон в начало (дубликат по planId заменяется); при переполнении квоты — ужимаемся до одного. */
export function writePlanCache(storage: StorageLike | null | undefined, entry: CachedPlan, max = PLAN_CACHE_MAX): CachedPlan[] {
  if (!storage) return [entry]
  const next = [entry, ...readPlanCache(storage).filter((c) => c.planId !== entry.planId)].slice(0, max)
  for (let keep = next.length; keep >= 1; keep -= 1) {
    try {
      storage.setItem(PLAN_CACHE_KEY, JSON.stringify(next.slice(0, keep)))
      return next.slice(0, keep)
    } catch {
      // квота — пробуем меньше
    }
  }
  return []
}

const browserStorage = (): StorageLike | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Адрес результата (кэш и маршрут `#/plan/run/<key>`): plan_id бэкенда, иначе время построения. */
export const resultKeyOf = (r: ScheduleResult, builtAt: number): string => r.plan_id || `local-${builtAt}`

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

  /** Успешный расчёт: результат — в состояние и в кэш. Правки сохраняются: следующий пересчёт учитывает их все. */
  finishRun(token: number, result: ScheduleResult, meta: { startDate?: string | null; storage?: StorageLike | null } = {}): void {
    if (token !== runSeq) return
    const builtAt = Date.now()
    const startDate = meta.startDate ?? state.startDate
    const resultKey = resultKeyOf(result, builtAt)
    commit({ ...state, running: false, error: null, result, builtAt, startDate, restored: false, resultKey })
    writePlanCache(meta.storage === undefined ? browserStorage() : meta.storage, { planId: resultKey, result, builtAt, startDate })
  },

  /** Ошибка расчёта: прежний результат сохраняется, показывается ошибка. */
  failRun(token: number, error: string): void {
    if (token !== runSeq) return
    commit({ ...state, running: false, error })
  },

  /** Поднять последний кэшированный прогон, если в памяти результата нет. */
  hydrate(storage: StorageLike | null | undefined = browserStorage()): boolean {
    if (state.result || state.running) return false
    const last = readPlanCache(storage)[0]
    if (!last) return false
    commit({ ...state, result: last.result, builtAt: last.builtAt, startDate: last.startDate, restored: true, pins: EMPTY_PINS, error: null, resultKey: last.planId })
    return true
  },

  /** Открыть прогон из кэша по id (адрес `run/<id>`, строка истории); уже открытый — true без перерисовки; false — в кэше нет. */
  openCached(planId: string, storage: StorageLike | null | undefined = browserStorage()): boolean {
    if (state.result && state.resultKey === planId) return true
    const hit = readPlanCache(storage).find((c) => c.planId === planId)
    if (!hit) return false
    commit({ ...state, result: hit.result, builtAt: hit.builtAt, startDate: hit.startDate, restored: true, pins: EMPTY_PINS, error: null, resultKey: hit.planId })
    return true
  },

  /** Только для тестов. */
  reset(): void {
    runSeq += 1
    commit(initialState())
  },
}

/** Какие прогоны истории можно открыть целиком (есть в кэше). */
export function cachedPlanIds(storage: StorageLike | null | undefined = browserStorage()): ReadonlySet<string> {
  return new Set(readPlanCache(storage).map((c) => c.planId))
}
