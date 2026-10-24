/**
 * Вход на месте после истечения сессии (X2: открытый экран и черновики сохраняются): логин и пароль
 * в модалке оболочки, проект — тот же, что был. Ошибки — простыми словами (errorText кита).
 */
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { currentSession, lastProject, storeSession } from '../../shell/session'
import { errorText } from '../../ui/kit'

export function ReloginForm({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState(() => currentSession().login || 'admin')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!login.trim()) { setError('Введите логин.'); return }
    if (!pass) { setError('Введите пароль.'); return }
    setBusy(true)
    try {
      const project = lastProject()
      const res = await api.auth.login(login, pass, project || undefined)
      storeSession(res, project || undefined)
      onDone()
    } catch (err) {
      setError(errorText(err, 'Не удалось войти — повторите'))
      setBusy(false)
    }
  }

  return (
    <form className="form relogin" onSubmit={submit} noValidate>
      <p className="dlg__text">Сессия истекла — войдите снова. Открытый экран и несохранённые черновики останутся на месте.</p>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label" htmlFor="relogin-user">Логин</label>
          <input id="relogin-user" className="form__input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="relogin-pass">Пароль</label>
          <input id="relogin-pass" className="form__input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus />
        </div>
      </div>
      {error && <p className="form__error glyph-x" role="alert">{error}</p>}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" aria-busy={busy || undefined} disabled={busy}>{busy ? 'Подключение…' : 'Войти'}</button>
      </div>
    </form>
  )
}
