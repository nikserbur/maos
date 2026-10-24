/**
 * Пользователи (X2 P-141, P-143): таблица только для чтения — правка в боковой панели по клику на
 * строку; «активен» нейтрально, «заблокирован» — чип ■; неудачные входы подряд — числом (колонка
 * скрывается первой в узкой панели), а если они есть — предупреждение ▲ в «Статусе».
 * Ошибка загрузки — баннер с «Повторить», а не «Нет пользователей».
 */
import type { OrgUnit, User } from '../../lib/api'
import { num } from '../../explain/format'
import { Chip, DataTable, ErrorBanner, type DataColumn } from '../../ui/kit'
import { isActiveStatus, userStatusLabel } from './auditVocabulary'
import type { Resource } from './useAdminData'

/** Встроенная учётная запись: роль не меняется, блокировать нельзя. */
export const isBuiltinAdmin = (u: Pick<User, 'login'>): boolean => u.login === 'admin'

function columns(orgUnits: ReadonlyArray<OrgUnit>): DataColumn<User>[] {
  const unitName = (id?: string | null) => (id ? orgUnits.find((o) => o.id === id)?.name ?? '' : '')
  return [
    { key: 'login', title: 'Пользователь', rowHeader: true, primary: true },
    { key: 'role_name', title: 'Роль', get: (u) => u.role_name, render: (u) => (
      <span className="adm__role-cell">
        <span>{u.role_name || '—'}</span>
        {unitName(u.org_unit_id) && <span className="adm__sub">{unitName(u.org_unit_id)}</span>}
        {isBuiltinAdmin(u) && <span className="adm__sub">нельзя изменить</span>}
      </span>
    ) },
    { key: 'failed_attempts', title: 'Неудачных входов', num: true, priority: 3,
      hint: 'Подряд с последнего успешного входа; после 5 вход закрывается на 5 минут',
      get: (u) => Number(u.failed_attempts) || 0, render: (u) => num(Number(u.failed_attempts) || 0, 0) },
    { key: 'status', title: 'Статус', width: 'fit', get: (u) => userStatusLabel(u.status), render: (u) => <StatusCell u={u} /> },
  ]
}

/** Статус и, если были неудачные входы подряд, предупреждение ▲ — видно и без колонки «Неудачных входов». */
function StatusCell({ u }: { u: User }) {
  const failed = Number(u.failed_attempts) || 0
  return (
    <span className="adm__active">
      {isActiveStatus(u.status) ? <span className="adm__muted">{userStatusLabel(u.status)}</span> : <Chip tone="down" size="sm">{userStatusLabel(u.status)}</Chip>}
      {failed > 0 && <Chip tone="setup" size="sm" title="Неудачных входов подряд с последнего успешного">неудачных входов: {num(failed, 0)}</Chip>}
    </span>
  )
}

interface UsersSectionProps {
  users: Resource<User[]>
  orgUnits: ReadonlyArray<OrgUnit>
  openId: string | null
  onOpen: (u: User) => void
  onCreate: () => void
}

export function UsersSection({ users, orgUnits, openId, onOpen, onCreate }: UsersSectionProps) {
  const failedEmpty = users.status === 'error' && users.data.length === 0
  return (
    <section className="dk-card dk-card--flush adm__panel" aria-labelledby="adm-users-t">
      <div className="adm__panel-head">
        <h2 className="adm__panel-title" id="adm-users-t">
          Пользователи {users.data.length > 0 && <span className="adm__panel-meta">· {num(users.data.length, 0)}</span>}
        </h2>
        <button type="button" className="btn" onClick={onCreate}>Новый пользователь</button>
      </div>
      {users.status === 'error' && <div className="adm__banner"><ErrorBanner error={users.error} onRetry={users.reload} /></div>}
      {!failedEmpty && (
        <DataTable
          columns={columns(orgUnits)}
          rows={users.data}
          rowKey={(u) => u.id}
          onRowClick={onOpen}
          rowClassName={(u) => (u.id === openId ? 'is-open' : undefined)}
          rowTitle={() => 'Открыть: роль, цех, блокировка, пароль'}
          loading={users.status === 'loading'}
          tight
          className="adm__users-table"
          caption="Пользователи"
          empty="Пользователей пока нет — создайте первого"
          emptyKind="first-use"
        />
      )}
    </section>
  )
}
