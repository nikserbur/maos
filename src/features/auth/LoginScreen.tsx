import { Suspense, lazy, useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { Backdrop } from '../../brand/Backdrop'
import { Lockup } from '../../brand/Logo'
import { lastProject, storeSession } from '../../shell/session'
import { PRODUCT_VERSION } from '../../shell/version'
import { ErrorBanner, errorText } from '../../ui/kit'
import './auth.css'

const GaLandscape = lazy(() => import('../../brand/landscape/GaLandscape'))

/** WebGL доступен? Без него — статичная аврора. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Заставку монтируем, когда браузер свободен: форма интерактивна раньше, чем рисуется ландшафт. */
function useIdleMount(enabled: boolean): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 1500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(() => setReady(true), 300)
    return () => window.clearTimeout(t)
  }, [enabled])
  return ready
}

type ProjectsState = { status: 'loading' } | { status: 'ready'; list: string[] } | { status: 'error'; error: unknown }

interface LoginScreenProps {
  onLogin: () => void
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [db, setDb] = useState('')
  const [projects, setProjects] = useState<ProjectsState>({ status: 'loading' })
  const [newName, setNewName] = useState('')
  const [login, setLogin] = useState('admin')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [webgl] = useState(hasWebGL)
  const showLandscape = useIdleMount(webgl)

  // Список проектов (файлов БД) — эндпоинт открыт для окна входа; сбой показываем сразу, до «Войти».
  const loadProjects = useCallback(() => {
    setProjects({ status: 'loading' })
    api.projects.list()
      .then((r) => {
        setProjects({ status: 'ready', list: r.projects })
        const remembered = lastProject()
        setDb(remembered && r.projects.includes(remembered) ? remembered : r.current)
      })
      .catch((e: unknown) => setProjects({ status: 'error', error: e }))
  }, [])
  useEffect(() => { loadProjects() }, [loadProjects])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (db === '__new__' && !newName.trim()) { setError('Укажите имя нового проекта.'); return }
    if (!login.trim()) { setError('Введите логин.'); return }
    if (!pass) { setError('Введите пароль.'); return }

    setLoading(true)
    try {
      // Настоящая аутентификация против реестра пользователей (RBAC) на бэкенде.
      const dbName = db === '__new__' ? newName.trim() : db
      const res = await api.auth.login(login, pass, dbName || undefined)
      storeSession(res, dbName || undefined)
      onLogin()
    } catch (err) {
      setError(errorText(err, 'Не удалось войти — повторите'))
      setLoading(false)
    }
  }

  const list = projects.status === 'ready' ? projects.list : []

  return (
    <div className="login-screen">
      {webgl && showLandscape
        ? <Suspense fallback={<Backdrop variant="login" />}><GaLandscape /></Suspense>
        : <Backdrop variant="login" />}

      <div className="login">
        <section className="login__hero" aria-labelledby="login-display">
          <p className="login__eyebrow text-caps">haciendo pescaditos de oro</p>
          <h1 className="login__display" id="login-display">Планирование производства в условиях неопределённости</h1>
          <p className="login__lede">
            Прозрачная стохастическая модель предприятия: от схемы цехов и справочников —
            к устойчивому портфелю и расписанию.
          </p>
          <ul className="login__triad" aria-label="Язык схем">
            <li><i className="login__g login__g--sys" aria-hidden="true" />система</li>
            <li><i className="login__g login__g--res" aria-hidden="true" />ресурс</li>
            <li><i className="login__g login__g--obj" aria-hidden="true" />цель</li>
          </ul>
        </section>

        <div className="login__card">
          <header className="login__head">
            <Lockup height={30} />
            <h2 className="login__title">Вход в систему</h2>
            <p className="login__intro">Войдите, чтобы открыть проект.</p>
          </header>

          {projects.status === 'error' && (
            <ErrorBanner tone="warn" title="Сервер недоступен — запустите maos-server" error={projects.error}
              onRetry={loadProjects} />
          )}

          <form className="login__form" onSubmit={handleSubmit} noValidate>
            <div className="form__field">
              <label className="form__label" htmlFor="login-db">Проект (производство)</label>
              <select id="login-db" className="form__input" value={db} onChange={(e) => setDb(e.target.value)}>
                {list.map((p) => <option key={p} value={p}>{p.replace(/\.db$/, '')}</option>)}
                <option value="__new__">+ Новый проект…</option>
              </select>
              {db === '__new__' && (
                <input className="form__input login__new" value={newName}
                       onChange={(e) => setNewName(e.target.value)}
                       placeholder="Название нового производства"
                       aria-label="Название нового производства" />
              )}
              <span className="form__hint">
                {projects.status === 'ready' && list.length === 0
                  ? 'Проектов нет — при входе будет создан демо-проект'
                  : 'Каждый проект — отдельная база; новый создаётся с демо-данными'}
              </span>
            </div>

            <div className="form__field">
              <label className="form__label" htmlFor="login-user">Логин</label>
              <input id="login-user" className="form__input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
            </div>

            <div className="form__field">
              <label className="form__label" htmlFor="login-pass">Пароль</label>
              <input id="login-pass" className="form__input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
            </div>

            {error && (
              <div className="login__error" role="alert">
                <span className="glyph-x" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn btn--primary btn--lg btn--block login__submit" disabled={loading} aria-busy={loading}>
              {loading && <span className="login__spinner" aria-hidden="true" />}
              {loading ? 'Подключение…' : 'Войти'}
            </button>
          </form>

          <p className="login__footer">{PRODUCT_VERSION} · дипломная работа · {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  )
}
