/**
 * Новый пользователь: логин, пароль (≥ 8), роль и — для начальника цеха — цех,
 * в пределах которого он нанимает, переводит и увольняет сотрудников.
 */
import { useId, useState, type FormEvent } from 'react'
import { Modal } from '../../shell/Modal'
import type { OrgUnit, Role, UserCreate } from '../../lib/api'
import '../../ui/dialogs.css'

interface UserDialogProps {
  roles: Role[]
  orgUnits: OrgUnit[]
  busy?: boolean
  error?: string | null
  onSubmit: (u: UserCreate) => void
  onCancel: () => void
}

/** Роли, которым нужен цех (область права найма). */
export const roleNeedsShop = (r: Role | undefined) => Boolean(r?.permissions.includes('HIRE_WORKERS'))

export function UserDialog({ roles, orgUnits, busy = false, error, onSubmit, onCancel }: UserDialogProps) {
  const formId = useId()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState(roles.find((r) => r.id === 'role-shop-manager')?.id ?? roles[0]?.id ?? '')
  const [unitId, setUnitId] = useState('')
  const needsShop = roleNeedsShop(roles.find((r) => r.id === roleId))
  const valid = login.trim().length > 0 && password.length >= 8 && Boolean(roleId) && (!needsShop || Boolean(unitId))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    onSubmit({ login: login.trim(), password, role_id: roleId, org_unit_id: needsShop ? unitId : '' })
  }

  return (
    <Modal
      title="Новый пользователь"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={!valid || busy}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </>
      }
    >
      <form id={formId} className="dlg__form" onSubmit={submit}>
        {error && <div className="form__error">{error}</div>}
        <label className="form__label dlg__field">
          <span>Логин</span>
          <input className="form__input" value={login} autoFocus autoComplete="off"
                 onChange={(e) => setLogin(e.target.value)} placeholder="petrov.ceh1" />
        </label>
        <label className="form__label dlg__field">
          <span>Пароль</span>
          <input className="form__input" type="password" value={password} autoComplete="new-password"
                 onChange={(e) => setPassword(e.target.value)} />
          <span className="form__hint">Не короче 8 символов; хранится на сервере только в виде хэша.</span>
        </label>
        <label className="form__label dlg__field">
          <span>Роль</span>
          <select className="form__select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {needsShop && (
          <label className="form__label dlg__field">
            <span>Цех</span>
            <select className="form__select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">— выберите цех —</option>
              {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="form__hint">Начальник цеха нанимает, переводит и увольняет сотрудников только этого цеха.</span>
          </label>
        )}
      </form>
    </Modal>
  )
}
