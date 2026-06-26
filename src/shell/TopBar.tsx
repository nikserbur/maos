import { useState } from 'react'

interface TopBarProps {
  title: string
}

/** Глобальная верхняя панель: бренд, активный экран, переключатель темы. */
export function TopBar({ title }: TopBarProps) {
  const [light, setLight] = useState(false)

  const toggleTheme = () => {
    const next = !light
    setLight(next)
    document.documentElement.dataset.theme = next ? 'light' : 'dark'
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">MAOS</span>
        <span className="topbar__divider" />
        <span className="topbar__screen">{title}</span>
      </div>
      <button type="button" className="topbar__theme" onClick={toggleTheme}>
        {light ? 'Тёмная тема' : 'Светлая тема'}
      </button>
    </header>
  )
}
