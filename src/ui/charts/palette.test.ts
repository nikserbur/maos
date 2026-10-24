import { describe, expect, it } from 'vitest'
import { entityLegend, slotForEntity } from './palette'

const universe = ['p-07', 'p-01', 'p-03', 'p-02', 'p-05', 'p-04', 'p-06', 'p-08']

describe('slotForEntity — один цвет на сущность', () => {
  it('слот по порядку НСИ (сортировка id), а не по порядку на экране', () => {
    expect(slotForEntity('product', 'p-01', universe)).toEqual({ slot: 0, color: 'var(--chart-1)', other: false })
    expect(slotForEntity('product', 'p-06', universe).slot).toBe(5)
  })

  it('фильтр и сортировка не перекрашивают уцелевших', () => {
    const before = slotForEntity('product', 'p-04', universe)
    const shuffled = [...universe].reverse()
    expect(slotForEntity('product', 'p-04', shuffled)).toEqual(before)
  })

  it('седьмая и далее — «прочие», никогда не по модулю', () => {
    expect(slotForEntity('product', 'p-07', universe)).toEqual({ slot: -1, color: 'var(--chart-other)', other: true })
    expect(slotForEntity('product', 'p-08', universe).other).toBe(true)
    expect(slotForEntity('product', 'нет-такого', universe).other).toBe(true)
  })

  it('легенда: именованные + одна строка «прочие (N)»', () => {
    const items = universe.map((id) => ({ id, label: id.toUpperCase() }))
    const legend = entityLegend('product', items, universe)
    expect(legend).toHaveLength(7)
    expect(legend[legend.length - 1].label).toBe('прочие (2)')
  })
})
