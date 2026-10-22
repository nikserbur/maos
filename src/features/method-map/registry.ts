/**
 * Статический реестр «Карты методологии» (UX-V2 §3.9): 8 блоков → подблоки →
 * параметры / формулы / датасеты / экраны + рёбра. Проверяется тестами целостности
 * (`registry.test.ts`): все `metricId` есть в METRICS, все `screen.id` — в SCREENS,
 * все `diagram`/`learnMore` — зарегистрированы, у каждого блока ≥ 1 экран.
 *
 *   import { REGISTRY, getNode, childrenOf } from '../method-map/registry'
 */
import pkg from '../../../package.json'
import { getMetric } from '../../explain/metrics'
import { BLOCKS, blockOf } from './blocks'
import { ALL_EDGES } from './edges'
import { FLOW_NODES } from './nodes.flow'
import { LOOP_NODES } from './nodes.loops'
import { getParamDef } from './params'
import type { BlockId, MapEdge, MapNode, MethodMapRegistry, ScreenLink } from './types'

/** Узлы-блоки строятся из BLOCKS: номер, название, глиф, координаты L0. */
const BLOCK_NODES: readonly MapNode[] = BLOCKS.map((b) => ({
  id: b.id, kind: 'block', block: b.id, title: b.title, short: b.summary, shape: b.shape, pos: b.pos,
}))

/** Параметры и формулы берут подпись из своих реестров — один источник истины для текста. */
function enrich(node: MapNode): MapNode {
  if (node.kind === 'parameter' && node.paramId) {
    const def = getParamDef(node.paramId)
    if (def) return { ...node, title: def.label, screen: node.screen ?? def.screen, stage: node.stage ?? def.stage }
  }
  if (node.kind === 'formula' && node.metricId) {
    const m = getMetric(node.metricId)
    if (m) return { ...node, title: m.title, short: m.short, diagram: node.diagram ?? m.diagram, learnMore: node.learnMore ?? m.learnMore }
  }
  return node
}

export const NODES: readonly MapNode[] = [...BLOCK_NODES, ...FLOW_NODES, ...LOOP_NODES].map(enrich)

export const REGISTRY: MethodMapRegistry = Object.freeze({
  version: pkg.version,
  nodes: NODES,
  edges: ALL_EDGES,
})

const NODE_INDEX: Readonly<Record<string, MapNode>> = Object.freeze(
  Object.fromEntries(NODES.map((n) => [n.id, n])),
)

const CHILDREN: ReadonlyMap<string, readonly MapNode[]> = (() => {
  const map = new Map<string, MapNode[]>()
  for (const n of NODES) {
    if (!n.parent) continue
    const list = map.get(n.parent) ?? []
    map.set(n.parent, [...list, n])
  }
  return map
})()

export function getNode(id: string): MapNode | undefined {
  return Object.prototype.hasOwnProperty.call(NODE_INDEX, id) ? NODE_INDEX[id] : undefined
}

export function childrenOf(id: string): readonly MapNode[] {
  return CHILDREN.get(id) ?? []
}

/** Подблоки блока в порядке реестра. */
export function subblocksOf(block: BlockId): readonly MapNode[] {
  return childrenOf(block)
}

/** Все узлы-потомки (подблоки и листья) блока. */
export function descendantsOf(id: string): readonly MapNode[] {
  const out: MapNode[] = []
  const walk = (parent: string) => {
    for (const child of childrenOf(parent)) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return out
}

/** Путь от блока к узлу: [block, subblock, node]. */
export function pathOf(id: string): readonly MapNode[] {
  const path: MapNode[] = []
  let cur = getNode(id)
  while (cur) {
    path.unshift(cur)
    cur = cur.parent ? getNode(cur.parent) : undefined
  }
  return path
}

/** Рёбра, касающиеся узла (для панели: входы/выходы). */
export function edgesOf(id: string): { incoming: readonly MapEdge[]; outgoing: readonly MapEdge[] } {
  return {
    incoming: ALL_EDGES.filter((e) => e.to === id && e.from !== id),
    outgoing: ALL_EDGES.filter((e) => e.from === id && e.to !== id),
  }
}

/** Узел-формула для записи реестра «i» (ссылка «Узел на карте» в InfoTip). */
export function nodeForMetric(metricId: string): MapNode | undefined {
  return NODES.find((n) => n.kind === 'formula' && n.metricId === metricId)
}

/** Блоки, которые реализует экран (по узлам со `screen.id`). */
export function blocksForScreen(screenId: string): readonly BlockId[] {
  const set = new Set<BlockId>()
  for (const n of NODES) if (n.screen?.id === screenId) set.add(n.block)
  return BLOCKS.filter((b) => set.has(b.id)).map((b) => b.id)
}

/** Экран, на который ведёт «Открыть экран» у узла: свой или унаследованный от подблока/блока. */
export function screenFor(node: MapNode): ScreenLink {
  if (node.screen) return node.screen
  const parent = node.parent ? getNode(node.parent) : undefined
  if (parent?.screen) return parent.screen
  const firstScreen = subblocksOf(node.block).find((s) => s.screen)?.screen
  return firstScreen ?? { id: blockOf(node.block).id === 'llm' ? 'methodology' : 'map' }
}

/** Поиск по названию, id, metricId и paramId (командная строка «/»). */
export function searchNodes(query: string, limit = 12): readonly MapNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const score = (n: MapNode): number => {
    const hay = [n.title, n.id, n.metricId ?? '', n.paramId ?? '', n.short ?? ''].join(' ').toLowerCase()
    if (n.title.toLowerCase().startsWith(q)) return 3
    if (n.title.toLowerCase().includes(q)) return 2
    return hay.includes(q) ? 1 : 0
  }
  return NODES.map((n) => ({ n, s: score(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.n)
}
