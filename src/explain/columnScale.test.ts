import { describe, expect, it } from 'vitest'
import { columnScale } from './columnScale'
import { NBSP } from './format'

describe('columnScale — один порядок денег на колонку', () => {
  it('по наибольшему значению: млн ₽, ячейки — только числа', () => {
    const s = columnScale([32_600_000, 1_280_000, 478_000])
    expect(s.unit).toBe(`млн${NBSP}₽`)
    expect([32_600_000, 1_280_000, 478_000].map(s.fmt)).toEqual(['32,6', '1,28', '0,48'])
  })
  it('мелкие суммы — рубли; «999 960» — уже тысячи; пусто — «—»', () => {
    expect(columnScale([664, 120]).unit).toBe('₽')
    expect(columnScale([999_960]).unit).toBe(`млн${NBSP}₽`)
    expect(columnScale([]).fmt(null)).toBe('—')
  })
})
