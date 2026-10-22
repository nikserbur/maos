import { describe, expect, it } from 'vitest'
import { L0_EDGES } from './edges'
import { GRID, SUB_LIST_PAD, SUB_ROW_H, blockRects, dataNeighbours, layoutL0, routeEdges } from './mapLayout'
import { subblocksOf } from './registry'
import { BLOCK_IDS } from './types'

const SUB_COUNTS = Object.fromEntries(BLOCK_IDS.map((b) => [b, subblocksOf(b).length]))

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('method-map L0 layout', () => {
  it('places 8 blocks on the 8 px grid without overlaps; row [1]…[5] rises to the right', () => {
    const rects = blockRects(new Set(), SUB_COUNTS)
    expect(rects).toHaveLength(8)
    for (const r of rects) {
      expect(r.x % GRID).toBe(0)
      expect(r.y % GRID).toBe(0)
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `${rects[i].id} × ${rects[j].id}`).toBe(false)
    const row = rects.slice(0, 5)
    for (let i = 1; i < row.length; i++) {
      expect(row[i].x).toBeGreaterThan(row[i - 1].x)
      expect(row[i].y).toBeLessThan(row[i - 1].y)
    }
    for (const r of rects.slice(5)) expect(r.y).toBeGreaterThan(row[0].y + row[0].h)
  })

  it('grows an expanded block by its subblock rows and keeps the others untouched', () => {
    const closed = blockRects(new Set(), SUB_COUNTS)
    const open = blockRects(new Set(['decisions']), SUB_COUNTS)
    const d0 = closed.find((r) => r.id === 'decisions')!
    const d1 = open.find((r) => r.id === 'decisions')!
    expect(d1.h - d0.h).toBe(SUB_LIST_PAD + SUB_ROW_H * SUB_COUNTS.decisions)
    expect(d1.expanded).toBe(true)
    expect(open.filter((r) => r.id !== 'decisions')).toEqual(closed.filter((r) => r.id !== 'decisions'))
  })

  it('routes every L0 edge, draws the Stage 1 → Stage 2 loop and spreads ports on a shared side', () => {
    const rects = blockRects(new Set(), SUB_COUNTS)
    const paths = routeEdges(rects)
    expect(paths.map((p) => p.edge.id).sort()).toEqual(L0_EDGES.map((e) => e.id).sort())
    const loop = paths.find((p) => p.edge.id === 'e.4-4')!
    expect(loop.loop).toBe(true)
    const dec = rects.find((r) => r.id === 'decisions')!
    expect(loop.from.y).toBe(dec.y)
    expect(loop.label.y).toBeLessThan(dec.y)
    // [1] [2] [3] входят в [6] сверху — три разных порта на верхней стороне.
    const intoAgents = paths.filter((p) => p.edge.to === 'agents' && p.edge.kind === 'data')
    const xs = new Set(intoAgents.map((p) => Math.round(p.to.x)))
    expect(xs.size).toBe(intoAgents.length)
    const ag = rects.find((r) => r.id === 'agents')!
    for (const p of intoAgents) expect(p.to.y).toBe(ag.y)
    for (const p of paths) expect(p.d).toMatch(/^M [\d.-]+ [\d.-]+ C /)
  })

  it('computes world size and data neighbours for keyboard navigation', () => {
    const l = layoutL0(new Set(), SUB_COUNTS)
    expect(l.width).toBeGreaterThan(1000)
    expect(l.height).toBeGreaterThan(300)
    expect(dataNeighbours('external').next).toEqual(['distributions', 'agents', 'monitoring'])
    expect(dataNeighbours('decisions').prev).toEqual(['internal', 'distributions'])
    expect(dataNeighbours('llm')).toEqual({ next: [], prev: [] })
  })
})
