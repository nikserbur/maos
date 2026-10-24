import { describe, expect, it } from 'vitest'
import type { Product } from '../../lib/api'
import { NBSP } from '../../explain/format'
import { distRow, distSummary, isCustomDist, tailsLabel } from './distModel'

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', code: 'A-1', name: 'Деталь', unit: 'шт', parent_id: '', qty_in_parent: '1', batch_size: '10',
  stock: '0', purchased: '0', created_at: '', sellable: '1', base_cost: '500', base_price: '1000', demand_max: '100',
  ...over,
})

describe('distRow — строка вкладки «Распределения»', () => {
  it('без распределения в сценарии берёт умолчания: нормальное, σ 12 % базы, β 0,7', () => {
    const r = distRow({}, product())
    expect(r.d).toBeUndefined()
    expect(r.center).toBe(1000)
    expect(r.sd).toBe(120)
    expect(r.rel).toBeCloseTo(0.12)
    expect(r.beta).toBe(0.7)
    expect(r.type).toBe('normal')
    expect(isCustomDist(r)).toBe(false)
  })

  it('сырьё берёт базу из закупочной цены и учитывает оверрайд центра', () => {
    const r = distRow({ overrides: [{ product_id: 'p1', base_cost: '640' }] }, product({ purchased: '1', sellable: '0' }))
    expect(r.raw).toBe(true)
    expect(r.base).toBe(500)
    expect(r.center).toBe(640)
    expect(r.hasOverride).toBe(true)
  })

  it('распределение из сценария с умолчательными параметрами не считается «заданным вручную»', () => {
    const r = distRow({ distributions: [{ product_id: 'p1', dist_type: 'normal', mean: 1000, stddev: 120, beta: 0.7 }] }, product())
    expect(r.d).toBeDefined()
    expect(isCustomDist(r)).toBe(false)
  })

  it('тип, σ, β, хвосты или центр, отличные от умолчания → плотность показываем', () => {
    const base = { product_id: 'p1', dist_type: 'normal' as const, mean: 1000, stddev: 120, beta: 0.7 }
    expect(isCustomDist(distRow({ distributions: [{ ...base, dist_type: 't' }] }, product()))).toBe(true)
    expect(isCustomDist(distRow({ distributions: [{ ...base, stddev: 250 }] }, product()))).toBe(true)
    expect(isCustomDist(distRow({ distributions: [{ ...base, beta: 0.3 }] }, product()))).toBe(true)
    expect(isCustomDist(distRow({ distributions: [{ ...base, max_val: 1500 }] }, product()))).toBe(true)
    expect(isCustomDist(distRow({ distributions: [{ ...base, mean: 1100, stddev: 132 }] }, product()))).toBe(true)
  })
})

describe('подписи', () => {
  it('сводка плотности текстом через форматтер', () => {
    expect(distSummary('normal', 0.12)).toBe(`нормальное · σ 12${NBSP}%`)
    expect(distSummary('t', 0.2)).toBe(`Стьюдента (тяжёлые хвосты) · σ 20${NBSP}%`)
  })

  it('хвосты: границы, параметры семейства или тире', () => {
    expect(tailsLabel({ type: 'normal' })).toBe('—')
    expect(tailsLabel({ type: 't' })).toBe('ν = 5 · норматив')
    expect(tailsLabel({ type: 'normal', d: { product_id: 'p1', dist_type: 'normal', mean: 1, stddev: 1, max_val: 9 } })).toBe('−∞ … 9')
  })
})

describe('группы и корреляция', () => {
  it('первая часть имени и подпись группы', async () => {
    const { firstPart, distGroupLabel } = await import('./distModel')
    expect(firstPart('Вал приводной, сталь 40Х')).toBe('Вал приводной')
    expect(firstPart('Корпус (литьё)')).toBe('Корпус')
    expect(distGroupLabel('raw', 12)).toBe('Сырьё · 12')
    expect(distGroupLabel('goods', 64)).toBe('Изделия (сбыт) · 64')
  })

  it('одинаковые β — одна корреляция на все пары, иначе матрица', async () => {
    const { betaSpread, corrMatrix } = await import('./distModel')
    expect(betaSpread([{ beta: 0.7 }, { beta: 0.7 }])).toMatchObject({ uniform: true, beta: 0.7 })
    expect(betaSpread([{ beta: 0.7 }, { beta: 0.7 }]).rho).toBeCloseTo(0.49)
    expect(betaSpread([{ beta: 0.7 }, { beta: 0.3 }]).uniform).toBe(false)
    expect(corrMatrix([{ beta: 0.5 }, { beta: 0.4 }])).toEqual([[1, 0.2], [0.2, 1]])
  })
})
