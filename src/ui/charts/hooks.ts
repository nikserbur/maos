/**
 * Хуки chart-системы: измерение ширины контейнера (графики рисуются в пикселях,
 * текст не масштабируется с шириной) и индекс наведения (мышь + клавиатура ←/→, Home/End).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefCallback } from 'react'

/**
 * Ширина контейнера по ResizeObserver; до первого измерения — `fallback` (тесты, SSR).
 * Ref — callback: плот может появиться позже первого рендера (сначала «пусто»/«загрузка»,
 * потом данные), поэтому наблюдатель ставится в момент подключения элемента, а не в useEffect.
 */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640): [RefCallback<T>, number] {
  const [width, setWidth] = useState(fallback)
  const roRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback<RefCallback<T>>((el) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    roRef.current = ro
  }, [])
  useEffect(() => () => roRef.current?.disconnect(), [])
  return [ref, width]
}

export interface HoverApi {
  hover: number | null
  setHover: (i: number | null) => void
  /** Обработчики для контейнера графика: указатель → ближайший индекс, клавиатура — шаг. */
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  onBlur: () => void
}

/**
 * Индекс наведения по оси X: `xOf(i)` — пиксель центра i-й позиции относительно контейнера.
 * Перекрестие «находит X»: читатель целится в дату, а не в линию толщиной 2 px.
 */
export function useHoverIndex(n: number, xOf: (i: number) => number): HoverApi {
  const [hover, setHover] = useState<number | null>(null)

  const nearest = useCallback((px: number): number | null => {
    if (n <= 0) return null
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xOf(i) - px)
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }, [n, xOf])

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setHover(nearest(e.clientX - rect.left))
  }, [nearest])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (n <= 0) return
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = Math.max(0, (hover ?? n) - 1)
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, (hover ?? -1) + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setHover(next)
  }, [n, hover])

  const clear = useCallback(() => setHover(null), [])
  return { hover, setHover, onPointerMove, onPointerLeave: clear, onKeyDown, onBlur: clear }
}
