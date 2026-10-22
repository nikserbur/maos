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
import { GraphCanvas, type GraphCanvasHandle, type Point } from '../../ui/graph-canvas'
import './workflow-builder.css'

/*
 * Конструктор AI-воркфлоу. Пан/зум/«вписать» — общий движок `GraphCanvas` (src/ui/graph-canvas,
 * UX-V2 §6.1); здесь остаются только предметные жесты: перетаскивание узлов и протяжка связей.
 */

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

/** Границы графа в мире — для «вписать». */
function graphBounds(nodes: ReadonlyArray<WorkflowNode>) {
  if (nodes.length === 0) return { x: 0, y: 0, w: 800, h: 600 }
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) + NODE_W - x, h: Math.max(...ys) + NODE_H - y }
}

type Drag =
  | { kind: 'none' }
  | { kind: 'node'; id: string; offsetX: number; offsetY: number }
  | { kind: 'connect'; from: string; pointer: Point }

export function WorkflowBuilder() {
  const [graph, setGraph] = useState<WorkflowGraph>(() => loadGraph())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const canvasRef = useRef<GraphCanvasHandle>(null)
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

  const bounds = useMemo(() => graphBounds(graph.nodes), [graph.nodes])

  /** Экранные координаты события → координаты мира (через движок канваса). */
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    return canvasRef.current?.toWorld(clientX, clientY) ?? { x: clientX, y: clientY }
  }, [])

  // ── Добавление узла из палитры (около центра видимой области) ─────────
  const addNode = useCallback(
    (type: NodeType) => {
      const view = canvasRef.current?.getView() ?? { x: 0, y: 0, k: 1 }
      const cx = (400 - view.x) / view.k - NODE_W / 2
      const cy = (300 - view.y) / view.k - NODE_H / 2
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
    [graph.nodes.length],
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
      dragRef.current = { kind: 'node', id: node.id, offsetX: world.x - node.x, offsetY: world.y - node.y }
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

  // ── Глобальные move/up на время перетаскивания узла или связи ─────────
  useEffect(() => {
    if (dragKind === 'none') return

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (drag.kind === 'node') {
        const world = toWorld(e.clientX, e.clientY)
        patchNode(drag.id, { x: Math.round(world.x - drag.offsetX), y: Math.round(world.y - drag.offsetY) })
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

  const rubber =
    dragKind === 'connect' && connectPointer
      ? (() => {
          const source = nodeById.get((dragRef.current as { from: string }).from)
          return source ? edgePath(outPort(source), connectPointer) : null
        })()
      : null

  const edgesSvg = (
    <>
      <defs>
        <marker id="wfb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
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
          <g key={edge.id} data-gc-node="true">
            <path
              className="wfb__edge-hit"
              d={d}
              onPointerDown={(e) => {
                e.stopPropagation()
                setSelectedEdgeId(edge.id)
                setSelectedNodeId(null)
              }}
            />
            <path className={isSel ? 'wfb__edge wfb__edge--selected' : 'wfb__edge'} d={d} markerEnd="url(#wfb-arrow)" />
          </g>
        )
      })}
      {rubber && <path className="wfb__rubber" d={rubber} />}
    </>
  )

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

        <GraphCanvas
          ref={canvasRef}
          bounds={bounds}
          autoFit={false}
          minZoom={0.35}
          maxZoom={2}
          ariaLabel="Канвас воркфлоу: колесо — масштаб, перетаскивание фона — сдвиг, F — вписать"
          className="wfb__canvas"
          svg={edgesSvg}
          onBackgroundPointerDown={() => {
            setSelectedNodeId(null)
            setSelectedEdgeId(null)
          }}
        >
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
                data-gc-node="true"
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
        </GraphCanvas>
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
