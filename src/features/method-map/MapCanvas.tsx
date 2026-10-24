/**
 * Канвас L0 на движке `GraphCanvas` (src/ui/graph-canvas, UX-V2 §6.1): пан по фону, зум колесом
 * вокруг курсора, «вписать» при открытии и по F/кнопке; при изменении размера вьюпорта — не вписывает
 * (X2 P-126: открытая панель узла не сжимает карту). Когда открыта панель, выбранный блок сдвигается
 * в видимую часть, а масштаб не опускается ниже 80 %: «вписать» по рамке вокруг блока.
 * Клавиатура узлов (UX-V2 §3.10): Enter — панель, → ← — сосед по ребру data, ↓ — развернуть,
 * ↑ — свернуть; остальные клавиши экрана (1…8, F, /, ?) — в MapScreen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { usePrefersReducedMotion, useAnimationPaused } from '../../ui/motion'
import { GraphCanvas, type GraphCanvasHandle, type View } from '../../ui/graph-canvas'
import type { Bounds } from '../../ui/graph-canvas/useGraphView'
import { BLOCK_META } from './blocks'
import { MapEdges, type EdgeLabelMode } from './MapEdges'
import type { LoopState } from './AgentLoop'
import { MapNodeView } from './MapNodeView'
import { dataNeighbours, layoutL0, type Rect } from './mapLayout'
import { getNode, subblocksOf } from './registry'
import { liveOf } from './deriveState'
import { BLOCK_IDS, type MethodMapState } from './types'

const MIN_K = 0.4
const MAX_K = 2.2
/** С открытой панелью масштаб не ниже 80 % (X2 P-126). */
const PANEL_MIN_K = 0.8
/** Поле «вписать» (24 px с каждой стороны) и нижнее поле движка (max(pad, 56)). */
const FIT_PAD = 24
const FIT_PAD_BOTTOM = 56
/** Запас мира вокруг раскладки: рёбра выходят за блоки на 40 px слева и 60 px сверху. */
const WORLD_X = -40
const WORLD_Y = -60

interface MapCanvasProps {
  live: MethodMapState
  selectedId: string | null
  /** Панель узла открыта — блок выбранного узла держится в видимой части с масштабом ≥ 80 %. */
  panelOpen: boolean
  expanded: ReadonlySet<string>
  /** Увеличивается, когда экран просит «вписать» (кнопка или клавиша F). */
  fitToken: number
  labels: EdgeLabelMode
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

/**
 * Рамка «вписать», при которой блок оказывается в центре видимой части с масштабом k
 * (вписывание рамки размера (W − 2·pad)/k даёт ровно k). `cover` — ширина панели, лежащей поверх.
 */
export function focusBounds(rect: Rect, vpW: number, vpH: number, k: number, cover = 0): Bounds {
  const w = (vpW - FIT_PAD * 2) / k
  const h = (vpH - FIT_PAD - FIT_PAD_BOTTOM) / k
  const cx = rect.x + rect.w / 2 + cover / 2 / k
  const cy = rect.y + rect.h / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export function MapCanvas({ live, selectedId, panelOpen, expanded, fitToken, labels, onSelect, onToggle, onPickEdge, onZoomChange }: MapCanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<GraphCanvasHandle>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Запрос «вписать»: seq — для движка (вписывает при смене), bounds — рамка блока или вся карта (null).
  const [fitReq, setFitReq] = useState<{ seq: number; bounds: Bounds | null }>({ seq: 0, bounds: null })
  const reduced = usePrefersReducedMotion()
  const [paused] = useAnimationPaused()

  const subCounts = Object.fromEntries(BLOCK_IDS.map((b) => [b, subblocksOf(b).length]))
  const layout = layoutL0(expanded, subCounts)
  const full = useMemo(
    () => ({ x: WORLD_X, y: WORLD_Y, w: layout.width + 80, h: layout.height + 100 }),
    [layout.width, layout.height],
  )
  const onView = useCallback((v: View) => onZoomChange?.(v.k), [onZoomChange])

  // «Вписать» (кнопка, F) — вся карта.
  useEffect(() => {
    if (fitToken > 0) setFitReq((r) => ({ seq: r.seq + 1, bounds: null }))
  }, [fitToken])

  // Панель открыта/выбран другой блок → после раскладки (колонка панели меняет ширину вьюпорта)
  // блок — в центр видимой части, масштаб ≥ 80 %. Закрытие панели масштаб не меняет.
  const selectedBlock = selectedId ? getNode(selectedId)?.block ?? null : null
  useEffect(() => {
    if (!panelOpen || !selectedBlock) return undefined
    const raf = requestAnimationFrame(() => {
      const vp = rootRef.current?.querySelector<HTMLElement>('.gc')
      const rect = layout.rects.find((r) => r.id === selectedBlock)
      if (!vp || !rect || vp.clientWidth <= 0) return
      const k = Math.min(MAX_K, Math.max(PANEL_MIN_K, canvasRef.current?.getView().k ?? 1))
      const panel = rootRef.current?.closest('.mm-body')?.querySelector<HTMLElement>('.mm-panel')
      const overlays = panel ? getComputedStyle(panel).position === 'absolute' : false
      const cover = overlays && panel ? panel.offsetWidth : 0
      setFitReq((r) => ({ seq: r.seq + 1, bounds: focusBounds(rect, vp.clientWidth, vp.clientHeight, k, cover) }))
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене блока или открытии панели
  }, [panelOpen, selectedBlock])

  const bounds = fitReq.bounds ?? full

  const onNodeKeyDown = (e: KeyboardEvent<HTMLElement>, id: string) => {
    const node = getNode(id)
    if (!node) return
    const block = node.block
    const root = rootRef.current
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

  const focusId = hoveredId ?? selectedBlock
  // Петля [6] → [4]: живая — когда агент реально работал (estimated), статичная — когда политики нет.
  const agentState = liveOf(live, 'ag.rl').state
  const loop: LoopState | null = agentState === 'estimated' ? 'live' : agentState === 'planned' ? null : 'idle'

  return (
    <div ref={rootRef} className="mm-canvas">
      <GraphCanvas
        ref={canvasRef}
        className="mm-viewport"
        ariaLabel="Карта методологии: 8 блоков и связи между ними"
        ariaRoleDescription="карта методологии"
        bounds={bounds}
        fitToken={fitReq.seq}
        refitOnResize={false}
        minZoom={MIN_K}
        maxZoom={MAX_K}
        pad={FIT_PAD}
        nodeSelector=".mm-node"
        controls={false}
        grid={false}
        onViewChange={onView}
      >
        <MapEdges paths={layout.paths} width={layout.width} height={layout.height} focusId={focusId} onPick={onPickEdge}
          labels={labels} loop={loop} loopPaused={paused || reduced} />
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
      </GraphCanvas>
    </div>
  )
}
