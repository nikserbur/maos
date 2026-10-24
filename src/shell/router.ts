import { useCallback, useMemo, useSyncExternalStore } from 'react'

/**
 * Hash-маршрутизация (AUDIT §4.5, X2 «адрес — это состояние»): `#/<screenId>[/<anchor>][?query]`.
 * Всё, к чему стоит вернуться (вкладка, объект, прогон, фильтр), живёт в адресе: F5 восстанавливает вид.
 * Без hash — экран по умолчанию; неизвестные id разрешает AppShell (откат на схему).
 * Страж ухода: пока есть несохранённые изменения, переход спрашивает «уйти?» (useLeaveGuard).
 */
export const DEFAULT_SCREEN_ID = 'scheme'

export type HashParams = Readonly<Record<string, string>>

export interface HashRoute {
  screenId: string
  anchor: string | null
  /** Параметры запроса после `?` (`#/admin?type=errors&q=…`). */
  params: HashParams
}

const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function parseQuery(query: string): HashParams {
  const out: Record<string, string> = {}
  if (!query) return out
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = safeDecode((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' ')).trim()
    if (!key) continue
    out[key] = safeDecode((eq < 0 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' '))
  }
  return out
}

function buildQuery(params?: Readonly<Record<string, string | null | undefined>>): string {
  if (!params) return ''
  const parts = Object.entries(params)
    .filter(([k, v]) => k && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

/** `#/methodology/cvar-tail?x=1` → { screenId: 'methodology', anchor: 'cvar-tail', params: { x: '1' } }. */
export function parseHash(hash: string): HashRoute {
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '')
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  const params = parseQuery(q < 0 ? '' : raw.slice(q + 1))
  if (!path) return { screenId: DEFAULT_SCREEN_ID, anchor: null, params }
  const slash = path.indexOf('/')
  const screenId = safeDecode(slash < 0 ? path : path.slice(0, slash)).trim()
  const anchor = slash < 0 ? '' : safeDecode(path.slice(slash + 1)).trim()
  return { screenId: screenId || DEFAULT_SCREEN_ID, anchor: anchor || null, params }
}

/** { 'methodology', 'cvar-tail', { x: '1' } } → `#/methodology/cvar-tail?x=1`. */
export function buildHash(screenId: string, anchor?: string | null, params?: Readonly<Record<string, string | null | undefined>>): string {
  const base = `#/${encodeURIComponent(screenId)}`
  // Якорь может быть вложенным («new/launch» у мастера плана): «/» остаётся разделителем, кодируются сегменты.
  const path = anchor ? `${base}/${anchor.split('/').map(encodeURIComponent).join('/')}` : base
  return path + buildQuery(params)
}

/* ── Якорь: сегменты ──────────────────────────────────────────────────────── */

/** `run/28/moves` → ['run', '28', 'moves']; пустой якорь → []. */
export function anchorParts(anchor: string | null | undefined): string[] {
  return (anchor ?? '').split('/').map((p) => p.trim()).filter(Boolean)
}

/** ['run', 28, undefined] → `run/28` (пустые сегменты отбрасываются). */
export function joinAnchor(...parts: ReadonlyArray<string | number | null | undefined>): string {
  return parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== '').map(String).join('/')
}

/* ── Страж несохранённых изменений ───────────────────────────────────────── */

export const LEAVE_MESSAGE = 'Есть несохранённые изменения — уйти?'

interface LeaveGuard { dirty: () => boolean; message: string }

const guards = new Map<number, LeaveGuard>()
let guardSeq = 0
let lastHash = typeof window !== 'undefined' ? window.location.hash : ''

/** Зарегистрировать страж (useLeaveGuard); возвращает снятие. */
export function registerLeaveGuard(dirty: () => boolean, message = LEAVE_MESSAGE): () => void {
  const id = ++guardSeq
  guards.set(id, { dirty, message })
  return () => { guards.delete(id) }
}

/** Активный страж (есть несохранённое) — для beforeunload и перехвата перехода. */
export function blockingGuard(): LeaveGuard | undefined {
  for (const g of guards.values()) if (g.dirty()) return g
  return undefined
}

/** Спросить разрешения на уход; без несохранённого — сразу да. */
export function confirmLeave(confirmFn: (msg: string) => boolean = (m) => window.confirm(m)): boolean {
  const g = blockingGuard()
  return g ? confirmFn(g.message) : true
}

// Перехват до подписчиков React: слушатель ставится при загрузке модуля (первым). Отказ — адрес
// возвращается без новой записи истории, остальные слушатели событие не получают.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', (e) => {
    const next = window.location.hash
    if (next !== lastHash && blockingGuard() && !confirmLeave()) {
      e.stopImmediatePropagation()
      window.history.replaceState(window.history.state, '', lastHash || '#')
      return
    }
    lastHash = next
  })
}

/* ── Переходы ─────────────────────────────────────────────────────────────── */

/** Переход: новая запись истории (работает «Назад»); повтор того же адреса снова оповещает слушателей. */
export function navigateTo(screenId: string, anchor?: string | null, params?: Readonly<Record<string, string | null | undefined>>): void {
  const next = buildHash(screenId, anchor, params)
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
}

/** Замена адреса без новой записи истории (нормализация неизвестного экрана). */
export function replaceRoute(screenId: string, anchor?: string | null, params?: Readonly<Record<string, string | null | undefined>>): void {
  const next = buildHash(screenId, anchor, params)
  if (window.location.hash !== next) {
    window.history.replaceState(window.history.state, '', next)
    lastHash = next
  }
}

/**
 * Обновить параметры запроса текущего маршрута: `null`/'' снимают ключ. По умолчанию — без записи
 * истории (фильтры, поиск), `{ replace: false }` — с записью (вкладка, которую хочется «Назад»).
 */
export function setHashParams(patch: Readonly<Record<string, string | null | undefined>>, opts: { replace?: boolean } = {}): void {
  const cur = parseHash(window.location.hash)
  const merged: Record<string, string | null | undefined> = { ...cur.params, ...patch }
  const next = buildHash(cur.screenId, cur.anchor, merged)
  if (window.location.hash === next) return
  if (opts.replace === false) {
    window.location.hash = next
    return
  }
  window.history.replaceState(window.history.state, '', next)
  lastHash = next
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getSnapshot = (): string => window.location.hash

export interface UseHashRoute extends HashRoute {
  navigate: (screenId: string, anchor?: string, params?: Readonly<Record<string, string | null | undefined>>) => void
}

/** Текущий маршрут из `location.hash` + функция перехода. */
export function useHashRoute(): UseHashRoute {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '')
  const navigate = useCallback((screenId: string, anchor?: string, params?: Readonly<Record<string, string | null | undefined>>) => navigateTo(screenId, anchor, params), [])
  const route = useMemo(() => parseHash(hash), [hash])
  return { ...route, navigate }
}

/** Параметры запроса текущего маршрута и их установка (фильтры, поиск, выбранный объект). */
export function useHashParams(): [HashParams, typeof setHashParams] {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '')
  const params = useMemo(() => parseHash(hash).params, [hash])
  return [params, setHashParams]
}
