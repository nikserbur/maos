import { Suspense, useEffect } from 'react'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ErrorBoundary } from './ErrorBoundary'
import { SCREENS } from './screens'
import { DEFAULT_SCREEN_ID, replaceRoute, useHashRoute } from './router'
import './shell.css'

const DEFAULT_SCREEN = SCREENS.find((screen) => screen.id === DEFAULT_SCREEN_ID) ?? SCREENS[0]

/**
 * Оболочка приложения: верхняя панель + рельса навигации + контент + статус-бар.
 * Активный экран — из hash-маршрута `#/<screenId>[/<anchor>]` (router.ts): переживает
 * перезагрузку, даёт глубокие ссылки и «Назад». Неизвестный id → «Схема предприятия».
 * Экраны ленивые (React.lazy) — Suspense показывает заглушку на время загрузки чанка.
 */
export default function AppShell() {
  const { screenId, navigate } = useHashRoute()
  const active = SCREENS.find((screen) => screen.id === screenId) ?? DEFAULT_SCREEN
  const ActiveScreen = active.Component

  // Нормализуем адрес: пустой/неизвестный hash → #/scheme (без лишней записи истории).
  useEffect(() => {
    if (active.id !== screenId || !window.location.hash) replaceRoute(active.id)
  }, [active.id, screenId])

  useEffect(() => {
    document.title = `${active.label} · MAOS`
  }, [active.label])

  return (
    <div className="shell">
      <TopBar title={active.label} stage={active.stage} />
      <div className="shell__body">
        <NavRail activeId={active.id} onSelect={navigate} />
        <main className="shell__content" id="maos-main">
          {/* key=id → предохранитель сбрасывается при переключении экрана. */}
          <ErrorBoundary key={active.id} label={active.label}>
            <Suspense fallback={<div className="shell__loading" role="status">Загрузка модуля…</div>}>
              <ActiveScreen />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar screen={active.label} />
    </div>
  )
}
