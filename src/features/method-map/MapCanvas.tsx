/**
 * Канвас L0 на движке `GraphCanvas` (src/ui/graph-canvas, UX-V2 §6.1): пан по фону, зум колесом
 * вокруг курсора, «вписать» с полем 48 px (центрирование — как прежде: мир с запасом −40/−60),
 * узлы-блоки поверх SVG-рёбер в одной системе координат. Внешний вид карты не меняется:
 * класс `mm-viewport` даёт ту же фоновую сетку, плавающие кнопки масштаба и сетка движка выключены —
 * масштаб и «Вписать» живут в панели MapScreen.
 * Клавиатура узлов (UX-V2 §3.10): Enter — панель, → ← — сосед по ребру data, ↓ — развернуть,
 * ↑ — свернуть; остальные клавиши экрана (1…8, F, /, ?) — в MapScreen.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { GraphCanvas, type GraphCanvasHandle, type View } from '../../ui/graph-canvas'
import { BLOCK_META } from './blocks'
import { MapEdges } from './MapEdges'
import type { LoopState } from './AgentLoop'
import { MapNodeView } from './MapNodeView'
import { dataNeighbours, layoutL0 } from './mapLayout'
import { getNode, subblocksOf } from './registry'
import { liveOf } from './deriveState'
import { BLOCK_IDS, type MethodMapState } from './types'

const MIN_K = 0.4
const MAX_K = 2.2
/** Поле «вписать» (24 px с каждой стороны — как прежний PAD 48 на ширину). */
const FIT_PAD = 24
/** Запас мира вокруг раскладки: рёбра выходят за блоки на 40 px слева и 60 px сверху. */
const WORLD_X = -40
const WORLD_Y = -60

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
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<GraphCanvasHandle>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const subCounts = Object.fromEntries(BLOCK_IDS.map((b) => [b, subblocksOf(b).length]))
  const layout = layoutL0(expanded, subCounts)
  const bounds = useMemo(
    () => ({ x: WORLD_X, y: WORLD_Y, w: layout.width + 80, h: layout.height + 100 }),
    [layout.width, layout.height],
  )
  const onView = useCallback((v: View) => onZoomChange?.(v.k), [onZoomChange])

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

  const focusId = hoveredId ?? (selectedId ? getNode(selectedId)?.block ?? null : null)
  // Петля [6] → [4]: пульсирует, когда агент реально работал (estimated), тускло — когда реализован, но без политики.
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
        fitToken={fitToken}
        minZoom={MIN_K}
        maxZoom={MAX_K}
        pad={FIT_PAD}
        nodeSelector=".mm-node"
        controls={false}
        grid={false}
        onViewChange={onView}
      >
        <MapEdges paths={layout.paths} width={layout.width} height={layout.height} focusId={focusId} onPick={onPickEdge} loop={loop} />
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
