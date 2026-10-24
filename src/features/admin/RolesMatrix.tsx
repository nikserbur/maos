/**
 * Права ролей матрицей (X2 P-142): строка — право по-русски, столбец — роль (полное имя и
 * «N пользователей»), ячейка ✓ или —. Код права в API — только в «i» строки. Все права видны без наведения.
 */
import type { Role, User } from '../../lib/api'
import { countText } from '../../explain/format'
import { NoteTip } from '../../ui/NoteTip'
import { DataTable, ErrorBanner, type DataColumn } from '../../ui/kit'
import { PERM_CODES, PERM_LABEL, parsePerms } from './auditVocabulary'
import type { Resource } from './useAdminData'

/** Имена ролей для заголовков столбцов — полностью, без сокращений и мягких переносов (заголовок переносится по словам). */
const ROLE_NAME: Readonly<Record<string, string>> = {
  'role-admin': 'Администратор',
  'role-planner': 'Планировщик',
  'role-viewer': 'Наблюдатель',
  'role-shop-manager': 'Начальник цеха',
}

const USER_FORMS = ['пользователь', 'пользователя', 'пользователей'] as const

const PERM_NOTE: Readonly<Record<string, string>> = {
  READ: 'Открывать все экраны и отчёты без права менять данные.',
  EDIT_NSI: 'Менять справочники: оборудование, изделия, техкарты, операции, рабочих.',
  WRITE_PLAN: 'Создавать и утверждать планы, заказы, сценарии и календарь смен.',
  RUN_OPTIMIZE: 'Запускать оптимизацию портфеля и расписания.',
  MANAGE_USERS: 'Создавать пользователей, менять их роли, блокировать и сбрасывать пароли.',
  HIRE_WORKERS: 'Нанимать, переводить и увольнять рабочих только своего цеха.',
}

function columns(roles: ReadonlyArray<Role>, users: ReadonlyArray<User>): DataColumn<string>[] {
  const permsOf = new Map(roles.map((r) => [r.id, new Set(parsePerms(r.permissions))]))
  const first: DataColumn<string> = {
    key: 'perm', title: 'Право', rowHeader: true, primary: true, sortable: false, render: (code) => (
      <span className="adm__perm">
        {PERM_LABEL[code] ?? code}
        <NoteTip title={PERM_LABEL[code] ?? code}>
          <p>{PERM_NOTE[code] ?? ''}</p>
          <p className="adm__muted">Код права в API: <span className="mono">{code}</span></p>
        </NoteTip>
      </span>
    ),
  }
  return [first, ...roles.map<DataColumn<string>>((r) => {
    const n = users.filter((u) => u.role_id === r.id).length
    return {
      key: r.id,
      sortable: false,
      align: 'center',
      width: 'fit',
      className: 'adm__cell-mark',
      title: (
        <span className="adm__role-head">
          <span>{ROLE_NAME[r.id] ?? r.name}</span>
          <span className="adm__sub">{countText(n, USER_FORMS)}</span>
        </span>
      ),
      render: (code) => (permsOf.get(r.id)?.has(code)
        ? <span className="adm__yes" aria-label="есть">✓</span>
        : <span className="adm__no" aria-label="нет">—</span>),
    }
  })]
}

interface RolesMatrixProps {
  roles: Resource<Role[]>
  users: ReadonlyArray<User>
}

export function RolesMatrix({ roles, users }: RolesMatrixProps) {
  return (
    <section className="dk-card dk-card--flush adm__panel" aria-labelledby="adm-roles-t">
      <div className="adm__panel-head">
        <h2 className="adm__panel-title" id="adm-roles-t">Роли и права</h2>
      </div>
      {roles.status === 'error' && <div className="adm__banner"><ErrorBanner error={roles.error} onRetry={roles.reload} /></div>}
      {!(roles.status === 'error' && roles.data.length === 0) && (
        <DataTable
          className="adm__matrix"
          columns={columns(roles.data, users)}
          rows={roles.data.length > 0 ? PERM_CODES : []}
          rowKey={(code) => code}
          loading={roles.status === 'loading'}
          tight
          caption="Права ролей"
          empty="Ролей нет — проверьте посев базы проекта"
          emptyKind="unavailable"
        />
      )}
    </section>
  )
}
