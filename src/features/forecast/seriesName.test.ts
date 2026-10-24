import { describe, expect, it } from 'vitest'
import { splitSeriesName } from './seriesName'

describe('splitSeriesName — имя ряда в две строки без многоточия', () => {
  it('марка в скобках и назначение — во вторую строку', () => {
    expect(splitSeriesName('Пруток нержавеющий (12Х18Н10Т) — валы и метизы')).toEqual({ main: 'Пруток нержавеющий', detail: '12Х18Н10Т — валы и метизы' })
    expect(splitSeriesName('Отливки чугунные (СЧ20)')).toEqual({ main: 'Отливки чугунные', detail: 'СЧ20' })
  })
  it('назначение через тире; простое имя — одной строкой', () => {
    expect(splitSeriesName('Отливки из спецсплавов — корпуса')).toEqual({ main: 'Отливки из спецсплавов', detail: 'корпуса' })
    expect(splitSeriesName('Корпуса и крышки насосов 14')).toEqual({ main: 'Корпуса и крышки насосов 14', detail: '' })
  })
})
