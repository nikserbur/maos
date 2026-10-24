/*
 * Канвас воркфлоу: пан/зум/«вписать» — общий движок GraphCanvas (вписывается при открытии, поле
 * снизу ≥ 56 px под кнопками масштаба); здесь — предметные жесты: перетаскивание шагов, протяжка
 * связи от нижнего порта, выбор связи. Шаги — карточки .gc-node (role=button, Enter — выбрать,
 * Delete — удалить); подписи веток — плашки посередине связи; связь назад — пунктирная полоса «возврат».
 */
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { GraphCanvas, type GraphCanvasHandle, type Point } from '../../ui/graph-canvas'
import { LANE_GAP, curve, edgeRoute, graphBounds, outPort } from './geometry'
import { NODE_H, NODE_META, NODE_W, type WorkflowGraph, type WorkflowNode } from './types'
import type { Selection } from './useWorkflow'

type Drag =
  | { kind: 'none' }
  | { kind: 'node'; id: string; dx: number; dy: number; key: string }
  | { kind: 'connect'; from: string }

interface WorkflowCanvasProps {
  graph: WorkflowGraph
  selection: Selection
  onSelect: (s: Selection) => void
  /** Перемещение шага; key — одно перетаскивание = один шаг отмены. */
  onMove: (id: string, x: number, y: number, key: string) => void
  onConnect: (from: string, to: string) => void
  onDeleteNode: (id: string) => void
}

let dragSeq = 0

export const WorkflowCanvas = forwardRef<GraphCanvasHandle, WorkflowCanvasProps>(function WorkflowCanvas(
  { graph, selection, onSelect, onMove, onConnect, onDeleteNode }, ref,
) {
  const canvas = useRef<GraphCanvasHandle | null>(null)
  const dragRef = useRef<Drag>({ kind: 'none' })
  const [dragKind, setDragKind] = useState<Drag['kind']>('none')
  const [pointer, setPointer] = useState<Point | null>(null)
  const nodesRef = useRef(graph.nodes)
  nodesRef.current = graph.nodes
  // Обработчики экрана — через ref: слушатели окна ставятся один раз на перетаскивание, а не на каждый кадр.
  const handlers = useRef({ onMove, onConnect })
  handlers.current = { onMove, onConnect }

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes])
  const routes = useMemo(() => graph.edges.flatMap((e) => {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    return from && to ? [{ edge: e, ...edgeRoute(from, to) }] : []
  }), [graph.edges, byId])
  const laneRight = Math.max(0, ...routes.filter((r) => r.back).map((r) => r.label.x + LANE_GAP))
  const bounds = useMemo(() => graphBounds(graph.nodes, laneRight), [graph.nodes, laneRight])

  const toWorld = (x: number, y: number): Point => canvas.current?.toWorld(x, y) ?? { x, y }
  const setRef = useCallback((h: GraphCanvasHandle | null) => {
    canvas.current = h
    if (typeof ref === 'function') ref(h)
    else if (ref) ref.current = h
  }, [ref])

  // Глобальные move/up на время перетаскивания шага или протяжки связи.
  useEffect(() => {
    if (dragKind === 'none') return undefined
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      const w = toWorld(e.clientX, e.clientY)
      if (d.kind === 'node') handlers.current.onMove(d.id, Math.round(w.x - d.dx), Math.round(w.y - d.dy), d.key)
      else if (d.kind === 'connect') setPointer(w)
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      if (d.kind === 'connect') {
        const w = toWorld(e.clientX, e.clientY)
        const target = nodesRef.current.find((n) => w.x >= n.x && w.x <= n.x + NODE_W && w.y >= n.y && w.y <= n.y + NODE_H)
        if (target && target.id !== d.from) handlers.current.onConnect(d.from, target.id)
        setPointer(null)
      }
      dragRef.current = { kind: 'none' }
      setDragKind('none')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragKind]) // eslint-disable-line react-hooks/exhaustive-deps

  const startNodeDrag = (e: ReactPointerEvent, n: WorkflowNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const w = toWorld(e.clientX, e.clientY)
    dragRef.current = { kind: 'node', id: n.id, dx: w.x - n.x, dy: w.y - n.y, key: `move:${n.id}:${++dragSeq}` }
    setDragKind('node')
    onSelect({ kind: 'node', id: n.id })
  }
  const startConnect = (e: ReactPointerEvent, n: WorkflowNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = { kind: 'connect', from: n.id }
    setDragKind('connect')
    setPointer(toWorld(e.clientX, e.clientY))
  }
  const nodeKey = (e: KeyboardEvent<HTMLDivElement>, n: WorkflowNode) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ kind: 'node', id: n.id }) }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onDeleteNode(n.id) }
  }

  const connectFrom = dragRef.current.kind === 'connect' ? dragRef.current.from : null
  const source = connectFrom ? byId.get(connectFrom) : undefined
  const rubber = source && pointer ? curve(outPort(source), pointer) : null
  const isSel = (kind: 'node' | 'edge', id: string) => selection?.kind === kind && selection.id === id

  const svg = (
    <>
      <defs>
        <marker id="wfb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="wfb__arrow" />
        </marker>
      </defs>
      {routes.map(({ edge, d, back }) => (
        <g key={edge.id} data-gc-node="true">
          <path className="wfb__edge-hit" d={d} onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'edge', id: edge.id }) }} />
          <path className={`wfb__edge${back ? ' wfb__edge--back' : ''}${isSel('edge', edge.id) ? ' is-selected' : ''}`} d={d} markerEnd="url(#wfb-arrow)" />
        </g>
      ))}
      {rubber && <path className="wfb__rubber" d={rubber} />}
    </>
  )

  return (
    <GraphCanvas
      ref={setRef}
      bounds={bounds}
      refitOnResize={false}
      minZoom={0.35}
      maxZoom={2}
      ariaLabel="Канвас воркфлоу: колесо — масштаб, перетаскивание фона — сдвиг, F — вписать"
      className="wfb__canvas"
      svg={svg}
      onBackgroundPointerDown={() => onSelect(null)}
    >
      {routes.filter((r) => r.edge.label || r.back).map(({ edge, label, back }) => (
        <button key={`l-${edge.id}`} type="button" tabIndex={-1} data-gc-node="true"
                className={`wfb__edge-label${back ? ' wfb__edge-label--back' : ''}${isSel('edge', edge.id) ? ' is-selected' : ''}`}
                style={{ left: label.x, top: label.y }}
                onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'edge', id: edge.id }) }}>
          {edge.label || 'возврат'}
        </button>
      ))}
      {graph.nodes.map((n) => {
        const meta = NODE_META[n.type]
        const selected = isSel('node', n.id)
        const dragging = dragKind === 'node' && dragRef.current.kind === 'node' && dragRef.current.id === n.id
        return (
          <div key={n.id} data-gc-node="true" role="button" tabIndex={0} aria-pressed={selected}
               aria-label={`${meta.label}: ${n.title || 'без названия'}`}
               className={`gc-node wfb__node wfb__node--${meta.tone}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`}
               style={{ left: n.x, top: n.y }}
               onPointerDown={(e) => startNodeDrag(e, n)}
               onKeyDown={(e) => nodeKey(e, n)}>
            <div className="wfb__node-cap" aria-hidden="true"><span className="wfb__glyph">{meta.glyph}</span>{meta.caption}</div>
            <div className="wfb__node-title">{n.title || '—'}</div>
            <span className="wfb__port wfb__port--in" aria-hidden="true" />
            <span className={`wfb__port wfb__port--out${connectFrom === n.id ? ' is-active' : ''}`} aria-hidden="true"
                  title="Тяните к другому шагу, чтобы связать" onPointerDown={(e) => startConnect(e, n)} />
          </div>
        )
      })}
    </GraphCanvas>
  )
})
