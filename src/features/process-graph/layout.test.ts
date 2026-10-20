import { describe, expect, it } from 'vitest'
import { countBilayerCrossings, layoutDag, type LayoutEdgeInput, type LayoutNodeInput } from './layout'

const node = (id: string, width = 100, height = 30): LayoutNodeInput => ({ id, width, height })
const edge = (from: string, to: string): LayoutEdgeInput => ({ id: `${from}>${to}`, from, to })

/** Синтетический завод: R видов сырья, P изделий по K операций, сырьё входит в случайные операции. */
function plant(rawN: number, prodN: number, opsPer: number, seed = 7): { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[] } {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const nodes: LayoutNodeInput[] = []
  const edges: LayoutEdgeInput[] = []
  for (let r = 0; r < rawN; r++) nodes.push(node(`r${r}`, 150, 24))
  for (let p = 0; p < prodN; p++) {
    for (let k = 0; k < opsPer; k++) {
      nodes.push(node(`o${p}.${k}`, 150, 30))
      if (k > 0) edges.push(edge(`o${p}.${k - 1}`, `o${p}.${k}`))
      if (rnd() < 0.3) edges.push(edge(`r${Math.floor(rnd() * rawN)}`, `o${p}.${k}`))
    }
    nodes.push(node(`p${p}`, 150, 32))
    edges.push(edge(`o${p}.${opsPer - 1}`, `p${p}`))
  }
  return { nodes, edges }
}

describe('countBilayerCrossings', () => {
  it('counts a single X crossing', () => {
    expect(countBilayerCrossings([[0, 1], [1, 0]], 2)).toBe(1)
  })
  it('returns zero for parallel links and shared endpoints', () => {
    expect(countBilayerCrossings([[0, 0], [1, 1], [1, 2]], 3)).toBe(0)
    expect(countBilayerCrossings([[0, 0], [0, 1], [1, 1]], 2)).toBe(0)
  })
  it('counts every inversion of K(3,3) reversed matching', () => {
    expect(countBilayerCrossings([[0, 2], [1, 1], [2, 0]], 3)).toBe(3)
  })
})

describe('layoutDag', () => {
  it('lays a chain left to right on a single straight line', () => {
    const res = layoutDag([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')])
    const [a, b, c] = ['a', 'b', 'c'].map((id) => res.nodes.get(id)!)
    expect([a.layer, b.layer, c.layer]).toEqual([0, 1, 2])
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
    expect(a.y).toBeCloseTo(b.y, 6)
    expect(b.y).toBeCloseTo(c.y, 6)
    expect(res.layerCount).toBe(3)
  })

  it('is deterministic for identical input', () => {
    const g = plant(8, 12, 6)
    const r1 = layoutDag(g.nodes, g.edges)
    const r2 = layoutDag(g.nodes, g.edges)
    expect([...r1.nodes.values()]).toEqual([...r2.nodes.values()])
    expect(r1.edges).toEqual(r2.edges)
  })

  it('pulls a source right next to its first consumer', () => {
    const nodes = [node('raw'), node('o1'), node('o2'), node('o3'), node('o4')]
    const edges = [edge('o1', 'o2'), edge('o2', 'o3'), edge('o3', 'o4'), edge('raw', 'o4')]
    const res = layoutDag(nodes, edges)
    expect(res.nodes.get('o4')!.layer).toBe(3)
    expect(res.nodes.get('raw')!.layer).toBe(2)
  })

  it('routes long edges through every intermediate layer', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')]
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'd')]
    const res = layoutDag(nodes, edges)
    const long = res.edges.find((e) => e.id === 'a>d')!
    expect(long.points).toHaveLength(4) // a, 2 фиктивные, d
    const xs = long.points.map((p) => p.x)
    expect([...xs].sort((p, q) => p - q)).toEqual(xs)
  })

  it('breaks cycles and still terminates with a valid layering', () => {
    const res = layoutDag([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    expect(res.edges.filter((e) => e.reversed)).toHaveLength(1)
    for (const e of res.edges) {
      const f = res.nodes.get(e.from)!, t = res.nodes.get(e.to)!
      if (e.reversed) expect(f.layer).toBeGreaterThan(t.layer)
      else expect(f.layer).toBeLessThan(t.layer)
    }
    const rev = res.edges.find((e) => e.reversed)!
    expect(rev.points[0]).toEqual({ x: res.nodes.get(rev.from)!.x, y: res.nodes.get(rev.from)!.y })
  })

  it('ignores self-loops and edges to unknown nodes', () => {
    const res = layoutDag([node('a'), node('b')], [edge('a', 'a'), edge('a', 'zzz'), edge('a', 'b')])
    expect(res.edges.map((e) => e.id)).toEqual(['a>b'])
  })

  it('keeps every edge pointing downstream (x grows) when the graph is acyclic', () => {
    const g = plant(10, 20, 7)
    const res = layoutDag(g.nodes, g.edges)
    for (const e of res.edges) {
      expect(e.reversed).toBe(false)
      expect(res.nodes.get(e.from)!.x).toBeLessThan(res.nodes.get(e.to)!.x)
    }
  })

  it('never overlaps nodes of the same layer and component', () => {
    const g = plant(12, 25, 6, 3)
    const res = layoutDag(g.nodes, g.edges, { nodeGap: 20 })
    const groups = new Map<string, typeof g.nodes>()
    for (const n of res.nodes.values()) {
      const key = `${n.component}:${n.layer}`
      groups.set(key, [...(groups.get(key) ?? []), n])
    }
    for (const list of groups.values()) {
      const sorted = [...list].map((n) => res.nodes.get(n.id)!).sort((p, q) => p.y - q.y)
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].y - sorted[i - 1].y - (sorted[i].height + sorted[i - 1].height) / 2
        expect(gap).toBeGreaterThanOrEqual(20 - 1e-6)
      }
    }
  })

  it('untangles a crossing that the input order would create', () => {
    // Входной порядок b перед a, но потребители a стоят раньше: без сортировки было бы X.
    const nodes = [node('s'), node('a'), node('b'), node('x'), node('y')]
    const edges = [edge('s', 'b'), edge('s', 'a'), edge('a', 'x'), edge('b', 'y'), edge('b', 'x'), edge('a', 'y')]
    const res = layoutDag(nodes, edges, { sweeps: 4 })
    expect(res.crossings).toBeLessThanOrEqual(1)
  })

  it('stacks disconnected components without vertical overlap', () => {
    const res = layoutDag([node('a'), node('b'), node('c'), node('d')], [edge('a', 'b'), edge('c', 'd')])
    const ab = Math.max(res.nodes.get('a')!.y, res.nodes.get('b')!.y)
    const cd = Math.min(res.nodes.get('c')!.y, res.nodes.get('d')!.y)
    expect(res.nodes.get('a')!.component).not.toBe(res.nodes.get('c')!.component)
    expect(cd - ab).toBeGreaterThan(30)
  })

  it('packs isolated nodes into a grid below the flow', () => {
    const iso = Array.from({ length: 10 }, (_, i) => node(`i${i}`))
    const res = layoutDag([node('a'), node('b'), ...iso], [edge('a', 'b')])
    const flowBottom = res.nodes.get('a')!.y
    for (const n of iso) expect(res.nodes.get(n.id)!.y).toBeGreaterThan(flowBottom)
    const rows = new Set(iso.map((n) => res.nodes.get(n.id)!.y))
    expect(rows.size).toBeLessThan(iso.length)
    expect(res.height).toBeGreaterThan(0)
  })

  it('handles an empty graph', () => {
    const res = layoutDag([], [])
    expect(res.nodes.size).toBe(0)
    expect(res.width).toBe(0)
    expect(res.height).toBe(0)
  })

  it('lays out a plant the size of maos.db (≈600 nodes) quickly', () => {
    const g = plant(12, 70, 7, 11) // 12 + 70·7 + 70 = 572 узла
    const t0 = performance.now()
    const res = layoutDag(g.nodes, g.edges)
    const ms = performance.now() - t0
    expect(res.nodes.size).toBe(g.nodes.length)
    expect(res.edges.length).toBe(g.edges.length)
    expect(ms).toBeLessThan(1500)
  })
})
