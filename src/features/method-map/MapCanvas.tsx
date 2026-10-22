/**
 * Канвас L0: пан (перетаскивание фона), зум (колесо вокруг курсора), «вписать»,
 * узлы-блоки поверх SVG-рёбер в одной системе координат (transform мира).
 * Клавиатура (UX-V2 §3.10): Enter — панель, → ← — сосед по ребру data, ↓ — развернуть,
 * ↑ — свернуть; остальные клавиши экрана (1…8, F, /, ?) — в MapScreen.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { BLOCK_META } from './blocks'
import { MapEdges } from './MapEdges'
import { MapNodeView } from './MapNodeView'
import { dataNeighbours, layoutL0 } from './mapLayout'
import { getNode, subblocksOf } from './registry'
import { liveOf } from './deriveState'
import { BLOCK_IDS, type MethodMapState } from './types'

interface View {
  x: number
  y: number
  k: number
}

const MIN_K = 0.4
const MAX_K = 2.2
const PAD = 48

interface MapCanvasProps {
  live: MethodMapState
  selectedId: string | null
  expanded: ReadonlySet<string>
  /** Увеличивается, когда экран просит «вписать» (кнопка или клавиша F). */
  fitToken: number
  onSelect: (id: string) => void
  onToggle: (block: string) => void
  onPickEdge: (edgeId: string) => void
  onZoomChange?: (k: number) => void
}

/** Фокус на узле по id (узлы помечены data-node). */
export function focusNode(root: HTMLElement | null, id: string): void {
  const el = root?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)
  el?.focus()
}

export function MapCanvas({ live, selectedId, expanded, fitToken, onSelect, onToggle, onPickEdge, onZoomChange }: MapCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const subCounts = Object.fromEntries(BLOCK_IDS.map((b) => [b, subblocksOf(b).length]))
  const layout = layoutL0(expanded, subCounts)

  const fit = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return
    const w = layout.width + 80
    const h = layout.height + 100
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((vp.clientWidth - PAD) / w, (vp.clientHeight - PAD) / h)))
    setView({ x: (vp.clientWidth - w * k) / 2 + 40 * k, y: (vp.clientHeight - h * k) / 2 + 60 * k, k })
  }, [layout.width, layout.height])

  // Вписать при монтировании, по запросу экрана и при изменении размера области.
  useEffect(() => { fit() }, [fitToken, fit])
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => fit())
    ro.observe(vp)
    return () => ro.disconnect()
  }, [fit])
  useEffect(() => { onZoomChange?.(view.k) }, [view.k, onZoomChange])

  // Колесо — зум вокруг курсора; passive: false, чтобы страница не прокручивалась.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0015)))
        const wx = (px - v.x) / v.k
        const wy = (py - v.y) / v.k
        return { k, x: px - wx * k, y: py - wy * k }
      })
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.mm-node')) return
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

  const onNodeKeyDown = (e: KeyboardEvent<HTMLElement>, id: string) => {
    const node = getNode(id)
    if (!node) return
    const block = node.block
    const root = viewportRef.current
    // Обработанные клавиши не всплывают к блоку-контейнеру (подблок внутри блока) и к окну;
    // остальные (Esc, 1…8, F, /, ?) доходят до обработчика экрана.
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    switch (e.key) {
      case 'Enter':
      case ' ':
        handled()
        onSelect(id)
        break
      case 'ArrowRight':
      case 'ArrowLeft': {
        handled()
        const nb = dataNeighbours(block)
        const target = (e.key === 'ArrowRight' ? nb.next : nb.prev)[0]
        if (target) focusNode(root, target)
        break
      }
      case 'ArrowDown':
        handled()
        if (!expanded.has(block)) onToggle(block)
        else if (node.kind === 'block') focusNode(root, subblocksOf(block)[0]?.id ?? block)
        break
      case 'ArrowUp':
        handled()
        if (node.kind !== 'block') focusNode(root, block)
        else if (expanded.has(block)) onToggle(block)
        break
      default:
        break
    }
  }

  const focusId = hoveredId ?? (selectedId ? getNode(selectedId)?.block ?? null : null)

  return (
    <div
      ref={viewportRef}
      className="mm-viewport"
      role="application"
      aria-roledescription="карта методологии"
      aria-label="Карта методологии: 8 блоков и связи между ними"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="mm-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <MapEdges paths={layout.paths} width={layout.width} height={layout.height} focusId={focusId} onPick={onPickEdge} />
        {layout.rects.map((rect) => (
          <MapNodeView
            key={rect.id}
            rect={rect}
            meta={BLOCK_META[rect.id]}
            live={liveOf(live, rect.id)}
            subs={subblocksOf(rect.id)}
            subLive={(id) => liveOf(live, id)}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={onSelect}
            onToggle={onToggle}
            onHover={setHoveredId}
            onKeyDown={onNodeKeyDown}
          />
        ))}
      </div>
    </div>
  )
}
