/**
 * Граф материального потока — ровно та сеть, которую разворачивает движок
 * (Expander в Scheduler.cpp): вход → операция (operation_inputs, норма на единицу),
 * операция k → операция k+1 той же техкарты (order_no), последняя операция → изделие.
 *
 * Узлы: сырьё ▲ (листья без техкарты), операция ■ (цвет — ведущий тип РЦ),
 * полуфабрикат ○ (производится и потребляется, не продаётся), изделие ● (продаётся
 * или нигде не потребляется). Маршрут изделия можно «свернуть» в его узел — тогда
 * входы всех операций сходятся прямо в изделие (уровень состава изделия).
 */
import type { GraphEdge, GraphNode, NodeKind, ProcessGraph, ProcessModel, ResourceRow } from './types'

export interface GraphOptions {
  /** Изделия, чей маршрут свёрнут в узел изделия. */
  collapsed?: ReadonlySet<string>
}

export const productNodeId = (productId: string): string => `p:${productId}`
export const opNodeId = (opId: string): string => `o:${opId}`

const byCodeThenId = (a: { code: string; id: string }, b: { code: string; id: string }): number => {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Изделия с техкартой (их маршрут можно свернуть). */
export function producedProductIds(model: ProcessModel): string[] {
  return [...model.products.values()].filter((p) => p.opIds.length > 0).sort(byCodeThenId).map((p) => p.id)
}

function productKind(model: ProcessModel, productId: string): NodeKind {
  const p = model.products.get(productId)
  if (!p || p.opIds.length === 0) return 'raw'
  const consumed = (model.consumersOf.get(productId)?.length ?? 0) > 0
  return p.sellable || !consumed ? 'product' : 'semi'
}

interface OpBadges {
  machines: number
  operators: number
  laborConstrained: boolean
}

function opBadges(wcTypeIds: readonly string[], resources: ReadonlyMap<string, ResourceRow>): OpBadges {
  let machines = 0
  let fallbackOperators = -1
  const union = new Set<string>()
  for (const t of wcTypeIds) {
    const r = resources.get(t)
    if (!r) continue
    machines += r.machines
    if (r.fallbackAll) fallbackOperators = Math.max(fallbackOperators, r.effectiveOperators)
    else for (const w of r.eligibleWorkerIds) union.add(w)
  }
  const lead = wcTypeIds.length ? resources.get(wcTypeIds[0]) : undefined
  return {
    machines,
    operators: fallbackOperators >= 0 ? fallbackOperators : union.size,
    laborConstrained: Boolean(lead?.laborConstrained),
  }
}

export function buildGraph(
  model: ProcessModel,
  resources: ReadonlyMap<string, ResourceRow>,
  options: GraphOptions = {},
): ProcessGraph {
  const collapsed = options.collapsed ?? new Set<string>()
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const all = [...model.products.values()].sort(byCodeThenId)
  const inFlow = all.filter((p) => p.opIds.length > 0 || (model.consumersOf.get(p.id)?.length ?? 0) > 0)
  const isolatedProducts = all.length - inFlow.length

  const productNode = (pid: string, collapsedOps: number): GraphNode => {
    const p = model.products.get(pid)
    const kind = productKind(model, pid)
    return {
      id: productNodeId(pid),
      kind,
      refId: pid,
      label: p?.name ?? pid,
      code: p?.code ?? '',
      productId: pid,
      wcTypeId: null,
      colorIndex: null,
      collapsedOps,
      machines: 0,
      operators: 0,
      laborConstrained: false,
      noRouting: kind === 'raw' && !p?.purchased,
      noMachines: false,
    }
  }

  // Сырьё — первым (левый край потока), затем изделия с маршрутами.
  for (const p of inFlow) if (p.opIds.length === 0) nodes.push(productNode(p.id, 0))

  for (const p of inFlow) {
    if (p.opIds.length === 0) continue
    const pid = p.id
    if (collapsed.has(pid)) {
      nodes.push(productNode(pid, p.opIds.length))
      const agg = new Map<string, { qty: number; opIds: string[] }>()
      for (const oid of p.opIds) {
        for (const inp of model.ops.get(oid)?.inputs ?? []) {
          if (inp.productId === pid) continue // самопотребление — без петли
          const cur = agg.get(inp.productId) ?? { qty: 0, opIds: [] }
          cur.qty += inp.qty
          cur.opIds.push(oid)
          agg.set(inp.productId, cur)
        }
      }
      for (const [qid, a] of agg) {
        edges.push({
          id: `e:in:${pid}:${qid}`,
          from: productNodeId(qid),
          to: productNodeId(pid),
          kind: 'input',
          qty: a.qty,
          unit: model.products.get(qid)?.unit ?? '',
          opIds: a.opIds,
        })
      }
      continue
    }

    let prev: string | null = null
    for (const oid of p.opIds) {
      const op = model.ops.get(oid)
      if (!op) continue
      const lead = op.wcTypeIds[0] ?? null
      const badges = opBadges(op.wcTypeIds, resources)
      nodes.push({
        id: opNodeId(oid),
        kind: 'op',
        refId: oid,
        label: op.name,
        code: op.code,
        productId: pid,
        wcTypeId: lead,
        colorIndex: lead ? (model.wcTypes.get(lead)?.colorIndex ?? null) : null,
        collapsedOps: 0,
        machines: badges.machines,
        operators: badges.operators,
        laborConstrained: badges.laborConstrained,
        noRouting: false,
        noMachines: badges.machines === 0,
      })
      for (const inp of op.inputs) {
        edges.push({
          id: `e:in:${oid}:${inp.productId}`,
          from: productNodeId(inp.productId),
          to: opNodeId(oid),
          kind: 'input',
          qty: inp.qty,
          unit: model.products.get(inp.productId)?.unit ?? '',
          opIds: [oid],
        })
      }
      if (prev) {
        edges.push({ id: `e:seq:${prev}:${oid}`, from: opNodeId(prev), to: opNodeId(oid), kind: 'sequence', qty: null, unit: '', opIds: [oid] })
      }
      prev = oid
    }
    nodes.push(productNode(pid, 0))
    if (prev) {
      edges.push({ id: `e:out:${prev}:${pid}`, from: opNodeId(prev), to: productNodeId(pid), kind: 'output', qty: null, unit: '', opIds: [prev] })
    }
  }

  return { nodes, edges, isolatedProducts }
}

/** Подграф «маршрут узла»: сам узел + все предки (из чего сделан) + потомки (куда идёт). */
export function focusSubgraph(graph: ProcessGraph, nodeId: string): ProcessGraph {
  if (!graph.nodes.some((n) => n.id === nodeId)) return graph
  const succ = new Map<string, string[]>()
  const pred = new Map<string, string[]>()
  for (const e of graph.edges) {
    succ.set(e.from, [...(succ.get(e.from) ?? []), e.to])
    pred.set(e.to, [...(pred.get(e.to) ?? []), e.from])
  }
  const keep = new Set<string>([nodeId])
  const walk = (adj: Map<string, string[]>) => {
    const seen = new Set<string>([nodeId])
    const queue = [nodeId]
    while (queue.length) {
      const v = queue.shift() as string
      for (const w of adj.get(v) ?? []) {
        if (seen.has(w)) continue
        seen.add(w)
        keep.add(w)
        queue.push(w)
      }
    }
  }
  walk(pred)
  walk(succ)
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    isolatedProducts: graph.isolatedProducts,
  }
}

/** Узлы, чьё имя / код / id содержат запрос (без учёта регистра). */
export function matchNodes(graph: ProcessGraph, query: string): Set<string> {
  const q = query.trim().toLocaleLowerCase('ru')
  const out = new Set<string>()
  if (!q) return out
  for (const n of graph.nodes) {
    const hay = `${n.label}\u0000${n.code}\u0000${n.refId}`.toLocaleLowerCase('ru')
    if (hay.includes(q)) out.add(n.id)
  }
  return out
}

/** Соседи узла (для подсветки рёбер при выборе). */
export function incidentEdgeIds(graph: ProcessGraph, nodeId: string): Set<string> {
  const out = new Set<string>()
  for (const e of graph.edges) if (e.from === nodeId || e.to === nodeId) out.add(e.id)
  return out
}

export interface GraphCounts {
  raw: number
  op: number
  semi: number
  product: number
  edges: number
}

export function graphCounts(graph: ProcessGraph): GraphCounts {
  const c: GraphCounts = { raw: 0, op: 0, semi: 0, product: 0, edges: graph.edges.length }
  for (const n of graph.nodes) c[n.kind] += 1
  return c
}
