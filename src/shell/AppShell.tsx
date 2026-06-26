import { useState } from 'react'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { SCREENS } from './screens'
import './shell.css'

/**
 * Оболочка приложения: верхняя панель + рельса навигации + контент + статус-бар.
 * Контейнер для всех экранов MAOS (см. docs/ROADMAP.md, этап «Оболочка»).
 */
export default function AppShell() {
  const [activeId, setActiveId] = useState('scheme')
  const active = SCREENS.find((screen) => screen.id === activeId) ?? SCREENS[0]
  const ActiveScreen = active.Component

  return (
    <div className="shell">
      <TopBar title={active.label} />
      <div className="shell__body">
        <NavRail activeId={active.id} onSelect={setActiveId} />
        <main className="shell__content">
          <ActiveScreen />
        </main>
      </div>
      <StatusBar screen={active.label} />
    </div>
  )
}
