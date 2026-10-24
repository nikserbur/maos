/*
 * Геометрия канваса воркфлоу (в координатах мира): порты, маршрут связи и место её подписи.
 * Прямая связь — кубическая кривая сверху вниз; связь назад (вход выше выхода) идёт по боковой
 * пунктирной полосе «возврат» справа от обоих шагов, чтобы не пересекать карточки.
 */
import type { Point } from '../../ui/graph-canvas'
import { NODE_H, NODE_W, type WorkflowNode } from './types'

/** Центр входного порта (верх карточки). */
export const inPort = (n: WorkflowNode): Point => ({ x: n.x + NODE_W / 2, y: n.y })
/** Центр выходного порта (низ карточки). */
export const outPort = (n: WorkflowNode): Point => ({ x: n.x + NODE_W / 2, y: n.y + NODE_H })

/** Отступ полосы возврата от правого края карточек и вылет связи из порта. */
export const LANE_GAP = 48
const STUB = 18
const R = 10

export interface EdgeRoute {
  d: string
  /** Точка подписи ветки или «возврат». */
  label: Point
  back: boolean
}

/** Кривая между двумя точками с вертикальным «провисанием» (резиновая нить при протяжке). */
export function curve(from: Point, to: Point): string {
  const dy = Math.max(40, Math.abs(to.y - from.y) * 0.5)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + dy}, ${to.x} ${to.y - dy}, ${to.x} ${to.y}`
}

/** Ломаная со скруглёнными углами радиуса R. */
function rounded(pts: readonly Point[]): string {
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const r1 = Math.min(R, Math.hypot(b.x - a.x, b.y - a.y) / 2)
    const r2 = Math.min(R, Math.hypot(c.x - b.x, c.y - b.y) / 2)
    const p1 = { x: b.x + Math.sign(a.x - b.x) * r1, y: b.y + Math.sign(a.y - b.y) * r1 }
    const p2 = { x: b.x + Math.sign(c.x - b.x) * r2, y: b.y + Math.sign(c.y - b.y) * r2 }
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${last.x} ${last.y}`
}

/** Маршрут связи from → to и место подписи. */
export function edgeRoute(from: WorkflowNode, to: WorkflowNode): EdgeRoute {
  const a = outPort(from)
  const b = inPort(to)
  if (b.y >= a.y) return { d: curve(a, b), label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, back: false }
  const lane = Math.max(from.x, to.x) + NODE_W + LANE_GAP
  const pts = [a, { x: a.x, y: a.y + STUB }, { x: lane, y: a.y + STUB }, { x: lane, y: b.y - STUB }, { x: b.x, y: b.y - STUB }, b]
  return { d: rounded(pts), label: { x: lane, y: (a.y + b.y) / 2 }, back: true }
}

/** Границы графа для «вписать»: карточки и полосы возврата. */
export function graphBounds(nodes: ReadonlyArray<WorkflowNode>, laneRight = 0): { x: number; y: number; w: number; h: number } {
  if (nodes.length === 0) return { x: 0, y: 0, w: 800, h: 600 }
  const x = Math.min(...nodes.map((n) => n.x))
  const y = Math.min(...nodes.map((n) => n.y))
  const right = Math.max(laneRight, ...nodes.map((n) => n.x + NODE_W))
  const bottom = Math.max(...nodes.map((n) => n.y + NODE_H))
  return { x, y, w: right - x, h: bottom - y }
}
