/**
 * Статус политики RL (`GET /api/rl/status`, волна A): один модульный кэш на экран «Агенты», шаг
 * «Цель и риск» мастера, узел [6] карты, MENTAT (gate_a3) и полосу методологии. Честная граница:
 * `available=false` означает «правило RL недоступно — чемпион: эвристика C*» (A1 §5–6, A4).
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

/** Короткая честная причина недоступности для подписей (мастер, карта, панель ходов) — простыми словами. */
export function rlReason(s: RlStatusState): string {
  if (s.load === 'error') return 'сервер не ответил на запрос о политике — повторите позже'
  if (!s.status) return 'статус политики ещё не получен'
  if (!s.status.onnxruntime) return 'сервер собран без среды исполнения политик'
  if (!s.status.l0.ok) return 'политика не прошла строгий гейт на отложенных сценариях — чемпион: эвристика C*'
  return 'политика L0 опубликована'
}

/** Строки «Подробнее» о сервере: среда исполнения, файлы политик, каталог, ответ сервера. */
export function serverDetails(st: RlStatus): Array<{ k: string; v: string; mono?: boolean }> {
  const policy = (p: RlStatus['l0']) => (p.ok ? `опубликована · ${shortSha(p.sha256)}` : 'не опубликована')
  return [
    { k: 'Среда исполнения (onnxruntime)', v: st.onnxruntime ? 'собрана' : 'не собрана' },
    { k: 'Политика L0 · диспетчер', v: policy(st.l0) },
    { k: 'Политика L2 · планировщик', v: policy(st.l2) },
    ...(st.dir ? [{ k: 'Каталог политик', v: st.dir, mono: true }] : []),
    ...(st.error ? [{ k: 'Ответ сервера', v: st.error, mono: true }] : []),
  ]
}

export const shortSha = (sha: string): string => (sha ? sha.slice(0, 10) : '—')

/** Только для тестов. */
export function resetRlStatusStore(): void {
  state = { load: 'idle', status: null, error: null, loadedAt: null }
}
