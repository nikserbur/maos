/**
 * Контекст решения (UX-V2 §2.5): какой сценарий, портфель и план сейчас «в работе».
 * Один объект на всё приложение (useSyncExternalStore, как optStore), переживает
 * смену экрана и перезагрузку (localStorage). Экраны пишут сюда, когда пользователь
 * открывает сценарий или получает результат; карта и полоса методологии читают.
 */
import { useSyncExternalStore } from 'react'

export interface DecisionContext {
  scenarioId?: string
  portfolioRunId?: string
  planId?: string
  scheduleRunId?: string
  cashRunId?: string
}

const LS_KEY = 'maos.decision-context'
const KEYS: ReadonlyArray<keyof DecisionContext> = ['scenarioId', 'portfolioRunId', 'planId', 'scheduleRunId', 'cashRunId']

function read(): DecisionContext {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: DecisionContext = {}
    for (const key of KEYS) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'string' && v) out[key] = v
    }
    return out
  } catch {
    return {}
  }
}

function persist(ctx: DecisionContext): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ctx))
  } catch {
    /* приватный режим — контекст живёт до перезагрузки */
  }
}

let state: DecisionContext = typeof localStorage === 'undefined' ? {} : read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): DecisionContext => state

export function getDecisionContext(): DecisionContext {
  return state
}

export function useDecisionContext(): DecisionContext {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Иммутабельное обновление; пустая строка/undefined снимает поле. Без изменений — без оповещения. */
export function setDecisionContext(patch: Partial<DecisionContext>): void {
  const next: DecisionContext = { ...state }
  let changed = false
  for (const key of KEYS) {
    if (!(key in patch)) continue
    const value = patch[key] || undefined
    if (next[key] === value) continue
    if (value === undefined) delete next[key]
    else next[key] = value
    changed = true
  }
  if (!changed) return
  state = next
  persist(next)
  listeners.forEach((l) => l())
}

/* ── Когда менялись входы (X2 «устарело ▲»): сценарий, справочники ─────────
 * Экран, сохранивший сценарий или НСИ, отмечает время; полоса методологии сравнивает его со
 * временем расчёта портфеля/плана и показывает «портфель ▲ устарело». Переживает перезагрузку. */

export type InputKind = 'scenario' | 'nsi'
export type InputsChanged = Readonly<Partial<Record<InputKind, number>>>

const CHANGED_KEY = 'maos.inputs-changed'

function readChanged(): InputsChanged {
  try {
    const raw = localStorage.getItem(CHANGED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<InputKind, number>> = {}
    for (const k of ['scenario', 'nsi'] as const) {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

let changed: InputsChanged = typeof localStorage === 'undefined' ? {} : readChanged()
const changedListeners = new Set<() => void>()

/** Отметить изменение входа (после сохранения сценария или записи НСИ). */
export function markInputsChanged(kind: InputKind, at: number = Date.now()): void {
  changed = { ...changed, [kind]: at }
  try { localStorage.setItem(CHANGED_KEY, JSON.stringify(changed)) } catch { /* приватный режим */ }
  changedListeners.forEach((l) => l())
}

function subscribeChanged(l: () => void): () => void {
  changedListeners.add(l)
  return () => { changedListeners.delete(l) }
}
const changedSnapshot = (): InputsChanged => changed

export function useInputsChanged(): InputsChanged {
  return useSyncExternalStore(subscribeChanged, changedSnapshot, changedSnapshot)
}

/** Устарел ли результат: вход изменился позже расчёта. */
export function isStale(resultAt: number | null | undefined, inputAt: number | null | undefined): boolean {
  return typeof resultAt === 'number' && typeof inputAt === 'number' && inputAt > resultAt
}
