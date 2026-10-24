import { describe, expect, it } from 'vitest'
import {
  COLOR_SLOTS, barSegments, buildPalette, colorVar, distinctPart, fmtTick, fmtTickDate, groupBars, groupBarsByOrder, groupBarsByShop,
  laneDue, laneLabels, makeTicks, middleEllipsis, niceStep,
} from './ganttModel'
import { axisLevels, dayLabel } from './ganttTime'
import type { PlanBar } from './types'

const bar = (p: Partial<PlanBar>): PlanBar => ({
  job_idx: 0, order_idx: 0, product_id: 'p1', product_name: 'P1', op_id: 'o', op_name: 'Op',
  wc_type_id: 'wc1', wc_name: 'Токарные', machine_id: 'm1', machine_name: 'Т-1', worker: -1,
  start: 0, end: 10, due: 100, late: false, ...p,
})

describe('buildPalette', () => {
  it('assigns slots by product id (slotForEntity), keeps program order in the legend and aggregates qty', () => {
    const pal = buildPalette([
      { product_id: 'b', product_name: 'B', qty: 5, due_hours: 1 },
      { product_id: 'a', product_name: 'A', qty: 2, due_hours: 1 },
      { product_id: 'b', product_name: 'B', qty: 3, due_hours: 1 },
    ], [])
    expect(pal.swatches.map((s) => [s.productId, s.slot, s.qty])).toEqual([['b', 1, 8], ['a', 0, 2]])
    expect(pal.slotOf('a')).toBe(0)
    expect(pal.hasOther).toBe(false)
    // Тот же цвет изделия при другом порядке программы.
    const swapped = buildPalette([{ product_id: 'a', product_name: 'A', qty: 1, due_hours: 1 }, { product_id: 'b', product_name: 'B', qty: 1, due_hours: 1 }], [])
    expect(swapped.slotOf('b')).toBe(pal.slotOf('b'))
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

  it('labels ticks with dates from the horizon start and falls back to hours without it', () => {
    const start = new Date(Date.UTC(2026, 10, 1))
    expect(fmtTickDate(0, 24, start)).toBe('01.11')
    expect(fmtTickDate(48, 24, start)).toBe('03.11')
    expect(fmtTickDate(8, 4, start)).toBe('08:00')
    expect(fmtTickDate(24, 4, start)).toBe('02.11')
    expect(fmtTickDate(1440, 720, start)).toBe('31.12')
    expect(fmtTickDate(48, 12, null)).toBe('2 сут')
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

describe('groupBarsByShop', () => {
  it('groups by shop from the work-centre type, labels machines with their type and puts unknown shops last', () => {
    const shopOf = (wc: string) => ({ wc1: 'Цех №2', wc2: 'Цех №1' } as Record<string, string>)[wc]
    const groups = groupBarsByShop([
      bar({ job_idx: 1 }), bar({ job_idx: 2, machine_id: 'm2', machine_name: 'Т-2' }),
      bar({ job_idx: 3, wc_type_id: 'wc2', wc_name: 'Фрезерные', machine_id: 'm3', machine_name: 'Ф-1' }),
      bar({ job_idx: 4, wc_type_id: 'wc9', wc_name: 'Прочие', machine_id: 'm9' }),
    ], shopOf)
    expect(groups.map((g) => [g.name, g.machines.length, g.nOps])).toEqual([['Цех №1', 1, 1], ['Цех №2', 2, 2], ['Без цеха', 1, 1]])
    expect(groups[0].machines[0].name).toBe('Фрезерные · Ф-1')
  })

  it('never hands out more colour slots than the palette has', () => {
    const program = Array.from({ length: 12 }, (_, i) => ({ product_id: `p${i}`, product_name: `P${i}`, qty: 1, due_hours: 1 }))
    const pal = buildPalette(program, [])
    const slots = pal.swatches.map((s) => s.slot).filter((s): s is number => s !== null)
    expect(new Set(slots).size).toBe(COLOR_SLOTS)
    expect(Math.max(...slots)).toBe(COLOR_SLOTS - 1)
    expect(pal.swatches.filter((s) => s.slot === null)).toHaveLength(12 - COLOR_SLOTS)
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

describe('lane labels (APS canon: only the distinguishing part)', () => {
  it('strips the work-centre type from the machine name', () => {
    expect(distinctPart('Ленточнопильный отрезной станок №1', 'Ленточнопильный отрезной станок')).toBe('№1')
    expect(distinctPart('Пресс', 'Ленточнопильный станок')).toBe('Пресс')
  })

  it('ellipsises in the middle so both ends stay visible', () => {
    expect(middleEllipsis('короткое', 20)).toBe('короткое')
    const m = middleEllipsis('№1 · Ленточнопильный отрезной станок', 20)
    expect(m).toHaveLength(20)
    expect(m.startsWith('№1')).toBe(true)
    expect(m.endsWith('станок')).toBe(true)
  })

  it('never yields two identical visible labels', () => {
    const lanes = [
      { id: 'm1', name: 'Станок А №1', wcName: 'Станок А' },
      { id: 'm2', name: 'Станок А №1', wcName: 'Станок А' },
      { id: 'm3', name: 'Станок Б №1', wcName: 'Станок Б' },
    ]
    for (const mode of ['wc', 'shop'] as const) {
      const labels = [...laneLabels(lanes, mode, 30).values()]
      expect(new Set(labels).size).toBe(labels.length)
    }
    expect(laneLabels(lanes, 'shop', 40).get('m3')).toBe('№1 · Станок Б')
  })
})

describe('order lanes', () => {
  it('groups by product with one lane per order and a single due date', () => {
    const groups = groupBarsByOrder([
      bar({ job_idx: 1, order_idx: 1, product_id: 'p1', due: 50 }),
      bar({ job_idx: 2, order_idx: 0, product_id: 'p1', due: 40 }),
      bar({ job_idx: 3, order_idx: 2, product_id: 'p2', product_name: 'P2', due: 60 }),
    ])
    expect(groups.map((g) => g.machines.map((m) => m.id))).toEqual([['o0', 'o1'], ['o2']])
    expect(laneDue(groups[0].machines[1])).toBe(50)
  })
})

describe('two-level axis', () => {
  const start = new Date(Date.UTC(2026, 10, 2))
  it('shows dates over hours when a day is wide', () => {
    const lv = axisLevels(48, 10, start)
    expect(lv.top.map((t) => t.label)).toEqual(['пн 02.11', 'вт 03.11', 'ср 04.11'])
    expect(lv.bottom.length).toBeGreaterThan(0)
    expect(lv.bottom.every((t) => t.t % 24 !== 0)).toBe(true)
    expect(lv.bottom[0].label).toMatch(/^\d{2}:00$/)
  })

  it('shows months over day numbers when days are narrow, and day counters without a start date', () => {
    const lv = axisLevels(24 * 60, 0.2, start)
    expect(lv.top[0].label).toBe('ноябрь 2026')
    expect(lv.top.some((t) => t.label === 'декабрь 2026')).toBe(true)
    expect(axisLevels(48, 10, null).top[0].label).toBe('сутки 1')
    expect(dayLabel(2, start)).toBe('04.11')
  })
})
