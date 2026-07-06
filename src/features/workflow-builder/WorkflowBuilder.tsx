import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  NODE_H,
  NODE_META,
  NODE_TYPES,
  NODE_W,
  makeId,
  type NodeType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from './types'
import { loadGraph, saveGraph } from './storage'
import './workflow-builder.css'

/** Точка в координатах канваса (мира). */
interface Point {
  x: number
  y: number
}

/** Смещение и масштаб вьюпорта (пан + зум). */
interface View {
  x: number
  y: number
  zoom: number
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 2
const AUTOSAVE_MS = 400

/** Центр входного порта узла в координатах мира. */
const inPort = (n: WorkflowNode): Point => ({ x: n.x + NODE_W / 2, y: n.y })
/** Центр выходного порта узла в координатах мира. */
const outPort = (n: WorkflowNode): Point => ({ x: n.x + NODE_W / 2, y: n.y + NODE_H })

/** Кубическая безье между двумя точками с вертикальным «провисанием». */
function edgePath(from: Point, to: Point): string {
  const dy = Math.max(40, Math.abs(to.y - from.y) * 0.5)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`
}

type Drag =
  | { kind: 'none' }
  | { kind: 'node'; id: string; offsetX: number; offsetY: number }
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'connect'; from: string; pointer: Point }

export function WorkflowBuilder() {
  const [graph, setGraph] = useState<WorkflowGraph>(() => loadGraph())
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>({ kind: 'none' })
  const [dragKind, setDragKind] = useState<Drag['kind']>('none')
  const [connectPointer, setConnectPointer] = useState<Point | null>(null)

  // ── Автосохранение (дебаунс) ──────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => saveGraph(graph), AUTOSAVE_MS)
    return () => clearTimeout(id)
  }, [graph])

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  )

  const nodeById = useMemo(() => {
    const map = new Map<string, WorkflowNode>()
    for (const n of graph.nodes) map.set(n.id, n)
    return map
  }, [graph.nodes])

  /** Экранные координаты события → координаты мира (учёт пана и зума). */
  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const left = rect?.left ?? 0
      const top = rect?.top ?? 0
      return {
        x: (clientX - left - view.x) / view.zoom,
        y: (clientY - top - view.y) / view.zoom,
      }
    },
    [view],
  )

  // ── Добавление узла из палитры (около центра канваса) ─────────────────
  const addNode = useCallback(
    (type: NodeType) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const cx = ((rect?.width ?? 800) / 2 - view.x) / view.zoom - NODE_W / 2
      const cy = ((rect?.height ?? 600) / 2 - view.y) / view.zoom - NODE_H / 2
      const jitter = graph.nodes.length * 12
      const node: WorkflowNode = {
        id: makeId(),
        type,
        x: Math.round(cx + jitter),
        y: Math.round(cy + jitter),
        title: NODE_META[type].label,
        notes: '',
      }
      setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }))
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
    },
    [graph.nodes.length, view],
  )

  // ── Обновление узла (иммутабельно) ────────────────────────────────────
  const patchNode = useCallback((id: string, patch: Partial<WorkflowNode>) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }))
  }, [])

  const deleteNode = useCallback((id: string) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
    }))
    setSelectedNodeId((cur) => (cur === id ? null : cur))
  }, [])

  const deleteEdge = useCallback((id: string) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }))
    setSelectedEdgeId((cur) => (cur === id ? null : cur))
  }, [])

  const clearAll = useCallback(() => {
    setGraph({ nodes: [], edges: [] })
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [])

  // ── Начало перетаскивания узла ────────────────────────────────────────
  const onNodePointerDown = useCallback(
    (e: React.PointerEvent, node: WorkflowNode) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const world = toWorld(e.clientX, e.clientY)
      const drag: Drag = { kind: 'node', id: node.id, offsetX: world.x - node.x, offsetY: world.y - node.y }
      dragRef.current = drag
      setDragKind('node')
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
    },
    [toWorld],
  )

  // ── Начало соединения из выходного порта ──────────────────────────────
  const onPortPointerDown = useCallback(
    (e: React.PointerEvent, node: WorkflowNode) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const world = toWorld(e.clientX, e.clientY)
      dragRef.current = { kind: 'connect', from: node.id, pointer: world }
      setDragKind('connect')
      setConnectPointer(world)
    },
    [toWorld],
  )

  // ── Пан по пустому канвасу ────────────────────────────────────────────
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y }
      setDragKind('pan')
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
    },
    [view.x, view.y],
  )

  // ── Глобальные move/up на время любого перетаскивания ─────────────────
  useEffect(() => {
    if (dragKind === 'none') return

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag.kind === 'node') {
        const world = toWorld(e.clientX, e.clientY)
        patchNode(drag.id, { x: Math.round(world.x - drag.offsetX), y: Math.round(world.y - drag.offsetY) })
      } else if (drag.kind === 'pan') {
        setView((v) => ({ ...v, x: drag.origX + (e.clientX - drag.startX), y: drag.origY + (e.clientY - drag.startY) }))
      } else if (drag.kind === 'connect') {
        setConnectPointer(toWorld(e.clientX, e.clientY))
      }
    }

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag.kind === 'connect') {
        // Ищем узел под курсором для замыкания связи.
        const world = toWorld(e.clientX, e.clientY)
        const target = graph.nodes.find(
          (n) => world.x >= n.x && world.x <= n.x + NODE_W && world.y >= n.y && world.y <= n.y + NODE_H,
        )
        if (target && target.id !== drag.from) {
          setGraph((g) => {
            const exists = g.edges.some((ed) => ed.from === drag.from && ed.to === target.id)
            if (exists) return g
            const edge: WorkflowEdge = { id: makeId(), from: drag.from, to: target.id }
            return { ...g, edges: [...g.edges, edge] }
          })
        }
        setConnectPointer(null)
      }
      dragRef.current = { kind: 'none' }
      setDragKind('none')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragKind, toWorld, patchNode, graph.nodes])

  // ── Зум колесом (к точке под курсором) ────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const px = e.clientX - (rect?.left ?? 0)
      const py = e.clientY - (rect?.top ?? 0)
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
        // Сохраняем точку под курсором на месте при масштабировании.
        const wx = (px - v.x) / v.zoom
        const wy = (py - v.y) / v.zoom
        return { zoom, x: px - wx * zoom, y: py - wy * zoom }
      })
    },
    [],
  )

  const worldStyle = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }
  const gridStyle = {
    backgroundPosition: `${view.x}px ${view.y}px, ${view.x}px ${view.y}px`,
    backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px, ${24 * view.zoom}px ${24 * view.zoom}px`,
  }

  const rubber =
    dragKind === 'connect' && connectPointer
      ? (() => {
          const source = nodeById.get((dragRef.current as { from: string }).from)
          return source ? edgePath(outPort(source), connectPointer) : null
        })()
      : null

  return (
    <div className="wfb">
      {/* ── Палитра ─────────────────────────────────────────────────── */}
      <aside className="wfb__palette">
        <div className="wfb__palette-title">Типы шагов</div>
        <p className="wfb__palette-hint">
          Кликните тип, чтобы добавить узел на канвас. Тяните от нижнего порта к другому узлу, чтобы связать шаги.
        </p>
        {NODE_TYPES.map((type) => (
          <button key={type} className="wfb__palette-btn" onClick={() => addNode(type)}>
            <span className="wfb__swatch" style={{ background: NODE_META[type].color }} />
            {NODE_META[type].label}
          </button>
        ))}
      </aside>

      {/* ── Центр: шапка + канвас ───────────────────────────────────── */}
      <section className="wfb__center">
        <header className="wfb__head">
          <div>
            <h1 className="wfb__title">Конструктор AI-воркфлоу</h1>
            <p className="wfb__desc">
              Черновик требований к будущей «мини-ChatGPT»: диалоги с пользователем и построение воркфлоу.
              Разложите шаги AI-агента узлами и опишите требования/промпт для каждого.
            </p>
          </div>
          <div className="wfb__toolbar">
            <span className="wfb__count mono">
              {graph.nodes.length} узлов · {graph.edges.length} связей
            </span>
            <button
              className="btn btn--danger"
              onClick={() => {
                if (selectedNodeId) deleteNode(selectedNodeId)
                else if (selectedEdgeId) deleteEdge(selectedEdgeId)
              }}
              disabled={!selectedNodeId && !selectedEdgeId}
            >
              Удалить выбранное
            </button>
            <button className="btn" onClick={clearAll}>
              Очистить
            </button>
          </div>
        </header>

        <div
          ref={canvasRef}
          className={dragKind === 'pan' ? 'wfb__canvas wfb__canvas--panning' : 'wfb__canvas'}
          style={gridStyle}
          onPointerDown={onCanvasPointerDown}
          onWheel={onWheel}
        >
          {/* Слой связей */}
          <svg className="wfb__edges" style={worldStyle}>
            <defs>
              <marker
                id="wfb-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-strong)" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const from = nodeById.get(edge.from)
              const to = nodeById.get(edge.to)
              if (!from || !to) return null
              const d = edgePath(outPort(from), inPort(to))
              const isSel = edge.id === selectedEdgeId
              return (
                <g key={edge.id}>
                  <path
                    className="wfb__edge-hit"
                    d={d}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setSelectedEdgeId(edge.id)
                      setSelectedNodeId(null)
                    }}
                  />
                  <path
                    className={isSel ? 'wfb__edge wfb__edge--selected' : 'wfb__edge'}
                    d={d}
                    markerEnd="url(#wfb-arrow)"
                  />
                </g>
              )
            })}
            {rubber && <path className="wfb__rubber" d={rubber} />}
          </svg>

          {/* Слой узлов */}
          <div className="wfb__world" style={worldStyle}>
            {graph.nodes.map((node) => {
              const meta = NODE_META[node.type]
              const cls =
                node.id === selectedNodeId
                  ? 'wfb__node wfb__node--selected'
                  : dragKind === 'node' && (dragRef.current as { id?: string }).id === node.id
                    ? 'wfb__node wfb__node--dragging'
                    : 'wfb__node'
              return (
                <div
                  key={node.id}
                  className={cls}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                >
                  <div className="wfb__node-head" style={{ background: meta.color }}>
                    {meta.label}
                  </div>
                  <div className="wfb__node-title">{node.title || '—'}</div>
                  <span className="wfb__port wfb__port--in" title="Вход" />
                  <span
                    className={
                      dragKind === 'connect' && (dragRef.current as { from?: string }).from === node.id
                        ? 'wfb__port wfb__port--out wfb__port--active'
                        : 'wfb__port wfb__port--out'
                    }
                    title="Выход — тяните к другому узлу"
                    onPointerDown={(e) => onPortPointerDown(e, node)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Инспектор ───────────────────────────────────────────────── */}
      <aside className="wfb__inspector">
        <div className="wfb__inspector-title">Инспектор</div>
        {selectedNode ? (
          <>
            <span className="wfb__type-chip" style={{ background: NODE_META[selectedNode.type].color }}>
              {NODE_META[selectedNode.type].label}
            </span>
            <div className="wfb__field">
              <label className="wfb__label" htmlFor="wfb-title">
                Заголовок
              </label>
              <input
                id="wfb-title"
                className="wfb__input"
                value={selectedNode.title}
                onChange={(e) => patchNode(selectedNode.id, { title: e.target.value })}
              />
            </div>
            <div className="wfb__field">
              <label className="wfb__label" htmlFor="wfb-notes">
                Требования / промпт
              </label>
              <textarea
                id="wfb-notes"
                className="wfb__textarea"
                placeholder="Что должен делать этот шаг: инструкции для LLM, условия ветвления, ожидаемый результат…"
                value={selectedNode.notes}
                onChange={(e) => patchNode(selectedNode.id, { notes: e.target.value })}
              />
            </div>
            <div className="wfb__inspector-actions">
              <button className="btn btn--danger" onClick={() => deleteNode(selectedNode.id)}>
                Удалить узел
              </button>
            </div>
          </>
        ) : selectedEdgeId ? (
          <>
            <p className="wfb__inspector-empty">Выбрана связь между шагами.</p>
            <div className="wfb__inspector-actions">
              <button className="btn btn--danger" onClick={() => deleteEdge(selectedEdgeId)}>
                Удалить связь
              </button>
            </div>
          </>
        ) : (
          <p className="wfb__inspector-empty">
            Выберите узел, чтобы задать его заголовок и требования/промпт. Кликните на связь, чтобы удалить её.
            Пустой клик по канвасу снимает выделение.
          </p>
        )}
      </aside>
    </div>
  )
}
