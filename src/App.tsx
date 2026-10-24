import { useEffect, useState } from 'react'
import AppShell from './shell/AppShell'
import { LoginScreen } from './features/auth/LoginScreen'
import { LOGOUT_EVENT, checkStoredSession, hasStoredToken, onWindowEvent } from './shell/session'

type Phase = 'checking' | 'login' | 'app'

/**
 * Вход и оболочка (X2 «сессия переживает F5»): сохранённый токен проверяется один раз при загрузке —
 * действителен (или сервер недоступен) → сразу оболочка на том же адресе; 401 → окно входа.
 * «Выйти» и «Сменить проект…» возвращают на окно входа; истечение во время работы — модалка оболочки.
 */
export default function App() {
  const [phase, setPhase] = useState<Phase>(() => (hasStoredToken() ? 'checking' : 'login'))

  useEffect(() => {
    if (phase !== 'checking') return undefined
    let alive = true
    void checkStoredSession().then((r) => { if (alive) setPhase(r === 'invalid' ? 'login' : 'app') })
    return () => { alive = false }
  }, [phase])

  useEffect(() => onWindowEvent(LOGOUT_EVENT, () => setPhase('login')), [])

  if (phase === 'checking') return <div className="app-splash" role="status" aria-live="polite">Проверяем сессию…</div>
  if (phase === 'login') return <LoginScreen onLogin={() => setPhase('app')} />
  return <AppShell />
}
