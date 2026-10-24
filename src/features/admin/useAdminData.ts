/**
 * Данные «Администрирования» (X2 P-134 «ошибка — не пустота»): у каждой панели своё состояние
 * загрузка / готово / ошибка, перезапрос без мигания (прежние данные остаются до ответа),
 * гонки отсекаются номером запроса. Ошибка хранится как есть — текст делает errorText кита.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AuditAction, type OrgUnit, type Role, type User } from '../../lib/api'
import { ensureRefs, useRefs } from '../method-map/useMethodMapState'
import type { NameIndex } from './auditVocabulary'

export type LoadStatus = 'loading' | 'ok' | 'error'

export interface Resource<T> {
  status: LoadStatus
  data: T
  error: unknown
  reload: () => void
}

/** Один ресурс: load вызывается при монтировании и при смене key; reload — по «Повторить». */
export function useResource<T>(load: () => Promise<T>, initial: T, key: string | number = 0): Resource<T> {
  const [state, setState] = useState<{ status: LoadStatus; data: T; error: unknown }>({ status: 'loading', data: initial, error: null })
  const seq = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(() => {
    const id = ++seq.current
    setState((s) => ({ ...s, status: 'loading', error: null }))
    loadRef.current()
      .then((data) => { if (id === seq.current) setState({ status: 'ok', data, error: null }) })
      .catch((error: unknown) => { if (id === seq.current) setState((s) => ({ ...s, status: 'error', error })) })
  }, [])

  useEffect(() => { reload() }, [reload, key])
  return { ...state, reload }
}

/** Сколько записей журнала грузить за раз («Загрузить ещё» добавляет столько же). */
export const LOG_PAGE = 200

export interface AdminData {
  log: Resource<AuditAction[]>
  users: Resource<User[]>
  roles: Resource<Role[]>
  orgUnits: Resource<OrgUnit[]>
  limit: number
  loadMore: () => void
  names: NameIndex
}

const EMPTY: never[] = []

export function useAdminData(): AdminData {
  const [limit, setLimit] = useState(LOG_PAGE)
  const log = useResource(() => api.actions.list(limit), EMPTY as AuditAction[], limit)
  const users = useResource(() => api.admin.users(), EMPTY as User[])
  const roles = useResource(() => api.admin.roles(), EMPTY as Role[])
  const orgUnits = useResource(() => api.orgUnits.list(), EMPTY as OrgUnit[])
  const refs = useRefs()

  // Имена сценариев — из общего кэша справочников (TTL); без него журнал покажет имя из снимка или короткий id.
  useEffect(() => { void ensureRefs() }, [])

  const names = useMemo<NameIndex>(() => ({
    users: new Map(users.data.map((u) => [u.id, u.login])),
    scenarios: new Map(refs.scenarios.map((s) => [s.id, s.name])),
    roles: new Map(roles.data.map((r) => [r.id, r.name])),
    orgUnits: new Map(orgUnits.data.map((o) => [o.id, o.name])),
  }), [users.data, refs.scenarios, roles.data, orgUnits.data])

  const loadMore = useCallback(() => setLimit((l) => l + LOG_PAGE), [])
  return { log, users, roles, orgUnits, limit, loadMore, names }
}
