/*
 * Чистые операции над графом воркфлоу (иммутабельно) и ограниченная история снимков для
 * Cmd/Ctrl+Z · Shift+Z (X2 P-135). Без DOM — проверяются vitest.
 */
import { NODE_H, NODE_W, makeId, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from './types'

/* ── Операции ─────────────────────────────────────────────────────────────── */

export function patchNode(g: WorkflowGraph, id: string, patch: Partial<Omit<WorkflowNode, 'id'>>): WorkflowGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }
}

export function patchEdge(g: WorkflowGraph, id: string, patch: Partial<Pick<WorkflowEdge, 'label'>>): WorkflowGraph {
  return {
    ...g,
    edges: g.edges.map((e) => {
      if (e.id !== id) return e
      const label = patch.label?.trim() ? patch.label : undefined
      const { label: _old, ...rest } = e
      return label ? { ...rest, label } : rest
    }),
  }
}

export interface Removed { node: WorkflowNode; edges: WorkflowEdge[] }

/** Удалить шаг вместе с его связями; removed — чтобы вернуть по «Отменить». */
export function removeNode(g: WorkflowGraph, id: string): { graph: WorkflowGraph; removed: Removed | null } {
  const node = g.nodes.find((n) => n.id === id)
  if (!node) return { graph: g, removed: null }
  const edges = g.edges.filter((e) => e.from === id || e.to === id)
  return {
    graph: { nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) },
    removed: { node, edges },
  }
}

/** Вернуть удалённый шаг и те его связи, оба конца которых снова на месте. */
export function restoreNode(g: WorkflowGraph, r: Removed): WorkflowGraph {
  if (g.nodes.some((n) => n.id === r.node.id)) return g
  const nodes = [...g.nodes, r.node]
  const ids = new Set(nodes.map((n) => n.id))
  const edges = [...g.edges, ...r.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && !g.edges.some((x) => x.id === e.id))]
  return { nodes, edges }
}

export function removeEdge(g: WorkflowGraph, id: string): WorkflowGraph {
  return { ...g, edges: g.edges.filter((e) => e.id !== id) }
}

/** Связь from → to (без петель и дублей); null — связь не добавлена. */
export function connect(g: WorkflowGraph, from: string, to: string, label?: string): { graph: WorkflowGraph; edge: WorkflowEdge | null } {
  const known = g.nodes.some((n) => n.id === from) && g.nodes.some((n) => n.id === to)
  if (!known || from === to || g.edges.some((e) => e.from === from && e.to === to)) return { graph: g, edge: null }
  const edge: WorkflowEdge = { id: makeId(), from, to, ...(label ? { label } : {}) }
  return { graph: { ...g, edges: [...g.edges, edge] }, edge }
}

/** Добавить снимок обратно к текущему графу (после «Очистить» и правок): недостающие шаги и связи. */
export function mergeGraph(g: WorkflowGraph, back: WorkflowGraph): WorkflowGraph {
  const have = new Set(g.nodes.map((n) => n.id))
  const nodes = [...g.nodes, ...back.nodes.filter((n) => !have.has(n.id))]
  const ids = new Set(nodes.map((n) => n.id))
  const edgeIds = new Set(g.edges.map((e) => e.id))
  const edges = [...g.edges, ...back.edges.filter((e) => !edgeIds.has(e.id) && ids.has(e.from) && ids.has(e.to))]
  return { nodes, edges }
}

const STEP = 24

/** Место для нового шага: центр вида; занято — сдвиг по диагонали, пока не освободится. */
export function freeSpot(g: WorkflowGraph, center: { x: number; y: number }): { x: number; y: number } {
  let x = Math.round(center.x - NODE_W / 2)
  let y = Math.round(center.y - NODE_H / 2)
  for (let i = 0; i < 40 && g.nodes.some((n) => Math.abs(n.x - x) < STEP && Math.abs(n.y - y) < STEP); i += 1) {
    x += STEP
    y += STEP
  }
  return { x, y }
}

/* ── История снимков ──────────────────────────────────────────────────────── */

export const HISTORY_LIMIT = 50

export interface History {
  past: WorkflowGraph[]
  present: WorkflowGraph
  future: WorkflowGraph[]
  /** Ключ последней правки: подряд идущие правки с тем же ключом (набор текста, одно перетаскивание) — один шаг отмены. */
  lastKey: string | null
}

export const initHistory = (g: WorkflowGraph): History => ({ past: [], present: g, future: [], lastKey: null })

export function commit(h: History, next: WorkflowGraph, key: string | null = null): History {
  if (next === h.present) return h
  if (key !== null && key === h.lastKey) return { ...h, present: next, future: [] }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], lastKey: key }
}

export function undo(h: History): History {
  if (h.past.length === 0) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future].slice(0, HISTORY_LIMIT), lastKey: null }
}

export function redo(h: History): History {
  if (h.future.length === 0) return h
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: h.future[0], future: h.future.slice(1), lastKey: null }
}
