/**
 * Текущая сессия (сохраняется окном входа в sessionStorage): логин, роль, права, цех.
 * Права здесь — только для интерфейса (что показывать); сервер проверяет их сам (deny-by-default).
 */

export interface SessionInfo {
  login: string
  role: string
  permissions: string[]
  /** Цех пользователя — область права найма начальника цеха; пусто — не привязан. */
  orgUnitId: string
}

const KEY = 'maos.session'

/** Разбор сохранённой сессии; повреждённые/пустые данные — сессия без прав. */
export function parseSession(raw: string | null): SessionInfo {
  try {
    const s = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    return {
      login: String(s.login ?? ''),
      role: String(s.role ?? ''),
      permissions: Array.isArray(s.permissions) ? s.permissions.map(String) : [],
      orgUnitId: String(s.org_unit_id ?? ''),
    }
  } catch {
    return { login: '', role: '', permissions: [], orgUnitId: '' }
  }
}

export function currentSession(): SessionInfo {
  try { return parseSession(sessionStorage.getItem(KEY)) } catch { return parseSession(null) }
}

export const can = (perm: string, s: SessionInfo = currentSession()) => s.permissions.includes(perm)

/**
 * Режим справочника «Рабочие» для пользователя:
 * full — правит весь НСИ (EDIT_NSI); shop — нанимает/переводит/увольняет только в своём цехе
 * (HIRE_WORKERS без EDIT_NSI); read — только просмотр.
 */
export type WorkerAccess = 'full' | 'shop' | 'read'

export function workerAccess(s: SessionInfo = currentSession()): WorkerAccess {
  if (s.permissions.includes('EDIT_NSI')) return 'full'
  if (s.permissions.includes('HIRE_WORKERS')) return 'shop'
  return 'read'
}

/* ── Жизненный цикл сессии (X2: F5 не выкидывает на вход, истечение — модалкой) ── */

const TOKEN_KEY = 'maos.token'
/** Проект последнего входа: окно входа и «Выйти»/«Сменить проект» предвыбирают его. */
const PROJECT_KEY = 'maos.project'
/** Событие api.ts: сервер ответил 401 на запрос с токеном — сессия истекла. */
export const SESSION_EXPIRED_EVENT = 'maos:session-expired'
/** Событие «Выйти»: App возвращается на окно входа. */
export const LOGOUT_EVENT = 'maos:logout'

export interface LoginResult { token: string; login: string; role: string; permissions: string[]; org_unit_id?: string }

export function hasStoredToken(): boolean {
  try { return Boolean(sessionStorage.getItem(TOKEN_KEY)) } catch { return false }
}

/** Сохранить ответ входа: токен (Bearer для всех запросов), сессию для интерфейса и проект. */
export function storeSession(res: LoginResult, project?: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, res.token)
    sessionStorage.setItem(KEY, JSON.stringify({ login: res.login, role: res.role, permissions: res.permissions, org_unit_id: res.org_unit_id ?? '' }))
  } catch { /* приватный режим: сессия живёт в памяти вкладки до перезагрузки */ }
  if (project) rememberProject(project)
}

export function clearSession(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(KEY) } catch { /* noop */ }
}

export function rememberProject(project: string): void {
  try { localStorage.setItem(PROJECT_KEY, project) } catch { /* noop */ }
}

export function lastProject(): string {
  try { return localStorage.getItem(PROJECT_KEY) ?? '' } catch { return '' }
}

export type SessionCheck = 'valid' | 'invalid' | 'offline'

/**
 * Проверка сохранённого токена один раз при загрузке: дешёвый GET под авторизацией.
 * 401 — токен устарел (сервер перезапущен); сеть недоступна — не выкидываем, экран покажет «нет связи».
 */
export async function checkStoredSession(fetchImpl: typeof fetch = fetch): Promise<SessionCheck> {
  let token = ''
  try { token = sessionStorage.getItem(TOKEN_KEY) ?? '' } catch { /* noop */ }
  if (!token) return 'invalid'
  try {
    const res = await fetchImpl('/api/calendar', { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) { clearSession(); return 'invalid' }
    return 'valid'
  } catch {
    return 'offline'
  }
}

/** «Выйти»: сессия очищается, App возвращается на окно входа с предвыбранным проектом. */
export function logout(): void {
  clearSession()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOGOUT_EVENT))
}

/** Подписка на событие окна (истечение сессии, выход); возвращает отписку. */
export function onWindowEvent(name: string, handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}
