/**
 * Статус политики RL (`GET /api/rl/status`, волна A): один модульный кэш на экран «Агенты», шаг
 * «Цель и риск» мастера, узел [6] карты и полосу методологии. Честная граница: `available=false`
 * означает «правило RL недоступно — чемпион по гейту §7.4 — лучшее правило» (A1 §5–6).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, type RlStatus } from '../../lib/api'

export type RlLoad = 'idle' | 'loading' | 'ready' | 'error'

export interface RlStatusState {
  load: RlLoad
  status: RlStatus | null
  error: string | null
  loadedAt: number | null
}

const TTL_MS = 60_000

let state: RlStatusState = { load: 'idle', status: null, error: null, loadedAt: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function commit(next: RlStatusState): void {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): RlStatusState => state

export function ensureRlStatus(force = false): Promise<void> {
  if (inflight) return inflight
  const fresh = state.loadedAt !== null && Date.now() - state.loadedAt < TTL_MS
  if (fresh && !force) return Promise.resolve()
  commit({ ...state, load: state.status ? state.load : 'loading' })
  inflight = api.rl.status()
    .then((status) => commit({ load: 'ready', status, error: null, loadedAt: Date.now() }))
    .catch((e: unknown) => commit({ ...state, load: 'error', error: e instanceof Error ? e.message : 'нет связи с сервером', loadedAt: Date.now() }))
    .finally(() => { inflight = null })
  return inflight
}

export function useRlStatus(): RlStatusState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => { void ensureRlStatus() }, [])
  return s
}

export function getRlStatus(): RlStatusState {
  return state
}

/** Правило «RL» можно выбирать: сервер собран с onnxruntime и политика L0 опубликована. */
export function rlAvailable(s: RlStatus | null): boolean {
  return Boolean(s && s.available && s.onnxruntime && s.l0.ok)
}

/** Короткая честная причина недоступности для подписей (мастер, карта). */
export function rlReason(s: RlStatusState): string {
  if (s.load === 'error') return s.error ? `статус политики недоступен: ${s.error}` : 'статус политики недоступен'
  if (!s.status) return 'статус политики ещё не получен'
  if (!s.status.onnxruntime) return 'сервер собран без onnxruntime (MAOS_WITH_ONNX=OFF)'
  if (!s.status.l0.ok) return 'политика не прошла гейт §7.4 — чемпион: лучшее правило; файл l0_policy.onnx не опубликован'
  return 'политика L0 опубликована'
}

export const shortSha = (sha: string): string => (sha ? sha.slice(0, 10) : '—')

/** Только для тестов. */
export function resetRlStatusStore(): void {
  state = { load: 'idle', status: null, error: null, loadedAt: null }
}
