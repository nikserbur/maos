/**
 * Потоки между типами РЦ (analytics.sankey): подсчёт переходов соседних операций
 * заказа и раскладка двудольной диаграммы «откуда → куда» с лентами-полосами.
 */
import type { SimTaskDto } from '../../lib/api'

export interface FlowLink { from: string; to: string; v: number }
export interface FlowModel {
  /** Типы РЦ в порядке переделов (по среднему времени начала их операций). */
  types: string[]
  links: FlowLink[]
}

/**
 * Поток: последовательные (по началу) операции одного заказа на станках разных
 * типов дают +1 к ленте тип_a → тип_b. null — нет задач.
 */
export function buildFlows(tasks: readonly SimTaskDto[] | undefined, machineType: ReadonlyMap<string, string>): FlowModel | null {
  if (!tasks?.length) return null
  const byOrder = new Map<number, SimTaskDto[]>()
  for (const t of tasks) byOrder.set(t.order_idx, [...(byOrder.get(t.order_idx) ?? []), t])
  const flow = new Map<string, number>()
  const stageSum = new Map<string, { s: number; n: number }>()
  byOrder.forEach((list) => {
    const arr = [...list].sort((a, b) => a.start - b.start)
    for (const t of arr) {
      const ty = machineType.get(t.machine_id)
      if (!ty) continue
      const ss = stageSum.get(ty) ?? { s: 0, n: 0 }
      stageSum.set(ty, { s: ss.s + t.start, n: ss.n + 1 })
    }
    for (let i = 0; i + 1 < arr.length; i++) {
      const a = machineType.get(arr[i].machine_id), b = machineType.get(arr[i + 1].machine_id)
      if (!a || !b || a === b) continue
      const k = `${a}\u0000${b}`
      flow.set(k, (flow.get(k) ?? 0) + 1)
    }
  })
  const mean = (t: string) => { const s = stageSum.get(t)!; return s.s / s.n }
  const types = [...stageSum.keys()].sort((a, b) => mean(a) - mean(b))
  const links = [...flow.entries()].map(([k, v]) => {
    const [from, to] = k.split('\u0000')
    return { from, to, v }
  })
  return { types, links }
}

export interface SankeyNode {
  type: string
  side: 'src' | 'dst'
  y: number
  h: number
  total: number
  /** Индекс типа в порядке переделов → цвет --chart-n. */
  order: number
}
export interface SankeyRibbon extends FlowLink {
  y0: number; y0b: number
  y1: number; y1b: number
  order: number
}
export interface SankeyLayout {
  nodes: SankeyNode[]
  ribbons: SankeyRibbon[]
  height: number
  total: number
  max: number
}

/**
 * Раскладка: слева источники (исходящий поток), справа приёмники (входящий),
 * высота узла ∝ его потоку, ленты уложены стопкой в порядке переделов.
 */
export function layoutSankey(model: FlowModel, opts: { rowMin?: number; gap?: number; pxPerUnitMax?: number } = {}): SankeyLayout {
  const gap = opts.gap ?? 14
  const rowMin = opts.rowMin ?? 34
  const order = new Map(model.types.map((t, i) => [t, i]))
  const links = model.links.filter((l) => l.v > 0)
  const outOf = new Map<string, number>(), inTo = new Map<string, number>()
  for (const l of links) {
    outOf.set(l.from, (outOf.get(l.from) ?? 0) + l.v)
    inTo.set(l.to, (inTo.get(l.to) ?? 0) + l.v)
  }
  const byStage = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
  const srcTypes = [...outOf.keys()].sort(byStage)
  const dstTypes = [...inTo.keys()].sort(byStage)
  const total = links.reduce((s, l) => s + l.v, 0)
  const rows = Math.max(srcTypes.length, dstTypes.length, 1)
  const height = Math.max(rows * rowMin + (rows - 1) * gap, 160)
  const k = total > 0 ? Math.min(opts.pxPerUnitMax ?? 40, (height - (rows - 1) * gap) / total) : 0

  const place = (list: string[], side: 'src' | 'dst', amount: Map<string, number>): SankeyNode[] => {
    const hs = list.map((t) => Math.max(3, (amount.get(t) ?? 0) * k))
    const used = hs.reduce((s, h) => s + h, 0) + (list.length - 1) * gap
    let y = (height - used) / 2
    return list.map((t, i) => {
      const node = { type: t, side, y, h: hs[i], total: amount.get(t) ?? 0, order: order.get(t) ?? 0 }
      y += hs[i] + gap
      return node
    })
  }
  const src = place(srcTypes, 'src', outOf)
  const dst = place(dstTypes, 'dst', inTo)
  const srcAt = new Map(src.map((n) => [n.type, n])), dstAt = new Map(dst.map((n) => [n.type, n]))
  const outCursor = new Map(src.map((n) => [n.type, n.y])), inCursor = new Map(dst.map((n) => [n.type, n.y]))

  // Толщина ленты у узла = доля её потока в потоке узла × высота узла (узел заполнен без зазоров).
  const thick = (node: SankeyNode | undefined, v: number) => (node && node.total > 0 ? (v / node.total) * node.h : 0)

  // Порядок укладки: у источника — по стадии приёмника, у приёмника — по стадии источника.
  const outOrder = [...links].sort((a, b) => byStage(a.from, b.from) || byStage(a.to, b.to))
  const y0Of = new Map<FlowLink, number>()
  for (const l of outOrder) {
    const y = outCursor.get(l.from) ?? 0
    y0Of.set(l, y)
    outCursor.set(l.from, y + thick(srcAt.get(l.from), l.v))
  }
  const inOrder = [...links].sort((a, b) => byStage(a.to, b.to) || byStage(a.from, b.from))
  const ribbons: SankeyRibbon[] = inOrder.map((l) => {
    const y1 = inCursor.get(l.to) ?? 0
    const th1 = thick(dstAt.get(l.to), l.v)
    inCursor.set(l.to, y1 + th1)
    const y0 = y0Of.get(l) ?? 0
    return { ...l, y0, y0b: y0 + thick(srcAt.get(l.from), l.v), y1, y1b: y1 + th1, order: order.get(l.from) ?? 0 }
  })
  return { nodes: [...src, ...dst], ribbons, height, total, max: links.reduce((m, l) => Math.max(m, l.v), 0) }
}
