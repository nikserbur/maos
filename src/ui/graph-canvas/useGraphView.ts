/**
 * Состояние вьюпорта граф-канваса (UX-V2 §6.1): пан, зум вокруг точки, «вписать» по границам
 * содержимого, пересчёт экран → мир. Без DOM-рендера — переиспользуется AI-воркфлоу,
 * конструктором техкарт и картой методологии.
 */
import { useCallback, useRef, useState, type RefObject } from 'react'

export interface View { x: number; y: number; k: number }
export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; w: number; h: number }

export interface GraphViewOptions {
  minZoom?: number
  maxZoom?: number
  /** Поле вокруг содержимого при «вписать», px экрана. */
  pad?: number
  initial?: View
}

export interface GraphViewApi {
  view: View
  setView: (next: View | ((v: View) => View)) => void
  /** Зум в `factor` раз вокруг экранной точки (по умолчанию — центр вьюпорта). */
  zoomBy: (factor: number, center?: Point) => void
  /** Вписать границы содержимого в вьюпорт (центрируя). */
  fit: (bounds: Bounds) => void
  reset: () => void
  /** Экранные координаты события → координаты мира. */
  toWorld: (clientX: number, clientY: number) => Point
  /** Сдвиг на пиксели экрана. */
  panBy: (dx: number, dy: number) => void
  minZoom: number
  maxZoom: number
}

const clampZoom = (k: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, k))

export function useGraphView(viewportRef: RefObject<HTMLElement>, opts: GraphViewOptions = {}): GraphViewApi {
  const minZoom = opts.minZoom ?? 0.35
  const maxZoom = opts.maxZoom ?? 2.2
  const pad = opts.pad ?? 48
  const initial = opts.initial ?? { x: pad, y: pad, k: 1 }
  const [view, setViewState] = useState<View>(initial)
  // Актуальный вид для обработчиков, не зависящих от перерисовки (колесо, перетаскивание).
  const viewRef = useRef(view)
  viewRef.current = view

  const setView = useCallback((next: View | ((v: View) => View)) => {
    setViewState((v) => {
      const n = typeof next === 'function' ? next(v) : next
      viewRef.current = n
      return n
    })
  }, [])

  const zoomBy = useCallback((factor: number, center?: Point) => {
    const vp = viewportRef.current
    const cx = center?.x ?? (vp?.clientWidth ?? 0) / 2
    const cy = center?.y ?? (vp?.clientHeight ?? 0) / 2
    setView((v) => {
      const k = clampZoom(v.k * factor, minZoom, maxZoom)
      const wx = (cx - v.x) / v.k
      const wy = (cy - v.y) / v.k
      return { k, x: cx - wx * k, y: cy - wy * k }
    })
  }, [viewportRef, minZoom, maxZoom, setView])

  const fit = useCallback((b: Bounds) => {
    const vp = viewportRef.current
    if (!vp || b.w <= 0 || b.h <= 0) return
    const W = vp.clientWidth
    const H = vp.clientHeight
    if (W <= 0 || H <= 0) return
    const k = clampZoom(Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h), minZoom, maxZoom)
    setView({ k, x: (W - b.w * k) / 2 - b.x * k, y: (H - b.h * k) / 2 - b.y * k })
  }, [viewportRef, pad, minZoom, maxZoom, setView])

  const reset = useCallback(() => setView(initial), [setView, initial.x, initial.y, initial.k]) // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - (rect?.left ?? 0) - v.x) / v.k, y: (clientY - (rect?.top ?? 0) - v.y) / v.k }
  }, [viewportRef])

  const panBy = useCallback((dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })), [setView])

  return { view, setView, zoomBy, fit, reset, toWorld, panBy, minZoom, maxZoom }
}
