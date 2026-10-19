import { useCallback, useSyncExternalStore } from 'react'

/**
 * Hash-маршрутизация (AUDIT §4.5): `#/<screenId>[/<anchor>]`.
 * Без hash — экран по умолчанию; неизвестные id разрешает AppShell (откат на схему).
 */
export const DEFAULT_SCREEN_ID = 'scheme'

export interface HashRoute {
  screenId: string
  anchor: string | null
}

const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** `#/methodology/cvar-tail` → { screenId: 'methodology', anchor: 'cvar-tail' }. */
export function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '')
  if (!path) return { screenId: DEFAULT_SCREEN_ID, anchor: null }
  const slash = path.indexOf('/')
  const screenId = safeDecode(slash < 0 ? path : path.slice(0, slash)).trim()
  const anchor = slash < 0 ? '' : safeDecode(path.slice(slash + 1)).trim()
  return { screenId: screenId || DEFAULT_SCREEN_ID, anchor: anchor || null }
}

/** { 'methodology', 'cvar-tail' } → `#/methodology/cvar-tail`. */
export function buildHash(screenId: string, anchor?: string | null): string {
  const base = `#/${encodeURIComponent(screenId)}`
  return anchor ? `${base}/${encodeURIComponent(anchor)}` : base
}

/** Переход: новая запись истории (работает «Назад»); повтор того же адреса снова оповещает слушателей. */
export function navigateTo(screenId: string, anchor?: string | null): void {
  const next = buildHash(screenId, anchor)
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
}

/** Замена адреса без новой записи истории (нормализация неизвестного экрана). */
export function replaceRoute(screenId: string, anchor?: string | null): void {
  const next = buildHash(screenId, anchor)
  if (window.location.hash !== next) window.history.replaceState(window.history.state, '', next)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getSnapshot = (): string => window.location.hash

export interface UseHashRoute extends HashRoute {
  navigate: (screenId: string, anchor?: string) => void
}

/** Текущий маршрут из `location.hash` + функция перехода. */
export function useHashRoute(): UseHashRoute {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '')
  const navigate = useCallback((screenId: string, anchor?: string) => navigateTo(screenId, anchor), [])
  return { ...parseHash(hash), navigate }
}
