import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ErrorBoundary } from './ErrorBoundary'
import { Modal } from './Modal'
import { SCREENS, buildCrumbs } from './screens'
import { DEFAULT_SCREEN_ID, replaceRoute, useHashRoute } from './router'
import { PipelineStrip } from '../ui/PipelineStrip'
import { CommandPalette } from '../ui/CommandPalette'
import { ScreenChromeContext } from '../ui/kit/ScreenHeader'
import { UndoToast } from '../ui/kit'
import { MentatPanel } from '../features/explain/MentatPanel'
import { useRefs } from '../features/method-map/useMethodMapState'
import { ReloginForm } from '../features/auth/ReloginForm'
import { isMentatShortcut, isPaletteShortcut } from './commandIndex'
import { overlayActions, useEscapeLayer, useOverlays } from './overlays'
import { buildCommandItems, recordRecentRoute } from './useCommandItems'
import { SESSION_EXPIRED_EVENT, onWindowEvent } from './session'
import { useCrumbTitles } from './crumbs'
import './shell.css'

const DEFAULT_SCREEN = SCREENS.find((screen) => screen.id === DEFAULT_SCREEN_ID) ?? SCREENS[0]

/**
 * Оболочка приложения: верхняя панель (крошки) + рельса + полоса методологии + экран + статус-бар.
 * Активный экран — из hash-маршрута `#/<screenId>[/<anchor>][?query]` (router.ts): переживает F5,
 * даёт глубокие ссылки и «Назад». Неизвестный id → «Схема предприятия». У экрана, полосы, палитры
 * и MENTAT — свои предохранители: падение одного не гасит остальное. MENTAT, раз открытый, остаётся
 * смонтированным (скрыт и inert), чтобы набранный вопрос пережил закрытие панели.
 */
export default function AppShell() {
  const { screenId, anchor, navigate } = useHashRoute()
  const active = SCREENS.find((screen) => screen.id === screenId) ?? DEFAULT_SCREEN
  const ActiveScreen = active.Component

  // Нормализуем адрес: пустой/неизвестный hash → #/scheme (без лишней записи истории).
  useEffect(() => {
    if (active.id !== screenId || !window.location.hash) replaceRoute(active.id)
  }, [active.id, screenId])


  // Командная палитра — Cmd/Ctrl+K в любом месте, MENTAT — Cmd/Ctrl+J (UX-V2 §7 G4).
  const overlays = useOverlays()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        overlayActions.togglePalette()
      } else if (isMentatShortcut(e)) {
        e.preventDefault()
        overlayActions.toggleMentat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // MENTAT — слой стека Esc (внешний: подсказки, меню, палитра и модалки закрываются раньше).
  useEscapeLayer('mentat', overlayActions.closeMentat, overlays.mentat)
  const [mentatMounted, setMentatMounted] = useState(false)
  useEffect(() => { if (overlays.mentat) setMentatMounted(true) }, [overlays.mentat])
  const mentatRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (mentatRef.current) mentatRef.current.inert = !overlays.mentat }, [overlays.mentat, mentatMounted])

  // Сессия истекла (401 от сервера): модалка с входом на месте — экран и черновики сохраняются.
  const [expired, setExpired] = useState(false)
  useEffect(() => onWindowEvent(SESSION_EXPIRED_EVENT, () => setExpired(true)), [])

  const chrome = useMemo(() => ({ pipeline: Boolean(active.pipeline) }), [active.pipeline])

  return (
    <div className={overlays.mentat ? 'shell shell--mentat' : 'shell'}>
      <RouteTitle screenId={active.id} anchor={active.id === screenId ? anchor : null} />
      <TopBar />
      <div className="shell__body">
        <NavRail activeId={active.id} onSelect={navigate} />
        <main className="shell__content" id="maos-main">
          {/* Полоса методологии (UX-V2 §2.4) — на экранах конвейера; свой предохранитель. */}
          {active.pipeline && (
            <ErrorBoundary key={`strip-${active.id}`} label="Полоса методологии" variant="inline">
              <PipelineStrip activeBlocks={active.blocks} />
            </ErrorBoundary>
          )}
          <div className="shell__screen">
            {/* key=id → предохранитель сбрасывается при переключении экрана. */}
            <ScreenChromeContext.Provider value={chrome}>
              <ErrorBoundary key={active.id} label={active.label}>
                <Suspense fallback={<div className="shell__loading" role="status">Загрузка модуля…</div>}>
                  <ActiveScreen />
                </Suspense>
              </ErrorBoundary>
            </ScreenChromeContext.Provider>
          </div>
        </main>
      </div>
      <StatusBar />
      {overlays.palette && (
        <ErrorBoundary key="palette" label="Командная палитра" variant="panel" onClose={overlayActions.closePalette}
          message="Палитру не удалось открыть — закройте её или повторите.">
          <PaletteHost />
        </ErrorBoundary>
      )}
      {mentatMounted && (
        <div ref={mentatRef} className="shell__mentat" hidden={!overlays.mentat}>
          <ErrorBoundary key="mentat" label="MENTAT" variant="panel" onClose={overlayActions.closeMentat}>
            <MentatPanel screenId={active.id} onClose={overlayActions.closeMentat} />
          </ErrorBoundary>
        </div>
      )}
      {expired && (
        <Modal title="Сессия истекла" onClose={() => setExpired(false)}>
          <ReloginForm onDone={() => setExpired(false)} />
        </Modal>
      )}
      <UndoToast />
    </div>
  )
}

/**
 * Заголовок вкладки и «Недавние» палитры — каноническое имя экрана и объект из крошек
 * («ТК-12 Вал · Техкарты · Справочники · PESCADITO»). Отдельный компонент: имя объекта, которое
 * сообщает экран, перерисовывает только его, а не всю оболочку.
 */
function RouteTitle({ screenId, anchor }: { screenId: string; anchor: string | null }) {
  useCrumbTitles()
  const crumbs = buildCrumbs(screenId, anchor)
  const pageTitle = crumbs.map((c) => c.label).reverse().join(' · ')
  const trail = crumbs.map((c) => c.label).join(' › ')
  useEffect(() => {
    document.title = `${pageTitle} · PESCADITO`
    recordRecentRoute(window.location.hash || `#/${screenId}`, trail)
  }, [pageTitle, trail, screenId])
  return null
}

/** Палитра: индекс собирается при открытии (прогоны из кэша, сценарии из справочников, тема). */
function PaletteHost() {
  const refs = useRefs()
  const items = useMemo(() => buildCommandItems({ scenarios: refs.scenarios }), [refs.scenarios])
  return <CommandPalette items={items} onClose={overlayActions.closePalette} />
}
