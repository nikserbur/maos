import { describe, expect, it } from 'vitest'
import { BACKBONE_EDGES, L0_EDGES } from './edges'
import { GRID, LABEL_H, SUB_LIST_PAD, SUB_ROW_H, blockRects, dataNeighbours, labelWidth, layoutL0, placeLabels, routeEdges } from './mapLayout'
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
    expect(loop.label!.y).toBeLessThan(dec.y)
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

  it('places edge labels without overlapping each other or the blocks (G1 note: 1440 px)', () => {
    const rects = blockRects(new Set(), SUB_COUNTS)
    const paths = routeEdges(rects)
    const box = (p: (typeof paths)[number]) => {
      const w = labelWidth(p.edge.label ?? '')
      return { x: p.label!.x - w / 2, y: p.label!.y - LABEL_H / 2, w, h: LABEL_H }
    }
    const labelled = paths.filter((p) => p.edge.label && p.label)
    // Основной ход [1] → … → [5] подписан всегда; остальным подпись — только при свободном месте.
    for (const id of BACKBONE_EDGES) expect(paths.find((p) => p.edge.id === id)?.label, id).not.toBeNull()
    for (let i = 0; i < labelled.length; i++) {
      for (let j = i + 1; j < labelled.length; j++) {
        expect(overlap(box(labelled[i]), box(labelled[j])), `${labelled[i].edge.id} × ${labelled[j].edge.id}`).toBe(false)
      }
      // Блоки — мягкое ограничение: если на кривой есть позиция вне блоков, подпись не заезжает на блок.
      const p = labelled[i]
      const w = box(p).w
      const atT = (t: number) => { const q = p.at(t); return { x: q.x - w / 2, y: q.y - LABEL_H / 2, w, h: LABEL_H } }
      const anyFree = p.loop || [0.15, 0.22, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78, 0.85].some((t) => !rects.some((r) => overlap(atT(t), r)))
      if (anyFree) for (const r of rects) expect(overlap(box(p), r), `${p.edge.id} над ${r.id}`).toBe(false)
    }
    // Подпись остаётся на своей кривой: сдвиг — вдоль пути, не в сторону.
    for (const p of labelled.filter((x) => !x.loop)) {
      const onCurve = [0.15, 0.22, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78, 0.85].some((t) => {
        const q = p.at(t)
        return Math.abs(q.x - p.label!.x) < 1e-6 && Math.abs(q.y - p.label!.y) < 1e-6
      })
      expect(onCurve, p.edge.id).toBe(true)
    }
    // Идемпотентно: повторное размещение уже свободных подписей ничего не двигает.
    expect(placeLabels(paths, rects).map((p) => p.label)).toEqual(paths.map((p) => p.label))
  })

  it('routes [4] ↔ [5] on opposite sides: data on the sides, the criterion as a control arc from above', () => {
    const rects = blockRects(new Set(), SUB_COUNTS)
    const paths = routeEdges(rects)
    const data = paths.find((p) => p.edge.id === 'e.4-5')!
    const control = paths.find((p) => p.edge.id === 'e.5-4')!
    const crit = rects.find((r) => r.id === 'criteria')!
    const dec = rects.find((r) => r.id === 'decisions')!
    expect(data.from.x).toBe(dec.x + dec.w)
    expect(control.from.y).toBe(crit.y)
    expect(control.to.y).toBe(dec.y)
    expect(Math.min(...[0.25, 0.5, 0.75].map((t) => control.at(t).y))).toBeLessThan(Math.min(crit.y, dec.y))
  })
})
