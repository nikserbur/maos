/**
 * Меню учётной записи (X2 «сессия переживает F5»): кто вошёл, в каком проекте, «Сменить проект…»
 * и «Выйти». Одно меню — в верхней панели и в статус-баре (подпись пользователя/проекта).
 */
import { useMemo } from 'react'
import { Menu, type MenuItem } from '../ui/kit'
import { useBackendHealth } from './health'
import { currentSession, lastProject, logout } from './session'

interface AccountMenuProps {
  /** Подпись кнопки: имя пользователя (верхняя панель) или «пользователь · проект» (статус-бар). */
  variant?: 'topbar' | 'statusbar'
}

export function AccountMenu({ variant = 'topbar' }: AccountMenuProps) {
  const session = useMemo(() => currentSession(), [])
  const { project } = useBackendHealth()
  const proj = project ?? (lastProject().replace(/\.db$/i, '') || '—')
  const who = session.login ? `${session.login}${session.role ? ` · ${session.role}` : ''}` : 'Без входа'
  const items: MenuItem[] = [
    { id: 'who', label: who, onSelect: () => {}, disabled: true },
    { id: 'project', label: `Проект: ${proj}`, onSelect: () => {}, disabled: true },
    { id: 'switch', label: 'Сменить проект…', icon: 'swap', onSelect: logout,
      hint: 'Выход на окно входа: проект выбирается там' },
    { id: 'logout', label: 'Выйти', icon: 'enter', onSelect: logout, hint: 'Завершить сессию; открытые черновики останутся в этой вкладке' },
  ]
  const text = variant === 'statusbar' ? `${session.login || 'гость'} · ${proj}` : session.login || 'Вход'
  return (
    <span className={`account account--${variant}`}>
      <Menu items={items} label={`Учётная запись: ${who}, проект ${proj}`} align="end" size="sm" icon={null}>
        <span className="account__text">{text}</span>
      </Menu>
    </span>
  )
}
