/**
 * Связь с сервером и текущий проект (GET /api/health): один опрос на приложение, общий для
 * статус-бара и меню учётной записи. Опрос идёт, пока есть подписчики; «Повторить» — сразу.
 */
import { useSyncExternalStore } from 'react'
import { api } from '../lib/api'

export type Connection = 'checking' | 'online' | 'offline'

export interface Health {
  connection: Connection
  project: string | null
  /** Версия сервера из /api/health — сверяется с версией интерфейса (устаревший сервер разработки). */
  serverVersion: string | null
}

const HEALTH_POLL_MS = 30_000

let health: Health = { connection: 'checking', project: null, serverVersion: null }
const listeners = new Set<() => void>()
let timer: number | null = null

/** «./data/Завод.db» → «Завод». */
export function projectName(path: unknown): string | null {
  if (typeof path !== 'string' || !path.trim()) return null
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.db$/i, '') || null
}

function emit(next: Health): void {
  if (next.connection === health.connection && next.project === health.project && next.serverVersion === health.serverVersion) return
  health = next
  listeners.forEach((l) => l())
}

/** Проверить связь сейчас (кнопка «Повторить» статус-бара). */
export function checkHealth(): void {
  api.health()
    .then((res) => emit({
      connection: 'online',
      project: projectName(res.project) ?? health.project,
      serverVersion: typeof res.version === 'string' && res.version.trim() ? res.version.trim() : null,
    }))
    .catch(() => emit({ ...health, connection: 'offline' }))
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    checkHealth()
    timer = window.setInterval(checkHealth, HEALTH_POLL_MS)
  }
  return () => {
    listeners.delete(l)
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}

const snapshot = (): Health => health

export function useBackendHealth(): Health {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
