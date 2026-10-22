import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface StatusBarProps {
  screen: string
}

type Connection = 'checking' | 'online' | 'offline'

interface Health {
  connection: Connection
  project: string | null
}

const HEALTH_POLL_MS = 30_000

/** «./data/Завод.db» → «Завод». */
function projectName(path: unknown): string | null {
  if (typeof path !== 'string' || !path.trim()) return null
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.db$/i, '') || null
}

/** Опрос GET /api/health: связь с сервером и текущий проект-БД. */
function useBackendHealth(): Health {
  const [health, setHealth] = useState<Health>({ connection: 'checking', project: null })
  useEffect(() => {
    let cancelled = false
    const check = () => {
      api.health()
        .then((res) => {
          // Бэкенд отдаёт и `project` (путь к БД), хотя в типе api.health его пока нет.
          const project = projectName((res as { project?: unknown }).project)
          if (!cancelled) setHealth({ connection: 'online', project })
        })
        .catch(() => {
          if (!cancelled) setHealth((prev) => ({ ...prev, connection: 'offline' }))
        })
    }
    check()
    const timer = window.setInterval(check, HEALTH_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  return health
}

/** Пользователь сессии (пишется окном входа в sessionStorage['maos.session']). */
function readSessionUser(): string | null {
  try {
    const raw = sessionStorage.getItem('maos.session')
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { login, role } = parsed as { login?: unknown; role?: unknown }
    if (typeof login !== 'string' || !login) return null
    return typeof role === 'string' && role ? `${login} · ${role}` : login
  } catch {
    return null
  }
}

const CONNECTION: Record<Connection, { glyph: string; label: string }> = {
  checking: { glyph: 'glyph-idle', label: 'Подключение…' },
  online: { glyph: 'glyph-running', label: 'Локально' },
  offline: { glyph: 'glyph-down', label: 'Нет связи с сервером' },
}

/** Нижний статус-бар: версия, связь с сервером, проект, пользователь, активный экран. */
export function StatusBar({ screen }: StatusBarProps) {
  const { connection, project } = useBackendHealth()
  const [user] = useState(readSessionUser)
  const conn = CONNECTION[connection]

  return (
    <footer className="statusbar">
      <span className="statusbar__version num">PESCADITO v0.68.0</span>
      <span className="statusbar__sep" aria-hidden="true" />
      <span className={`statusbar__conn statusbar__conn--${connection} ${conn.glyph}`} role="status">
        {conn.label}
      </span>
      <span className="statusbar__sep" aria-hidden="true" />
      <span className="statusbar__item">
        Проект: <span className="statusbar__value mono">{project ?? '—'}</span>
      </span>
      {user && (
        <>
          <span className="statusbar__sep" aria-hidden="true" />
          <span className="statusbar__item">{user}</span>
        </>
      )}
      <span className="statusbar__spacer" />
      <span className="statusbar__item">Экран: <span className="statusbar__value">{screen}</span></span>
    </footer>
  )
}
