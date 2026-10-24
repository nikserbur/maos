/**
 * Граф-канвас (UX-V2 §6.1, X1 §6.6): вынесенный из AI-воркфлоу движок вьюпорта — пан по фону,
 * зум колесом вокруг курсора, «вписать» (кнопка · клавиша F · при монтировании; при ресайзе — только
 * если `refitOnResize`: открытие боковой панели не меняет масштаб), клавиатура (+ − 0 F, стрелки — пан),
 * плавающие кнопки масштаба (снизу справа или сверху справа). Общий вид карточки узла — `.gc-node`.
 * Два слоя в одной системе координат: SVG (рёбра, узлы-svg) и HTML (узлы-карточки).
 * Трансформация мира задаётся атрибутом <g transform> и императивно (style.transform) —
 * без inline-стилей в JSX и без перерисовки React на каждый кадр пана.
 */
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef,
  type KeyboardEvent, type PointerEvent, type ReactNode,
} from 'react'
import { useGraphView, type Bounds, type Point, type View } from './useGraphView'
import './graph-canvas.css'

export interface GraphCanvasHandle {
  fit: () => void
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  toWorld: (clientX: number, clientY: number) => Point
  getView: () => View
  /** Центр видимой области в координатах мира (куда ставить новый узел). */
  getViewportCenterWorld: () => Point
}

interface GraphCanvasProps {
  /** Границы содержимого в координатах мира — для «вписать». */
  bounds: Bounds
  /** Увеличивается, когда экран просит «вписать» (кнопка или клавиша F снаружи). */
  fitToken?: number
  /** Прежний флаг: false — не вписывать при ресайзе (при монтировании — вписывать). */
  autoFit?: boolean
  /** Вписать при монтировании (по умолчанию да). */
  fitOnMount?: boolean
  /** Вписывать заново при изменении размера вьюпорта (по умолчанию да; карта и воркфлоу — нет). */
  refitOnResize?: boolean
  /** Где плавающие кнопки масштаба. */
  controlsPlacement?: 'bottom-right' | 'top-right'
  minZoom?: number
  maxZoom?: number
  /** SVG-содержимое в координатах мира (рёбра, svg-узлы). */
  svg?: ReactNode
  /** HTML-содержимое в координатах мира (узлы-карточки). */
  children?: ReactNode
  /** Нажатие по пустому фону (снять выделение). */
  onBackgroundPointerDown?: (e: PointerEvent<HTMLDivElement>) => void
  onViewChange?: (v: View) => void
  /** Клавиши, не обработанные канвасом, — вверх к экрану (Esc, Cmd+S). */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Показывать плавающие кнопки масштаба. */
  controls?: boolean
  grid?: boolean
  ariaLabel: string
  /** Описание роли для экранного диктора («карта методологии»). */
  ariaRoleDescription?: string
  /** Поле вокруг содержимого при «вписать», px экрана. */
  pad?: number
  /** Селектор элементов-узлов, по которым не начинается пан (по умолчанию `[data-gc-node]`). */
  nodeSelector?: string
  className?: string
}

const ZOOM_STEP = 1.2
const PAN_STEP = 48

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas({
  bounds, fitToken = 0, autoFit, fitOnMount = true, refitOnResize, controlsPlacement = 'bottom-right', minZoom, maxZoom, svg, children,
  onBackgroundPointerDown, onViewChange, onKeyDown, controls = true, grid = true, ariaLabel, ariaRoleDescription, pad, nodeSelector = '[data-gc-node]', className,
}, ref) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const refit = refitOnResize ?? autoFit ?? true
  const api = useGraphView(viewportRef, { minZoom, maxZoom, pad })
  const { view, fit, zoomBy, reset, toWorld, panBy, setView } = api
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds

  const fitNow = useCallback(() => fit(boundsRef.current), [fit])

  useImperativeHandle(ref, () => ({
    fit: fitNow,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    reset,
    toWorld,
    getView: () => view,
    getViewportCenterWorld: () => {
      const vp = viewportRef.current
      const w = vp?.clientWidth ?? 0
      const h = vp?.clientHeight ?? 0
      return { x: (w / 2 - view.x) / view.k, y: (h / 2 - view.y) / view.k }
    },
  }), [fitNow, zoomBy, reset, toWorld, view])

  // «Вписать»: по запросу экрана и один раз при монтировании; при ресайзе — только если просили
  // (иначе открытие панели узла сбивало бы масштаб, который выбрал пользователь).
  useEffect(() => { if (fitToken > 0) fitNow() }, [fitToken, fitNow])
  const fitOnMountRef = useRef(fitOnMount)
  useEffect(() => {
    if (!fitOnMountRef.current) return undefined
    fitNow()
    // Вьюпорт мог ещё не получить размер (ленивый экран) — повтор на первом кадре.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fitNow()) : 0
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!refit) return undefined
    const vp = viewportRef.current
    if (!vp || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => fitNow())
    ro.observe(vp)
    return () => ro.disconnect()
  }, [refit, fitNow])

  useEffect(() => { onViewChange?.(view) }, [view, onViewChange])

  // Трансформация HTML-слоя и сетки — императивно: кадр пана не проходит через reconciler.
  useLayoutEffect(() => {
    const world = worldRef.current
    if (world) world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`
    const vp = viewportRef.current
    if (vp) {
      vp.style.setProperty('--gc-x', `${view.x}px`)
      vp.style.setProperty('--gc-y', `${view.y}px`)
      vp.style.setProperty('--gc-cell', `${24 * view.k}px`)
    }
  }, [view])

  // Колесо — зум вокруг курсора; passive: false, чтобы страница не прокручивалась.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest(`${nodeSelector}, .gc__controls`)) return
    onBackgroundPointerDown?.(e)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.classList.add('is-panning')
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setView((v) => ({ ...v, x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) }))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    e.currentTarget.classList.remove('is-panning')
  }

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) { onKeyDown?.(e); return }
    switch (e.key) {
      case '+': case '=': zoomBy(ZOOM_STEP); break
      case '-': case '_': zoomBy(1 / ZOOM_STEP); break
      case '0': reset(); break
      case 'f': case 'F': case 'а': case 'А': fitNow(); break
      case 'ArrowLeft': panBy(PAN_STEP, 0); break
      case 'ArrowRight': panBy(-PAN_STEP, 0); break
      case 'ArrowUp': panBy(0, PAN_STEP); break
      case 'ArrowDown': panBy(0, -PAN_STEP); break
      default: onKeyDown?.(e); return
    }
    e.preventDefault()
  }

  return (
    <div
      ref={viewportRef}
      className={`gc${grid ? ' gc--grid' : ''}${className ? ` ${className}` : ''}`}
      role="application"
      aria-label={ariaLabel}
      aria-roledescription={ariaRoleDescription}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={handleKey}
    >
      <svg className="gc__svg" aria-hidden="true">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>{svg}</g>
      </svg>
      {children && <div ref={worldRef} className="gc__world">{children}</div>}
      {controls && (
        <div className={`gc__controls gc__controls--${controlsPlacement}`} role="group" aria-label="Масштаб">
          <button type="button" className="btn btn--icon gc__btn" title="Уменьшить (−)" aria-label="Уменьшить" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h10" /></svg>
          </button>
          <span className="gc__zoom num" aria-live="polite">{Math.round(view.k * 100)}%</span>
          <button type="button" className="btn btn--icon gc__btn" title="Увеличить (+)" aria-label="Увеличить" onClick={() => zoomBy(ZOOM_STEP)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" className="btn gc__btn gc__btn--fit" title="Вписать (F)" onClick={fitNow}>Вписать</button>
        </div>
      )}
    </div>
  )
})
