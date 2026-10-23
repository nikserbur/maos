import { Suspense, useEffect, useMemo } from 'react'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ErrorBoundary } from './ErrorBoundary'
import { SCREENS } from './screens'
import { DEFAULT_SCREEN_ID, replaceRoute, useHashRoute } from './router'
import { PipelineStrip } from '../ui/PipelineStrip'
import { CommandPalette } from '../ui/CommandPalette'
import { MentatPanel } from '../features/explain/MentatPanel'
import { isPaletteShortcut } from './commandIndex'
import { overlayActions, useOverlays } from './overlays'
import { buildCommandItems } from './useCommandItems'
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
    document.title = `${active.label} · PESCADITO`
  }, [active.label])

  // Командная палитра — Cmd/Ctrl+K в любом месте (UX-V2 §7 G4); MENTAT — из верхней панели или палитры.
  const overlays = useOverlays()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      overlayActions.togglePalette()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Индекс собирается при открытии: прогоны из кэша и тема — на момент вызова.
  const commandItems = useMemo(() => (overlays.palette ? buildCommandItems() : []), [overlays.palette])

  return (
    <div className="shell">
      <TopBar title={active.label} />
      <div className="shell__body">
        <NavRail activeId={active.id} onSelect={navigate} />
        <main className="shell__content" id="maos-main">
          {/* Полоса методологии (UX-V2 §2.4) — на экранах решений; сама не падает: ошибки ловит предохранитель. */}
          {active.pipeline && (
            <ErrorBoundary key={`strip-${active.id}`} label="Полоса методологии">
              <PipelineStrip activeBlocks={active.blocks} />
            </ErrorBoundary>
          )}
          <div className="shell__screen">
            {/* key=id → предохранитель сбрасывается при переключении экрана. */}
            <ErrorBoundary key={active.id} label={active.label}>
              <Suspense fallback={<div className="shell__loading" role="status">Загрузка модуля…</div>}>
                <ActiveScreen />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <StatusBar screen={active.label} />
      {overlays.palette && <CommandPalette items={commandItems} onClose={overlayActions.closePalette} />}
      {overlays.mentat && <MentatPanel screenId={active.id} onClose={overlayActions.closeMentat} />}
    </div>
  )
}
