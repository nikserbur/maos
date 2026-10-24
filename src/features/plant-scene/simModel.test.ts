import { describe, expect, it } from 'vitest'
import { fmtSimClock, nodeSimStats, planStartMs, shiftOf } from './simModel'
import type { SimTaskDto } from '../../lib/api'

const task = (machine: string, order: number, start: number, end: number): SimTaskDto => ({
  machine_id: machine, product_id: 'p', product_name: 'Вал', op_id: `${machine}-${order}-${start}`, op_name: 'Точение', order_idx: order, start, end,
})

describe('часы симуляции в календаре плана', () => {
  it('смены по часу суток', () => {
    expect(shiftOf(6)).toBe(1)
    expect(shiftOf(13)).toBe(1)
    expect(shiftOf(14)).toBe(2)
    expect(shiftOf(22)).toBe(3)
    expect(shiftOf(3)).toBe(3)
  })

  it('дата календаря плана — местная полночь; t часов — дата, смена и время', () => {
    const start = planStartMs('2026-10-24')
    expect(new Date(start).getHours()).toBe(0)
    expect(fmtSimClock('2026-10-24', 14.5)).toBe('24.10 · смена 2 · 14:00')
    expect(fmtSimClock('2026-10-24', 24 + 7)).toBe('25.10 · смена 1 · 07:00')
  })

  it('без даты начала — день горизонта', () => {
    expect(fmtSimClock(null, 30)).toBe('день 2 · 06:00')
  })
})

describe('состояние объекта в момент t', () => {
  const tasks = [
    task('m1', 1, 0, 4), task('m2', 1, 6, 8),   // заказ 1: m1 → m2 (партия ждёт m2 с 4 до 6)
    task('m2', 2, 0, 5),                          // заказ 2 занимает m2
  ]

  it('очередь — готовые партии, которые ждут станок', () => {
    const s = nodeSimStats(tasks, new Set(['m2']), 5)
    expect(s.queue).toBe(1)
    expect(s.active).toBe(0)
  })

  it('занятость с начала горизонта и текущая операция', () => {
    const s = nodeSimStats(tasks, new Set(['m1']), 2)
    expect(s.busyShare).toBe(1)
    expect(s.current?.op_name).toBe('Точение')
    const shop = nodeSimStats(tasks, new Set(['m1', 'm2']), 4)
    expect(shop.busyShare).toBeCloseTo((4 + 4) / 8, 5)
  })
})
