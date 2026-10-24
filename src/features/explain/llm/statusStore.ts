/**
 * Общий кэш статуса MENTAT (GET /api/mentat/status): его читают карта (узел [8] «MENTAT» — подключена ли
 * модель) и панель MENTAT. Один запрос на TTL; панель публикует сюда свежий статус после проверки или
 * сохранения настроек, чтобы карта сразу видела «модель подключена». Ошибка сети — `error`, а не «нет модели».
 */
import { useEffect, useSyncExternalStore } from 'react'
import { mentatApi, type MentatStatus } from './mentatApi'

export type MentatLoad = 'idle' | 'loading' | 'ready' | 'error'

export interface MentatStatusSnapshot {
  load: MentatLoad
  status: MentatStatus | null
  loadedAt: number | null
}

const TTL_MS = 60_000

let snap: MentatStatusSnapshot = { load: 'idle', status: null, loadedAt: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function commit(next: MentatStatusSnapshot): void {
  snap = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

const getSnapshot = (): MentatStatusSnapshot => snap

/** Свежий статус от панели (проверка соединения, сохранение настроек). */
export function publishMentatStatus(status: MentatStatus): void {
  commit({ load: 'ready', status, loadedAt: Date.now() })
}

export function ensureMentatStatus(force = false): Promise<void> {
  if (inflight) return inflight
  const fresh = snap.loadedAt !== null && Date.now() - snap.loadedAt < TTL_MS
  if (fresh && !force) return Promise.resolve()
  if (!snap.status) commit({ ...snap, load: 'loading' })
  inflight = mentatApi.status(false)
    .then((status) => publishMentatStatus(status))
    .catch((e: unknown) => {
      console.warn('MENTAT: статус не получен —', e)
      commit({ ...snap, load: 'error', loadedAt: Date.now() })
    })
    .finally(() => { inflight = null })
  return inflight
}

/** Статус MENTAT для карты: загружается один раз на TTL. */
export function useMentatStatusSnapshot(): MentatStatusSnapshot {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { void ensureMentatStatus() }, [])
  return s
}
