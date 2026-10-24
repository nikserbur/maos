import { describe, expect, it } from 'vitest'
import { fullMonths } from './monthWords'

describe('fullMonths — месяцы полностью', () => {
  it('сокращения месяцев раскрываются, остальное без изменений', () => {
    expect(fullMonths('ЦБ РФ, сент. 2026')).toBe('ЦБ РФ, сентябрь 2026')
    expect(fullMonths('повтор февр.–авг. 2022 по порядку')).toBe('повтор февраль–август 2022 по порядку')
    expect(fullMonths('дек. 2014 – июнь 2015')).toBe('декабрь 2014 – июнь 2015')
    expect(fullMonths('Базовый · прогноз')).toBe('Базовый · прогноз')
  })
})
