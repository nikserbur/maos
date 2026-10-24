/**
 * Пользователь в боковой панели (X2 P-143 «безопасная правка»): роль и цех — черновик с «Отмена» и
 * «Сохранить изменения» (смена select ничего не отправляет), смена роли — с подтверждением, где
 * названы и пользователь, и роль; «Сохранено · 14:42» (role=status). Опасная зона — отдельным блоком
 * внизу панели: «Заблокировать/Разблокировать…» и «Сбросить пароль…», каждое с подтверждением.
 */
import { useId, useState } from 'react'
import { api, type OrgUnit, type Role, type User, type UserPatch } from '../../lib/api'
import { time } from '../../explain/format'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { ErrorBanner, SidePanel } from '../../ui/kit'
import { PERM_LABEL, isActiveStatus, parsePerms, userStatusLabel } from './auditVocabulary'
import { PasswordDialog } from './PasswordDialog'
import { roleNeedsShop } from './UserDialog'
import { isBuiltinAdmin } from './UsersSection'

interface UserPanelProps {
  user: User
  roles: ReadonlyArray<Role>
  orgUnits: ReadonlyArray<OrgUnit>
  onClose: () => void
  /** После успешной записи — перечитать список. */
  onSaved: () => void
}

type Ask = null | 'role' | 'status' | 'password'

const permsText = (r: Role | undefined): string => parsePerms(r?.permissions).map((p) => PERM_LABEL[p] ?? p).join(', ') || 'нет прав'

export function UserPanel({ user, roles, orgUnits, onClose, onSaved }: UserPanelProps) {
  const ids = useId()
  const [roleId, setRoleId] = useState(user.role_id ?? '')
  const [unitId, setUnitId] = useState(user.org_unit_id ?? '')
  const [ask, setAsk] = useState<Ask>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const builtin = isBuiltinAdmin(user)
  const role = roles.find((r) => r.id === roleId)
  const needsShop = roleNeedsShop(role)
  const patch: UserPatch = {
    ...(roleId !== (user.role_id ?? '') ? { role_id: roleId } : {}),
    ...(unitId !== (user.org_unit_id ?? '') ? { org_unit_id: unitId } : {}),
  }
  const dirty = Object.keys(patch).length > 0
  const active = isActiveStatus(user.status)

  const send = (p: UserPatch) => {
    setBusy(true)
    setError(null)
    api.admin.updateUser(user.id, p)
      .then(() => { setSavedAt(new Date()); setAsk(null); onSaved() })
      .catch((e: unknown) => { setError(e); setAsk((a) => (a === 'password' ? a : null)) })
      .finally(() => setBusy(false))
  }
  const save = () => {
    if (!dirty) { onClose(); return }
    if (needsShop && !unitId) { setError(new Error('Для роли «Начальник цеха» выберите цех — право найма действует только в нём')); return }
    if (patch.role_id !== undefined) { setAsk('role'); return }
    send(patch)
  }

  return (
    <SidePanel title={`Пользователь ${user.login}`} onClose={onClose} onSave={save} dirty={dirty} saving={busy} className="adm__side-panel">
      {savedAt && !dirty && <p className="adm__saved" role="status">Сохранено · {time(savedAt)}</p>}
      {error !== null && ask !== 'password' && <div className="adm__banner adm__banner--panel"><ErrorBanner error={error} onDismiss={() => setError(null)} /></div>}
      <div className="form adm__form">
        <div className="form__field">
          <label className="form__label" htmlFor={`${ids}-role`}>Роль</label>
          {builtin ? (
            <p className="adm__static">{user.role_name} <span className="adm__sub">· встроенная учётная запись, роль нельзя изменить</span></p>
          ) : (
            <select id={`${ids}-role`} className="form__select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {!roleId && <option value="">— без роли —</option>}
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <span className="form__hint">Права: {permsText(role)}</span>
        </div>
        {!builtin && (needsShop || unitId) && (
          <div className="form__field">
            <label className="form__label" htmlFor={`${ids}-unit`}>Цех</label>
            <select id={`${ids}-unit`} className="form__select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">— не привязан —</option>
              {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="form__hint">Начальник цеха нанимает, переводит и увольняет рабочих только этого цеха.</span>
          </div>
        )}
        <div className="form__field">
          <span className="form__label">Статус</span>
          <p className="adm__static">{userStatusLabel(user.status)}</p>
        </div>
      </div>

      <section className="adm__danger-zone" aria-labelledby={`${ids}-danger`}>
        <h3 className="adm__kv-title" id={`${ids}-danger`}>Доступ</h3>
        <div className="adm__danger-actions">
          {!builtin && (
            <button type="button" className={active ? 'btn btn--danger' : 'btn'} onClick={() => { setError(null); setAsk('status') }}>
              {active ? 'Заблокировать…' : 'Разблокировать…'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => { setError(null); setAsk('password') }}>Сбросить пароль…</button>
        </div>
        {builtin && <p className="form__hint">Встроенную учётную запись нельзя заблокировать — иначе в проект некому будет войти.</p>}
      </section>

      {ask === 'role' && (
        <ConfirmDialog
          title={`Назначить ${user.login} роль «${role?.name ?? '—'}»?`}
          consequence={`Права после сохранения: ${permsText(role)}. Изменение запишется в журнал.`}
          confirmLabel="Назначить роль"
          busy={busy}
          onConfirm={() => send(patch)}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'status' && (
        <ConfirmDialog
          title={active ? `Заблокировать ${user.login}?` : `Разблокировать ${user.login}?`}
          consequence={active
            ? 'Пользователь не сможет войти, пока его не разблокируют. Его записи в журнале и данные останутся.'
            : 'Пользователь снова сможет войти со своим паролем.'}
          confirmLabel={active ? 'Заблокировать' : 'Разблокировать'}
          danger={active}
          busy={busy}
          onConfirm={() => send({ status: active ? 'blocked' : 'active' })}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'password' && (
        <PasswordDialog login={user.login} busy={busy} error={error} onSubmit={(password) => send({ password })} onCancel={() => { setAsk(null); setError(null) }} />
      )}
    </SidePanel>
  )
}
