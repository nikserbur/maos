import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'

interface LoginScreenProps {
  onLogin: () => void
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [db, setDb]         = useState('production.db')
  const [login, setLogin]   = useState('admin')
  const [pass, setPass]     = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!db.trim())   { setError('Укажите файл базы данных.'); return }
    if (!login.trim()){ setError('Введите логин.'); return }
    if (!pass)        { setError('Введите пароль.'); return }

    setLoading(true)
    try {
      // Настоящая аутентификация против реестра пользователей (RBAC) на бэкенде.
      const res = await api.auth.login(login, pass)
      try {
        sessionStorage.setItem('maos.session',
          JSON.stringify({ login: res.login, role: res.role, permissions: res.permissions }))
      } catch { /* ignore storage errors */ }
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти. Подсказка: admin / maos2025')
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100dvh', display: 'grid', placeItems: 'center',
      background: 'var(--bg-app)',
    }}>
      <div style={{
        width: 380, display: 'flex', flexDirection: 'column', gap: 32,
        padding: '40px 40px 48px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 24px 64px rgba(0,0,0,.6)',
      }}>
        {/* Logo / title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--accent)',
              display: 'grid', placeItems: 'center',
              fontWeight: 800, fontSize: 18, color: '#fff',
            }}>M</div>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>
              MAOS
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Система управления производством.<br />
            Введите учётные данные для доступа к базе.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form__field">
            <label className="form__label">База данных</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="form__input"
                value={db}
                onChange={e => setDb(e.target.value)}
                placeholder="path/to/maos.db"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                style={{ flexShrink: 0 }}
                title="Выбрать файл"
              >…</button>
            </div>
            <span className="form__hint">SQLite WAL · локальное подключение 127.0.0.1</span>
          </div>

          <div className="form__field">
            <label className="form__label">Логин</label>
            <input
              className="form__input"
              value={login}
              onChange={e => setLogin(e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </div>

          <div className="form__field">
            <label className="form__label">Пароль / ключ шифрования</label>
            <input
              className="form__input"
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="•••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px', background: 'rgba(205,66,70,.12)',
              border: '1px solid rgba(205,66,70,.4)', borderRadius: 'var(--radius)',
              fontSize: 13, color: '#f2b8b5',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading}
            style={{ width: '100%', height: 36, fontSize: 14, marginTop: 4 }}
          >
            {loading ? 'Подключение…' : 'Войти'}
          </button>
        </form>

        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
          MAOS v0.20.0 · дипломная работа · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
