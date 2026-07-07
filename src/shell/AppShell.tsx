import { Suspense, useState } from 'react'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ErrorBoundary } from './ErrorBoundary'
import { SCREENS } from './screens'
import './shell.css'

/**
 * Оболочка приложения: верхняя панель + рельса навигации + контент + статус-бар.
 * Контейнер для всех экранов MAOS (см. docs/ROADMAP.md, этап «Оболочка»).
 * Экраны ленивые (React.lazy) — Suspense показывает заглушку на время загрузки чанка.
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
          {/* key=id → предохранитель сбрасывается при переключении экрана. */}
          <ErrorBoundary key={active.id} label={active.label}>
            <Suspense fallback={<div className="shell__loading">Загрузка модуля…</div>}>
              <ActiveScreen />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar screen={active.label} />
    </div>
  )
}
