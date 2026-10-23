import { useEffect, useMemo, useState } from 'react'
import { api, type AuditAction, type User, type Role, type OrgUnit, type UserCreate } from '../../lib/api'
import { UserDialog, roleNeedsShop } from './UserDialog'
import { dateTime, num } from '../../explain/format'
import { Chip, DataTable, ScreenHeader, Segmented, type ChipTone, type DataColumn } from '../../ui/kit'
import './admin.css'

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'создание', UPDATE: 'изменение', DELETE: 'удаление',
  RUN: 'прогон', LOGIN: 'вход',
}
/** Цвет несёт только «удаление» (необратимое); остальные типы действий — нейтральный чип. */
const ACTION_TONE: Record<string, ChipTone> = { DELETE: 'down' }
/** Сколько прав роли показывать чипами; остальные — «+N». */
const PERMS_SHOWN = 3

type ActionFilter = 'all' | 'CREATE' | 'UPDATE' | 'DELETE' | 'RUN' | 'LOGIN'
const FILTERS: ReadonlyArray<{ id: ActionFilter; label: string }> = [
  { id: 'all', label: 'Все' }, { id: 'CREATE', label: 'Создание' }, { id: 'UPDATE', label: 'Изменение' },
  { id: 'DELETE', label: 'Удаление' }, { id: 'RUN', label: 'Прогоны' }, { id: 'LOGIN', label: 'Входы' },
]

const LOG_COLUMNS: DataColumn<AuditAction>[] = [
  { key: 'ts', title: 'Когда', num: true, get: (a) => a.ts, render: (a) => dateTime(a.ts), className: 'adm__ts' },
  { key: 'action_type', title: 'Действие', get: (a) => ACTION_LABEL[a.action_type] ?? a.action_type,
    render: (a) => <Chip tone={ACTION_TONE[a.action_type] ?? 'idle'} size="sm">{ACTION_LABEL[a.action_type] ?? a.action_type.toLowerCase()}</Chip> },
  { key: 'entity_type', title: 'Сущность', rowHeader: true, render: (a) => a.entity_type.toLowerCase() },
  { key: 'actor', title: 'Кто', render: (a) => <span className="mono">{a.actor}</span> },
]

/** Колонки пользователей: роль и цех меняются прямо в строке (PUT /api/users/:id). */
function userColumns(roles: Role[], orgUnits: OrgUnit[], onPatch: (u: User, patch: { role_id?: string; org_unit_id?: string }) => void): DataColumn<User>[] {
  return [
    { key: 'login', title: 'Логин', rowHeader: true },
    { key: 'role_name', title: 'Роль', get: (u) => u.role_name, render: (u) => (
      <select className="form__select adm__select" aria-label={`Роль ${u.login}`} value={u.role_id ?? ''}
              disabled={u.login === 'admin'} onChange={(e) => onPatch(u, { role_id: e.target.value })}>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    ) },
    { key: 'org_unit_id', title: 'Цех', get: (u) => orgUnits.find((o) => o.id === u.org_unit_id)?.name ?? '', render: (u) => (
      roleNeedsShop(roles.find((r) => r.id === u.role_id)) || u.org_unit_id ? (
        <select className="form__select adm__select" aria-label={`Цех ${u.login}`} value={u.org_unit_id ?? ''}
                onChange={(e) => onPatch(u, { org_unit_id: e.target.value })}>
          <option value="">— не привязан —</option>
          {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : <span className="adm__muted">—</span>
    ) },
    { key: 'status', title: 'Статус', render: (u) => <Chip tone={u.status === 'active' ? 'running' : 'idle'} size="sm">{u.status === 'active' ? 'активен' : u.status}</Chip> },
  ]
}

/** Журнал группируется по дню (липкие подзаголовки). */
const dayOf = (a: AuditAction) => dateTime(a.ts, { time: false })

export function AdminScreen() {
  const [actions, setActions] = useState<AuditAction[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [filter, setFilter] = useState<ActionFilter>('all')
  const [query, setQuery] = useState('')
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([])
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [userError, setUserError] = useState<string | null>(null)

  const reloadUsers = () => api.admin.users().then(setUsers).catch(() => {})
  useEffect(() => {
    api.actions.list(200).then(setActions).catch(() => {})
    reloadUsers()
    api.admin.roles().then(setRoles).catch(() => {})
    api.orgUnits.list().then(setOrgUnits).catch(() => {})
  }, [])

  const patchUser = (u: User, patch: { role_id?: string; org_unit_id?: string }) => {
    setUserError(null)
    api.admin.updateUser(u.id, patch)
      .then(reloadUsers)
      .catch((e) => setUserError(e instanceof Error ? e.message : 'Не удалось изменить пользователя'))
  }
  const createUser = (u: UserCreate) => {
    setBusy(true); setUserError(null)
    api.admin.createUser(u)
      .then(() => { setCreating(false); return reloadUsers() })
      .catch((e) => setUserError(e instanceof Error ? e.message : 'Не удалось создать пользователя'))
      .finally(() => setBusy(false))
  }
  const userCols = useMemo(() => userColumns(roles, orgUnits, patchUser), [roles, orgUnits])  // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => actions.filter((a) =>
    (filter === 'all' || a.action_type === filter)
    && (!query || a.entity_type.toLowerCase().includes(query.toLowerCase()) || a.actor.toLowerCase().includes(query.toLowerCase()))),
  [actions, filter, query])

  const perms = (raw: string): string[] => {
    try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : [] } catch { return [] }
  }

  return (
    <div className="adm">
      {creating && (
        <UserDialog roles={roles} orgUnits={orgUnits} busy={busy} error={userError}
                    onSubmit={createUser} onCancel={() => setCreating(false)} />
      )}
      <ScreenHeader
        eyebrow="Администрирование"
        title="Журнал и доступ"
        subtitle="Слой действий: каждое изменение НСИ, прогон оптимизации и расписания фиксируется в журнале событий. Ниже — журнал, пользователи и роли (RBAC)."
      />

      <div className="adm__grid">
        <section className="dk-card dk-card--flush adm__panel adm__panel--wide" aria-labelledby="adm-log-t">
          <div className="adm__panel-head">
            <h2 className="adm__panel-title text-caps" id="adm-log-t">Журнал действий <span className="num">{num(shown.length, 0)}</span></h2>
            <Segmented size="sm" fit label="Тип действия" options={FILTERS} value={filter} onChange={setFilter} />
            <input className="adm__filter" placeholder="сущность или пользователь" aria-label="Фильтр журнала"
                   value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <DataTable
            className="adm__log"
            columns={LOG_COLUMNS}
            rows={shown}
            rowKey={(a) => String(a.id)}
            groupBy={dayOf}
            tight
            caption="Журнал действий"
            empty="Записей нет."
          />
        </section>

        <section className="dk-card dk-card--flush adm__panel" aria-labelledby="adm-users-t">
          <div className="adm__panel-head">
            <h2 className="adm__panel-title text-caps" id="adm-users-t">Пользователи <span className="num">{num(users.length, 0)}</span></h2>
            <button type="button" className="btn btn--sm" onClick={() => { setUserError(null); setCreating(true) }}>Новый пользователь</button>
          </div>
          {userError && !creating && <div className="form__error adm__error">{userError}</div>}
          <DataTable columns={userCols} rows={users} rowKey={(u) => String(u.id)} tight caption="Пользователи" empty="Нет пользователей." />
        </section>

        <section className="dk-card adm__panel" aria-labelledby="adm-roles-t">
          <h2 className="adm__panel-title text-caps" id="adm-roles-t">Роли и права (RBAC)</h2>
          {roles.map((r) => {
            const list = perms(r.permissions)
            return (
              <div className="adm__role" key={r.id}>
                <div className="adm__role-name">{r.name}</div>
                <div className="adm__perms">
                  {list.slice(0, PERMS_SHOWN).map((p) => <span className="adm__perm mono" key={p}>{p}</span>)}
                  {list.length > PERMS_SHOWN && (
                    <span className="adm__perm adm__perm--more mono" title={list.slice(PERMS_SHOWN).join(', ')}>
                      +{list.length - PERMS_SHOWN}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {roles.length === 0 && <div className="adm__empty">Нет ролей.</div>}
        </section>
      </div>
    </div>
  )
}
