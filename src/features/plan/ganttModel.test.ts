import { describe, expect, it } from 'vitest'
import {
  COLOR_SLOTS, barSegments, buildPalette, colorVar, fmtTick, groupBars, makeTicks, niceStep,
} from './ganttModel'
import type { PlanBar } from './types'

const bar = (p: Partial<PlanBar>): PlanBar => ({
  job_idx: 0, order_idx: 0, product_id: 'p1', product_name: 'P1', op_id: 'o', op_name: 'Op',
  wc_type_id: 'wc1', wc_name: 'Токарные', machine_id: 'm1', machine_name: 'Т-1', worker: -1,
  start: 0, end: 10, due: 100, late: false, ...p,
})

describe('buildPalette', () => {
  it('assigns slots by first appearance in the program and aggregates qty', () => {
    const pal = buildPalette([
      { product_id: 'b', product_name: 'B', qty: 5, due_hours: 1 },
      { product_id: 'a', product_name: 'A', qty: 2, due_hours: 1 },
      { product_id: 'b', product_name: 'B', qty: 3, due_hours: 1 },
    ], [])
    expect(pal.swatches.map((s) => [s.productId, s.slot, s.qty])).toEqual([['b', 0, 8], ['a', 1, 2]])
    expect(pal.slotOf('a')).toBe(1)
    expect(pal.hasOther).toBe(false)
  })

  it('puts products beyond the palette and non-program bars into «прочее»', () => {
    const program = Array.from({ length: COLOR_SLOTS + 1 }, (_, i) => (
      { product_id: `p${i}`, product_name: `P${i}`, qty: 1, due_hours: 1 }))
    const pal = buildPalette(program, [bar({ product_id: 'supply' })])
    expect(pal.slotOf(`p${COLOR_SLOTS}`)).toBeNull()
    expect(pal.slotOf('supply')).toBeNull()
    expect(pal.hasOther).toBe(true)
  })

  it('maps slots to chart tokens only', () => {
    expect(colorVar(0)).toBe('var(--chart-1)')
    expect(colorVar(6)).toBe('var(--chart-7)')
    expect(colorVar(null)).toBe('var(--chart-other)')
  })
})

describe('time axis', () => {
  it('picks a nice step close to the pixel target', () => {
    expect(niceStep(240, 960)).toBe(24)
    expect(niceStep(10, 1000)).toBe(1)
  })

  it('formats ticks by step magnitude', () => {
    expect(fmtTick(0, 4)).toBe('0')
    expect(fmtTick(8, 4)).toBe('8 ч')
    expect(fmtTick(48, 12)).toBe('2 сут')
    expect(fmtTick(72, 24)).toBe('3 сут')
    expect(fmtTick(1080, 720)).toBe('1,5 мес')
  })

  it('builds ticks including both ends', () => {
    expect(makeTicks(10, 5)).toEqual([0, 5, 10])
    expect(makeTicks(10, 0)).toEqual([])
  })
})

describe('groupBars', () => {
  it('groups by work-centre type, then machine', () => {
    const groups = groupBars([
      bar({ job_idx: 1 }), bar({ job_idx: 2, machine_id: 'm2', machine_name: 'Т-2' }),
      bar({ job_idx: 3, wc_type_id: 'wc2', wc_name: 'Фрезерные', machine_id: 'm3' }),
    ])
    expect(groups.map((g) => [g.wc, g.machines.length, g.nOps])).toEqual([['wc1', 2, 2], ['wc2', 1, 1]])
  })
})

describe('barSegments', () => {
  it('returns zero shares without setup or downtime', () => {
    expect(barSegments(bar({}))).toEqual({ setupFrac: 0, downFrac: 0 })
  })

  it('splits work into setup / processing / downtime shares', () => {
    const s = barSegments(bar({ proc_hours: 6, setup_hours: 2, downtime_hours: 2 }))
    expect(s.setupFrac).toBeCloseTo(0.2)
    expect(s.downFrac).toBeCloseTo(0.2)
  })

  it('derives processing from the bar span when proc_hours is absent', () => {
    const s = barSegments(bar({ start: 0, end: 10, setup_hours: 5 }))
    expect(s.setupFrac).toBeCloseTo(0.5)
  })
})
