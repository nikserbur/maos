/**
 * «Администрирование» (X2 P-133…P-145): кто, что и когда менял; пользователи и их права.
 * Раскладка — колонка во всю высоту: шапка, затем журнал (рамка таблицы заполняет остаток — одна
 * прокрутка) и справа стопкой «Пользователи» и «Роли и права». Запись журнала и пользователь
 * открываются в боковой панели рядом со списком; открытая запись — в адресе (?entry= / ?user=),
 * F5 возвращает тот же вид. У каждой панели — своё состояние загрузки и ошибки.
 */
import { useMemo, useState } from 'react'
import { api, type User, type UserCreate } from '../../lib/api'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { confirmLeave, useHashParams } from '../../shell/router'
import { screenTitle } from '../../shell/screens'
import { ScreenHeader } from '../../ui/kit'
import { AuditEntryPanel } from './AuditEntryPanel'
import { AuditLog, buildLogRows, type LogRow } from './AuditLog'
import { RolesMatrix } from './RolesMatrix'
import { UserDialog } from './UserDialog'
import { UserPanel } from './UserPanel'
import { UsersSection } from './UsersSection'
import { useAdminData } from './useAdminData'
import './admin.css'

export function AdminScreen() {
  const data = useAdminData()
  const { log, users, roles, orgUnits, names } = data
  const [params, setParams] = useHashParams()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)

  const entryId = params.entry ?? null
  const userId = params.user ?? null
  const entry = useMemo(() => {
    const a = entryId ? log.data.find((x) => x.id === entryId) : undefined
    return a ? buildLogRows([a], names)[0] : null
  }, [entryId, log.data, names])
  const openUser = userId ? users.data.find((u) => u.id === userId) ?? null : null

  /** Открыть другую панель: несохранённую правку пользователя не теряем молча. */
  const open = (patch: { entry?: string | null; user?: string | null }) => {
    if (!confirmLeave()) return
    setParams({ entry: patch.entry ?? null, user: patch.user ?? null })
  }
  const close = () => setParams({ entry: null, user: null })

  const createUser = (u: UserCreate) => {
    setBusy(true)
    setCreateError(null)
    api.admin.createUser(u)
      .then(() => { setCreating(false); users.reload(); log.reload() })
      .catch((e: unknown) => setCreateError(e))
      .finally(() => setBusy(false))
  }
  const onUserSaved = () => { users.reload(); log.reload() }

  return (
    <div className="adm-shell">
      <div className="adm">
        <ScreenHeader eyebrow="Система" title={screenTitle('admin')} subtitle="Кто, что и когда менял; пользователи и их права" />
        <div className="adm__grid">
          <AuditLog log={log} names={names} limit={data.limit} onMore={data.loadMore} openId={entry?.a.id ?? null}
                    onOpen={(r: LogRow) => open({ entry: r.a.id })} />
          <div className="adm__side">
            <UsersSection users={users} orgUnits={orgUnits.data} openId={openUser?.id ?? null}
                          onOpen={(u: User) => open({ user: u.id })}
                          onCreate={() => { setCreateError(null); setCreating(true) }} />
          </div>
          {/* Матрица ролей — во всю ширину под журналом: в правой колонке её роли не помещались. */}
          <div className="adm__roles"><RolesMatrix roles={roles} users={users.data} /></div>
        </div>
      </div>

      {entry && (
        <ErrorBoundary key={`e-${entry.a.id}`} variant="panel" label="Запись журнала" onClose={close}
                       message="Запись не удалось показать — закройте панель или повторите.">
          <AuditEntryPanel row={entry} names={names} onClose={close} />
        </ErrorBoundary>
      )}
      {!entry && openUser && (
        <ErrorBoundary key={`u-${openUser.id}`} variant="panel" label="Пользователь" onClose={close}
                       message="Карточку пользователя не удалось показать — закройте панель или повторите.">
          <UserPanel key={openUser.id} user={openUser} roles={roles.data} orgUnits={orgUnits.data} onClose={close} onSaved={onUserSaved} />
        </ErrorBoundary>
      )}

      {creating && (
        <UserDialog roles={roles.data} orgUnits={orgUnits.data} busy={busy} error={createError}
                    takenLogins={users.data.map((u) => u.login)}
                    onSubmit={createUser} onCancel={() => setCreating(false)} />
      )}
    </div>
  )
}
