/**
 * Хранилище полномочий агента (UX-V2 §4.10): ключ `agent_guardrails` в KV-настройках проекта
 * (`PUT /api/prefs/:key`, как пресеты эвристик), запасной localStorage с пометкой «локально».
 * Иммутабельно, useSyncExternalStore; α в хранилище не правится — читается из сценария при показе.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, type AgentGuardrails } from '../../lib/api'
import { defaultGuardrails, parseGuardrails } from './guardrails'

export const GUARDRAILS_KEY = 'agent_guardrails'
const LS_KEY = 'maos.agent_guardrails'

export type GuardrailsSource = 'project' | 'local' | 'default'

export interface GuardrailsState {
  value: AgentGuardrails
  source: GuardrailsSource
  loaded: boolean
  saving: boolean
}

let state: GuardrailsState = { value: defaultGuardrails(0.1), source: 'default', loaded: false, saving: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function commit(next: GuardrailsState): void {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): GuardrailsState => state

function readLocal(alpha: number): AgentGuardrails | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? parseGuardrails(JSON.parse(raw), alpha) : null
  } catch {
    return null
  }
}
function writeLocal(g: AgentGuardrails): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(g)) } catch { /* приватный режим */ }
}

/** Загрузить из проекта; при сбое — локальная копия; иначе умолчания. */
export function ensureGuardrails(alpha: number): Promise<void> {
  if (inflight) return inflight
  if (state.loaded) return Promise.resolve()
  inflight = api.prefs.get<unknown>(GUARDRAILS_KEY)
    .then((raw) => {
      const parsed = parseGuardrails(raw, alpha)
      commit({ ...state, value: parsed ?? readLocal(alpha) ?? defaultGuardrails(alpha), source: parsed ? 'project' : readLocal(alpha) ? 'local' : 'default', loaded: true })
    })
    .catch(() => {
      const local = readLocal(alpha)
      commit({ ...state, value: local ?? defaultGuardrails(alpha), source: local ? 'local' : 'default', loaded: true })
    })
    .finally(() => { inflight = null })
  return inflight
}

/** Сохранить: локально сразу, в проект — асинхронно; источник отражает, куда записалось. */
export async function saveGuardrails(next: AgentGuardrails): Promise<void> {
  writeLocal(next)
  commit({ ...state, value: next, saving: true })
  try {
    await api.prefs.set(GUARDRAILS_KEY, next)
    commit({ ...state, source: 'project', saving: false })
  } catch {
    commit({ ...state, source: 'local', saving: false })
  }
}

/** Подписка + однократная загрузка из проекта (α в умолчаниях не используется — читается из сценария). */
export function useGuardrails(): GuardrailsState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => { void ensureGuardrails(0.1) }, [])
  return s
}

export function getGuardrails(): AgentGuardrails {
  return state.value
}

/** Только для тестов. */
export function resetGuardrailsStore(): void {
  state = { value: defaultGuardrails(0.1), source: 'default', loaded: false, saving: false }
}
