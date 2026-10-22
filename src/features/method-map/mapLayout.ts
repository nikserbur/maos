/**
 * Геометрия L0 (UX-V2 §3.5): фиксированные координаты блоков из реестра (сетка 8 px),
 * развёрнутый блок растёт вниз на список подблоков; рёбра — безье между портами на
 * сторонах, порты распределяются по стороне, чтобы пучки «[1][2][3] → [6]» не слипались.
 * Чистые функции без DOM — проверяются тестом.
 */
import { BLOCKS } from './blocks'
import { L0_EDGES } from './edges'
import type { BlockId, MapEdge } from './types'

export const GRID = 8
/** Высота строки подблока и отступ списка в развёрнутом блоке, px. */
export const SUB_ROW_H = 26
export const SUB_LIST_PAD = 10
const LOOP_RISE = 44
const PORT_MARGIN = 0.18

export interface Rect {
  id: BlockId
  x: number
  y: number
  w: number
  h: number
  expanded: boolean
}

export interface Point {
  x: number
  y: number
}

export interface EdgePath {
  edge: MapEdge
  d: string
  /** Точка для подписи (середина кривой). */
  label: Point
  from: Point
  to: Point
  loop: boolean
}

export interface Layout {
  rects: readonly Rect[]
  paths: readonly EdgePath[]
  width: number
  height: number
}

export function blockRects(expanded: ReadonlySet<string>, subCounts: Readonly<Record<string, number>>): Rect[] {
  return BLOCKS.map((b) => {
    const open = expanded.has(b.id)
    const extra = open ? SUB_LIST_PAD + SUB_ROW_H * (subCounts[b.id] ?? 0) : 0
    return { id: b.id, x: b.pos.x * GRID, y: b.pos.y * GRID, w: b.pos.w * GRID, h: b.pos.h * GRID + extra, expanded: open }
  })
}

type Side = 'left' | 'right' | 'top' | 'bottom'

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Сторона выхода/входа: блоки одного ряда соединяются по бокам, разных рядов — снизу/сверху. */
function sides(a: Rect, b: Rect): [Side, Side] {
  const ca = center(a)
  const cb = center(b)
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  const sameRow = Math.abs(dy) < Math.min(a.h, b.h) * 0.6
  if (sameRow) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

interface PortUse {
  edgeId: string
  rectId: string
  side: Side
  /** Координата другого конца вдоль стороны — для сортировки портов. */
  along: number
  end: 'from' | 'to'
}

function portPoint(r: Rect, side: Side, t: number): Point {
  const span = (a: number, len: number) => a + len * (PORT_MARGIN + t * (1 - 2 * PORT_MARGIN))
  switch (side) {
    case 'left': return { x: r.x, y: span(r.y, r.h) }
    case 'right': return { x: r.x + r.w, y: span(r.y, r.h) }
    case 'top': return { x: span(r.x, r.w), y: r.y }
    default: return { x: span(r.x, r.w), y: r.y + r.h }
  }
}

function bezier(p1: Point, p2: Point, s1: Side): { d: string; mid: Point } {
  const horizontal = s1 === 'left' || s1 === 'right'
  const c1 = horizontal ? { x: (p1.x + p2.x) / 2, y: p1.y } : { x: p1.x, y: (p1.y + p2.y) / 2 }
  const c2 = horizontal ? { x: (p1.x + p2.x) / 2, y: p2.y } : { x: p2.x, y: (p1.y + p2.y) / 2 }
  const at = (t: number) => ({
    x: (1 - t) ** 3 * p1.x + 3 * (1 - t) ** 2 * t * c1.x + 3 * (1 - t) * t ** 2 * c2.x + t ** 3 * p2.x,
    y: (1 - t) ** 3 * p1.y + 3 * (1 - t) ** 2 * t * c1.y + 3 * (1 - t) * t ** 2 * c2.y + t ** 3 * p2.y,
  })
  return { d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`, mid: at(0.5) }
}

/** Петля «Стадия 1 → Стадия 2» над блоком. */
function loopPath(r: Rect): { d: string; mid: Point; from: Point; to: Point } {
  const from = { x: r.x + r.w * 0.62, y: r.y }
  const to = { x: r.x + r.w * 0.38, y: r.y }
  const top = r.y - LOOP_RISE
  return {
    d: `M ${from.x} ${from.y} C ${from.x + 10} ${top}, ${to.x - 10} ${top}, ${to.x} ${to.y}`,
    mid: { x: (from.x + to.x) / 2, y: top + LOOP_RISE * 0.25 },
    from,
    to,
  }
}

export function routeEdges(rects: readonly Rect[], edges: readonly MapEdge[] = L0_EDGES): EdgePath[] {
  const byId = new Map(rects.map((r) => [r.id, r]))
  const uses: PortUse[] = []
  const plan = new Map<string, { s1: Side; s2: Side }>()
  for (const e of edges) {
    const a = byId.get(e.from as BlockId)
    const b = byId.get(e.to as BlockId)
    if (!a || !b || a === b) continue
    const [s1, s2] = sides(a, b)
    plan.set(e.id, { s1, s2 })
    const ca = center(a)
    const cb = center(b)
    const alongA = s1 === 'left' || s1 === 'right' ? cb.y : cb.x
    const alongB = s2 === 'left' || s2 === 'right' ? ca.y : ca.x
    uses.push({ edgeId: e.id, rectId: a.id, side: s1, along: alongA, end: 'from' })
    uses.push({ edgeId: e.id, rectId: b.id, side: s2, along: alongB, end: 'to' })
  }
  // Порты на одной стороне распределяются по возрастанию координаты другого конца.
  const t = new Map<string, number>()
  const groups = new Map<string, PortUse[]>()
  for (const u of uses) {
    const key = `${u.rectId}:${u.side}`
    groups.set(key, [...(groups.get(key) ?? []), u])
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((p, q) => p.along - q.along)
    sorted.forEach((u, i) => t.set(`${u.edgeId}:${u.end}`, sorted.length === 1 ? 0.5 : i / (sorted.length - 1)))
  }
  const out: EdgePath[] = []
  for (const e of edges) {
    const a = byId.get(e.from as BlockId)
    const b = byId.get(e.to as BlockId)
    if (!a || !b) continue
    if (a === b) {
      const l = loopPath(a)
      out.push({ edge: e, d: l.d, label: l.mid, from: l.from, to: l.to, loop: true })
      continue
    }
    const p = plan.get(e.id)!
    const from = portPoint(a, p.s1, t.get(`${e.id}:from`) ?? 0.5)
    const to = portPoint(b, p.s2, t.get(`${e.id}:to`) ?? 0.5)
    const { d, mid } = bezier(from, to, p.s1)
    out.push({ edge: e, d, label: mid, from, to, loop: false })
  }
  return out
}

export function layoutL0(expanded: ReadonlySet<string>, subCounts: Readonly<Record<string, number>>): Layout {
  const rects = blockRects(expanded, subCounts)
  const paths = routeEdges(rects)
  const width = Math.max(...rects.map((r) => r.x + r.w))
  const height = Math.max(...rects.map((r) => r.y + r.h))
  return { rects, paths, width, height }
}

/** Соседи блока по рёбрам `data` (клавиши → ←). */
export function dataNeighbours(block: string): { next: string[]; prev: string[] } {
  return {
    next: L0_EDGES.filter((e) => e.kind === 'data' && e.from === block && e.to !== block).map((e) => e.to),
    prev: L0_EDGES.filter((e) => e.kind === 'data' && e.to === block && e.from !== block).map((e) => e.from),
  }
}
