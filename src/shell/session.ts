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
