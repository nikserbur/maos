/**
 * Послойная раскладка ориентированного графа (Sugiyama), без зависимостей, детерминированная:
 *  1. компоненты связности раскладываются отдельно и складываются сверху вниз
 *     (одиночные узлы — сеткой внизу);
 *  2. циклы разрываются разворотом обратных рёбер итеративного DFS;
 *  3. слои — самый длинный путь от истоков (поток слева направо), затем истоки
 *     подтягиваются вплотную к первому потребителю (короче рёбра «сырьё → операция»);
 *  4. длинные рёбра режутся фиктивными вершинами на каждом промежуточном слое;
 *  5. порядок в слоях: DFS-порядок + барицентрические проходы вниз/вверх
 *     (лучший по числу пересечений, счёт пересечений — деревом Фенвика);
 *  6. вертикали: несколько проходов «к среднему соседей» с точной проекцией на
 *     ограничения порядка/зазоров (изотоническая регрессия, PAV) — цепочки выпрямляются.
 * Точки рёбер — от центра к центру через фиктивные вершины; обрезку по форме делает рендер.
 */

export interface LayoutNodeInput {
  id: string
  width: number
  height: number
}
export interface LayoutEdgeInput {
  id: string
  from: string
  to: string
}
export interface LayoutOptions {
  layerGap?: number
  nodeGap?: number
  /** Проходов уменьшения пересечений (рекомендуется 2–4). */
  sweeps?: number
  componentGap?: number
  /** Проходов выравнивания вертикалей. */
  alignPasses?: number
}
export interface Point {
  x: number
  y: number
}
export interface PositionedNode {
  id: string
  /** Центр узла. */
  x: number
  y: number
  width: number
  height: number
  layer: number
  order: number
  component: number
}
export interface RoutedEdge {
  id: string
  from: string
  to: string
  points: Point[]
  /** Ребро шло против потока (разрыв цикла). */
  reversed: boolean
}
export interface LayoutResult {
  nodes: Map<string, PositionedNode>
  edges: RoutedEdge[]
  width: number
  height: number
  layerCount: number
  crossings: number
}

const DEFAULTS: Required<LayoutOptions> = { layerGap: 72, nodeGap: 36, sweeps: 4, componentGap: 64, alignPasses: 8 }
const DUMMY_H = 6
const DUMMY_GAP = 10

/** Пересечения между двумя соседними слоями: links = [позиция сверху, позиция снизу]. */
export function countBilayerCrossings(links: ReadonlyArray<readonly [number, number]>, lowerSize: number): number {
  if (links.length < 2) return 0
  const sorted = [...links].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const tree = new Array<number>(lowerSize + 1).fill(0)
  let seen = 0
  let crossings = 0
  for (const [, low] of sorted) {
    let le = 0 // сколько уже встреченных ≤ low
    for (let i = low + 1; i > 0; i -= i & -i) le += tree[i]
    crossings += seen - le
    for (let i = low + 1; i <= lowerSize; i += i & -i) tree[i] += 1
    seen += 1
  }
  return crossings
}

/** Изотоническая регрессия (PAV): неубывающее z, ближайшее к target по МНК. */
function isotonic(target: number[]): number[] {
  const val: number[] = [], wt: number[] = [], len: number[] = []
  for (const t of target) {
    val.push(t); wt.push(1); len.push(1)
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const w = wt[wt.length - 2] + wt[wt.length - 1]
      const v = (val[val.length - 2] * wt[wt.length - 2] + val[val.length - 1] * wt[wt.length - 1]) / w
      const l = len[len.length - 2] + len[len.length - 1]
      val.splice(-2, 2, v); wt.splice(-2, 2, w); len.splice(-2, 2, l)
    }
  }
  const out: number[] = []
  val.forEach((v, i) => { for (let k = 0; k < len[i]; k++) out.push(v) })
  return out
}

interface Comp {
  nodes: number[] // глобальные индексы узлов
  edges: number[] // индексы рёбер
}

interface CompLayout {
  pos: Map<number, { x: number; y: number; layer: number; order: number }>
  edgePoints: Map<number, { points: Point[]; reversed: boolean }>
  width: number
  height: number
  layers: number
  crossings: number
}

function layoutComponent(comp: Comp, nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], idx: Map<string, number>, o: Required<LayoutOptions>): CompLayout {
  const local = new Map<number, number>()
  comp.nodes.forEach((g, i) => local.set(g, i))
  const n = comp.nodes.length
  const out: number[][] = Array.from({ length: n }, () => [])
  for (const ei of comp.edges) {
    const u = local.get(idx.get(edges[ei].from) as number) as number
    out[u].push(ei)
  }

  // 2. Разрыв циклов: обратные рёбра DFS разворачиваются.
  const reversed = new Set<number>()
  const state = new Uint8Array(n) // 0 — не был, 1 — в стеке, 2 — закрыт
  for (let r = 0; r < n; r++) {
    if (state[r]) continue
    const stack: Array<[number, number]> = [[r, 0]]
    state[r] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top[1] >= out[top[0]].length) { state[top[0]] = 2; stack.pop(); continue }
      const ei = out[top[0]][top[1]++]
      const v = local.get(idx.get(edges[ei].to) as number) as number
      if (state[v] === 1) reversed.add(ei)
      else if (state[v] === 0) { state[v] = 1; stack.push([v, 0]) }
    }
  }
  const dag = comp.edges.map((ei) => {
    const a = local.get(idx.get(edges[ei].from) as number) as number
    const b = local.get(idx.get(edges[ei].to) as number) as number
    return reversed.has(ei) ? { ei, a: b, b: a } : { ei, a, b }
  })
  const preds: number[][] = Array.from({ length: n }, () => [])
  const succs: number[][] = Array.from({ length: n }, () => [])
  for (const { a, b } of dag) { succs[a].push(b); preds[b].push(a) }

  // 3. Слои: самый длинный путь (Кан), затем подтяжка истоков к потребителю.
  const layer = new Array<number>(n).fill(0)
  const indeg = preds.map((p) => p.length)
  const queue: number[] = []
  for (let v = 0; v < n; v++) if (indeg[v] === 0) queue.push(v)
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi]
    for (const w of succs[v]) {
      layer[w] = Math.max(layer[w], layer[v] + 1)
      if (--indeg[w] === 0) queue.push(w)
    }
  }
  for (let v = 0; v < n; v++) {
    if (preds[v].length === 0 && succs[v].length > 0) layer[v] = Math.min(...succs[v].map((w) => layer[w])) - 1
  }
  const L = Math.max(...layer) + 1

  // 4. Фиктивные вершины: общая цепочка на пару (a,b), параллельные рёбра её делят.
  const vLayer = [...layer]
  const up: number[][] = Array.from({ length: n }, () => [])
  const down: number[][] = Array.from({ length: n }, () => [])
  const chainOf = new Map<string, number[]>()
  for (const { a, b } of dag) {
    const key = `${a}>${b}`
    if (chainOf.has(key)) continue
    const chain = [a]
    for (let l = layer[a] + 1; l < layer[b]; l++) {
      const d = vLayer.length
      vLayer.push(l); up.push([]); down.push([])
      chain.push(d)
    }
    chain.push(b)
    for (let k = 0; k + 1 < chain.length; k++) { down[chain[k]].push(chain[k + 1]); up[chain[k + 1]].push(chain[k]) }
    chainOf.set(key, chain)
  }
  const V = vLayer.length

  // 5. Порядок: DFS-обход (цепочки рядом), затем барицентрические проходы.
  const visit = new Array<number>(V).fill(-1)
  let seq = 0
  for (let r = 0; r < n; r++) {
    if (visit[r] >= 0 || up[r].length > 0) continue
    const stack = [r]
    while (stack.length) {
      const v = stack.pop() as number
      if (visit[v] >= 0) continue
      visit[v] = seq++
      for (let k = down[v].length - 1; k >= 0; k--) if (visit[down[v][k]] < 0) stack.push(down[v][k])
    }
  }
  for (let v = 0; v < V; v++) if (visit[v] < 0) visit[v] = seq++
  const layers: number[][] = Array.from({ length: L }, () => [])
  for (let v = 0; v < V; v++) layers[vLayer[v]].push(v)
  for (const lay of layers) lay.sort((p, q) => visit[p] - visit[q])
  const posOf = new Array<number>(V).fill(0)
  const syncPos = () => { for (const lay of layers) lay.forEach((v, i) => { posOf[v] = i }) }
  syncPos()
  const totalCrossings = (): number => {
    let c = 0
    for (let l = 0; l + 1 < L; l++) {
      const links: Array<[number, number]> = []
      for (const v of layers[l]) for (const w of down[v]) links.push([posOf[v], posOf[w]])
      c += countBilayerCrossings(links, layers[l + 1].length)
    }
    return c
  }
  let best = layers.map((lay) => [...lay])
  let bestC = totalCrossings()
  for (let s = 0; s < o.sweeps && bestC > 0; s++) {
    const goingDown = s % 2 === 0
    const order = goingDown ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1)
    for (const l of order) {
      const ref = goingDown ? up : down
      const bary = new Map<number, number>()
      for (const v of layers[l]) {
        const nb = ref[v]
        bary.set(v, nb.length ? nb.reduce((acc, w) => acc + posOf[w], 0) / nb.length : posOf[v])
      }
      layers[l].sort((p, q) => (bary.get(p) as number) - (bary.get(q) as number) || posOf[p] - posOf[q])
      layers[l].forEach((v, i) => { posOf[v] = i })
    }
    const c = totalCrossings()
    if (c < bestC) { bestC = c; best = layers.map((lay) => [...lay]) }
  }
  best.forEach((lay, l) => { layers[l] = lay })
  syncPos()

  // 6. Координаты: колонки по слоям, вертикали — проходы к среднему соседей + PAV.
  const hOf = (v: number) => (v < n ? nodes[comp.nodes[v]].height : DUMMY_H)
  const colW = layers.map((lay) => Math.max(DUMMY_H, ...lay.map((v) => (v < n ? nodes[comp.nodes[v]].width : 0))))
  const colX: number[] = []
  let acc = 0
  for (let l = 0; l < L; l++) { colX.push(acc + colW[l] / 2); acc += colW[l] + o.layerGap }
  const width = acc - o.layerGap
  const y = new Array<number>(V).fill(0)
  const sepBefore = (lay: number[], i: number) =>
    hOf(lay[i - 1]) / 2 + hOf(lay[i]) / 2 + (lay[i - 1] < n && lay[i] < n ? o.nodeGap : DUMMY_GAP)
  for (const lay of layers) {
    let cur = 0
    lay.forEach((v, i) => { cur = i === 0 ? hOf(v) / 2 : cur + sepBefore(lay, i); y[v] = cur })
  }
  for (let pass = 0; pass < o.alignPasses; pass++) {
    const seqL = pass % 2 === 0 ? [...Array(L).keys()] : [...Array(L).keys()].reverse()
    for (const l of seqL) {
      const lay = layers[l]
      if (!lay.length) continue
      const target: number[] = []
      let off = 0
      lay.forEach((v, i) => {
        if (i > 0) off += sepBefore(lay, i)
        const nb = [...up[v], ...down[v]]
        const want = nb.length ? nb.reduce((s2, w) => s2 + y[w], 0) / nb.length : y[v]
        target.push(want - off)
      })
      const z = isotonic(target)
      off = 0
      lay.forEach((v, i) => { if (i > 0) off += sepBefore(lay, i); y[v] = z[i] + off })
    }
  }
  let top = Infinity, bottom = -Infinity
  for (let v = 0; v < V; v++) { top = Math.min(top, y[v] - hOf(v) / 2); bottom = Math.max(bottom, y[v] + hOf(v) / 2) }

  const pos = new Map<number, { x: number; y: number; layer: number; order: number }>()
  for (let v = 0; v < n; v++) pos.set(comp.nodes[v], { x: colX[vLayer[v]], y: y[v] - top, layer: vLayer[v], order: posOf[v] })
  const edgePoints = new Map<number, { points: Point[]; reversed: boolean }>()
  for (const { ei, a, b } of dag) {
    const chain = chainOf.get(`${a}>${b}`) as number[]
    const pts = chain.map((v) => ({ x: colX[vLayer[v]], y: y[v] - top }))
    const rev = reversed.has(ei)
    edgePoints.set(ei, { points: rev ? pts.reverse() : pts, reversed: rev })
  }
  return { pos, edgePoints, width, height: bottom - top, layers: L, crossings: bestC }
}

export function layoutDag(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], options: LayoutOptions = {}): LayoutResult {
  const o = { ...DEFAULTS, ...options }
  const idx = new Map<string, number>()
  nodes.forEach((nd, i) => { if (!idx.has(nd.id)) idx.set(nd.id, i) })
  const valid: number[] = []
  edges.forEach((e, i) => { if (idx.has(e.from) && idx.has(e.to) && e.from !== e.to) valid.push(i) })

  // 1. Компоненты связности (union-find), в порядке первого узла.
  const parent = nodes.map((_, i) => i)
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  for (const ei of valid) {
    const a = find(idx.get(edges[ei].from) as number), b = find(idx.get(edges[ei].to) as number)
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
  }
  const comps = new Map<number, Comp>()
  nodes.forEach((nd, i) => {
    if (idx.get(nd.id) !== i) return // дубликат id
    const r = find(i)
    const c = comps.get(r) ?? { nodes: [], edges: [] }
    c.nodes.push(i)
    comps.set(r, c)
  })
  for (const ei of valid) comps.get(find(idx.get(edges[ei].from) as number))?.edges.push(ei)
  const multi = [...comps.values()].filter((c) => c.nodes.length > 1)
  const singles = [...comps.values()].filter((c) => c.nodes.length === 1).map((c) => c.nodes[0])

  const resNodes = new Map<string, PositionedNode>()
  const resEdges: RoutedEdge[] = []
  let yOff = 0, width = 0, layerCount = 0, crossings = 0
  multi.forEach((comp, ci) => {
    const cl = layoutComponent(comp, nodes, edges, idx, o)
    for (const [g, p] of cl.pos) {
      const nd = nodes[g]
      resNodes.set(nd.id, { id: nd.id, x: p.x, y: p.y + yOff, width: nd.width, height: nd.height, layer: p.layer, order: p.order, component: ci })
    }
    for (const ei of comp.edges) {
      const ep = cl.edgePoints.get(ei)
      if (!ep) continue
      const e = edges[ei]
      resEdges.push({ id: e.id, from: e.from, to: e.to, points: ep.points.map((pt) => ({ x: pt.x, y: pt.y + yOff })), reversed: ep.reversed })
    }
    width = Math.max(width, cl.width)
    layerCount = Math.max(layerCount, cl.layers)
    crossings += cl.crossings
    yOff += cl.height + o.componentGap
  })

  // Одиночные узлы — сеткой под компонентами.
  if (singles.length) {
    const cellW = Math.max(...singles.map((g) => nodes[g].width)) + o.layerGap / 2
    const cellH = Math.max(...singles.map((g) => nodes[g].height)) + o.nodeGap
    const cols = Math.max(1, Math.floor(Math.max(width, cellW * Math.min(singles.length, 8)) / cellW))
    singles.forEach((g, i) => {
      const nd = nodes[g]
      const col = i % cols, row = Math.floor(i / cols)
      resNodes.set(nd.id, {
        id: nd.id, x: col * cellW + nd.width / 2, y: yOff + row * cellH + nd.height / 2,
        width: nd.width, height: nd.height, layer: 0, order: i, component: multi.length,
      })
    })
    width = Math.max(width, Math.min(singles.length, cols) * cellW - o.layerGap / 2)
    layerCount = Math.max(layerCount, 1)
    yOff += Math.ceil(singles.length / cols) * cellH - o.nodeGap + o.componentGap
  }
  return { nodes: resNodes, edges: resEdges, width, height: Math.max(0, yOff - o.componentGap), layerCount, crossings }
}
