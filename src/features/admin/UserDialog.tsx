/**
 * Новый пользователь: логин, пароль (≥ 8), роль и — для начальника цеха — цех, в пределах которого он
 * нанимает, переводит и увольняет рабочих. «Создать» не выключается заранее (X2 P-145): поля
 * проверяются при уходе из поля и при нажатии, сообщение — под полем (aria-invalid/describedby),
 * фокус — на первое ошибочное поле; кнопка выключена только пока идёт запрос («Создаём…»).
 */
import { useId, useRef, useState, type FormEvent } from 'react'
import { Modal } from '../../shell/Modal'
import type { OrgUnit, Role, UserCreate } from '../../lib/api'
import { ErrorBanner } from '../../ui/kit'
import { num } from '../../explain/format'
import { MIN_PASSWORD, passwordProblem } from './PasswordDialog'
import '../../ui/dialogs.css'

interface UserDialogProps {
  roles: ReadonlyArray<Role>
  orgUnits: ReadonlyArray<OrgUnit>
  busy?: boolean
  error?: unknown
  /** Логины, которые уже заняты (проверка до запроса). */
  takenLogins?: ReadonlyArray<string>
  onSubmit: (u: UserCreate) => void
  onCancel: () => void
}

/** Роли, которым нужен цех (область права найма). */
export const roleNeedsShop = (r: Role | undefined) => Boolean(r?.permissions.includes('HIRE_WORKERS'))

type Field = 'login' | 'password' | 'role' | 'unit'
type Problems = Partial<Record<Field, string>>
const ORDER: readonly Field[] = ['login', 'password', 'role', 'unit']

export function UserDialog({ roles, orgUnits, busy = false, error, takenLogins = [], onSubmit, onCancel }: UserDialogProps) {
  const id = useId()
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLSelectElement | null>>>({})
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState(roles.find((r) => r.id === 'role-shop-manager')?.id ?? roles[0]?.id ?? '')
  const [unitId, setUnitId] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const needsShop = roleNeedsShop(roles.find((r) => r.id === roleId))

  const check = (f: Field): string | undefined => {
    if (f === 'login') {
      const v = login.trim()
      if (!v) return 'Введите логин'
      if (/\s/.test(v)) return 'Логин — без пробелов, например petrov.ceh1'
      return takenLogins.includes(v) ? 'Такой логин уже есть' : undefined
    }
    if (f === 'password') return passwordProblem(password) ?? undefined
    if (f === 'role') return roleId ? undefined : 'Выберите роль'
    return needsShop && !unitId ? 'Выберите цех — право найма действует только в нём' : undefined
  }
  const blur = (f: Field) => setProblems((p) => ({ ...p, [f]: check(f) }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const next: Problems = Object.fromEntries(ORDER.map((f) => [f, check(f)]))
    setProblems(next)
    const first = ORDER.find((f) => next[f])
    if (first) { refs.current[first]?.focus(); return }
    onSubmit({ login: login.trim(), password, role_id: roleId, org_unit_id: needsShop ? unitId : '' })
  }

  /** Атрибуты поля: подпись ошибки или подсказки под ним. */
  const a11y = (f: Field, hint?: boolean) => ({
    id: `${id}-${f}`,
    'aria-invalid': problems[f] ? true : undefined,
    'aria-describedby': problems[f] ? `${id}-${f}-err` : hint ? `${id}-${f}-hint` : undefined,
    onBlur: () => blur(f),
    ref: (el: HTMLInputElement | HTMLSelectElement | null) => { refs.current[f] = el },
  })
  const err = (f: Field) => (problems[f] ? <span className="adm__field-err glyph-down" id={`${id}-${f}-err`}>{problems[f]}</span> : null)

  return (
    <Modal
      title="Новый пользователь"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="submit" form={`${id}-form`} className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="dlg__form" onSubmit={submit} noValidate>
        {error !== null && error !== undefined && <ErrorBanner error={error} />}
        <div className="form__field">
          <label className="form__label" htmlFor={`${id}-login`}>Логин</label>
          <input className="form__input" value={login} autoFocus autoComplete="off" {...a11y('login')}
                 onChange={(e) => setLogin(e.target.value)} placeholder="например, petrov.ceh1" />
          {err('login')}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor={`${id}-password`}>Пароль</label>
          <input className="form__input" type="password" value={password} autoComplete="new-password" {...a11y('password', true)}
                 onChange={(e) => setPassword(e.target.value)} />
          {err('password') ?? <span className="form__hint" id={`${id}-password-hint`}>Не короче {num(MIN_PASSWORD, 0)} символов; на сервере хранится только хэш.</span>}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor={`${id}-role`}>Роль</label>
          <select className="form__select" value={roleId} {...a11y('role')} onChange={(e) => setRoleId(e.target.value)}>
            {!roleId && <option value="">— выберите роль —</option>}
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {err('role')}
        </div>
        {needsShop && (
          <div className="form__field">
            <label className="form__label" htmlFor={`${id}-unit`}>Цех</label>
            <select className="form__select" value={unitId} {...a11y('unit', true)} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">— выберите цех —</option>
              {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {err('unit') ?? <span className="form__hint" id={`${id}-unit-hint`}>Начальник цеха нанимает, переводит и увольняет рабочих только этого цеха.</span>}
          </div>
        )}
      </form>
    </Modal>
  )
}
