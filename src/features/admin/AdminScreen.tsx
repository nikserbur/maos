import { useEffect, useState } from 'react'
import { api, type AuditAction, type User, type Role } from '../../lib/api'
import './admin.css'

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'создание', UPDATE: 'изменение', DELETE: 'удаление',
  RUN: 'прогон', LOGIN: 'вход',
}
const actionTone = (t: string) =>
  t === 'DELETE' ? 'var(--intent-danger)' : t === 'CREATE' ? 'var(--intent-success)'
    : t === 'RUN' ? 'var(--accent)' : 'var(--text-secondary)'

export function AdminScreen() {
  const [actions, setActions] = useState<AuditAction[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    api.actions.list(200).then(setActions).catch(() => {})
    api.admin.users().then(setUsers).catch(() => {})
    api.admin.roles().then(setRoles).catch(() => {})
  }, [])

  const shown = actions.filter((a) =>
    !filter || a.entity_type.includes(filter) || a.action_type.includes(filter))

  const perms = (raw: string): string[] => {
    try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : [] } catch { return [] }
  }

  return (
    <div className="adm">
      <div className="adm__head">
        <h1 className="adm__title">Администрирование</h1>
        <p className="adm__subtitle">
          Слой действий (Action layer): каждое изменение НСИ, прогон оптимизации и
          расписания фиксируется в журнале событий. Ниже — журнал, пользователи и роли (RBAC).
        </p>
      </div>

      <div className="adm__grid">
        <section className="adm__panel adm__panel--wide">
          <div className="adm__panel-head">
            <span className="adm__panel-title">Журнал действий ({shown.length})</span>
            <input className="adm__filter" placeholder="фильтр по сущности/типу"
                   value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="adm__log">
            {shown.map((a) => (
              <div className="adm__log-row" key={a.id}>
                <span className="adm__log-ts mono">{a.ts}</span>
                <span className="adm__log-act" style={{ color: actionTone(a.action_type) }}>
                  {ACTION_LABEL[a.action_type] ?? a.action_type}
                </span>
                <span className="adm__log-ent">{a.entity_type}</span>
                <span className="adm__log-actor mono">{a.actor}</span>
              </div>
            ))}
            {shown.length === 0 && <div className="adm__empty">Записей нет.</div>}
          </div>
        </section>

        <section className="adm__panel">
          <div className="adm__panel-title">Пользователи ({users.length})</div>
          {users.map((u) => (
            <div className="adm__user" key={u.id}>
              <div>
                <div className="adm__user-login">{u.login}</div>
                <div className="adm__user-role">{u.role_name || '—'}</div>
              </div>
              <span className={`adm__badge${u.status === 'active' ? ' adm__badge--ok' : ''}`}>{u.status}</span>
            </div>
          ))}
          {users.length === 0 && <div className="adm__empty">Нет пользователей.</div>}
        </section>

        <section className="adm__panel">
          <div className="adm__panel-title">Роли и права (RBAC)</div>
          {roles.map((r) => (
            <div className="adm__role" key={r.id}>
              <div className="adm__role-name">{r.name}</div>
              <div className="adm__perms">
                {perms(r.permissions).map((p) => <span className="adm__perm" key={p}>{p}</span>)}
              </div>
            </div>
          ))}
          {roles.length === 0 && <div className="adm__empty">Нет ролей.</div>}
        </section>
      </div>
    </div>
  )
}
