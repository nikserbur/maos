import { describe, expect, it } from 'vitest'
import { unitWord } from './unitWords'

describe('unitWord — единица изделия без сокращений', () => {
  it('«компл» → «комплект/комплекта/комплектов» по числу; стандартные — как есть', () => {
    expect(unitWord('компл', 1)).toBe('комплект')
    expect(unitWord('компл', 3)).toBe('комплекта')
    expect(unitWord('компл.', 12)).toBe('комплектов')
    expect(unitWord('шт', 5)).toBe('шт')
    expect(unitWord('т', 2.5)).toBe('т')
  })
})
