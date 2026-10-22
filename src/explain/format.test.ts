import { describe, expect, it } from 'vitest'
import {
  DASH,
  dateTime,
  MINUS,
  NBSP,
  bindFormula,
  bindFormulaParts,
  fmtValue,
  hours,
  money,
  num,
  pct,
  placeholders,
  signed,
} from './format'

describe('num', () => {
  it('groups thousands with a no-break space and uses a decimal comma (ru-RU)', () => {
    expect(num(1234567.89, 1)).toBe(`1${NBSP}234${NBSP}567,9`)
    expect(num(1234)).toBe(`1${NBSP}234`)
  })

  it('picks fraction digits by magnitude when none are given', () => {
    expect(num(123.456)).toBe('123')
    expect(num(12.345)).toBe('12,3')
    expect(num(1.2345)).toBe('1,23')
  })

  it('writes negatives with U+2212 minus, never a hyphen', () => {
    expect(num(-5)).toBe(`${MINUS}5`)
    expect(num(-1234.5, 1)).toBe(`${MINUS}1${NBSP}234,5`)
    expect(num(-5)).not.toContain('-')
  })

  it('drops the sign when the value rounds to zero', () => {
    expect(num(-0.001, 1)).toBe('0')
  })

  it('returns a dash for missing or non-finite values', () => {
    expect(num(null)).toBe(DASH)
    expect(num(undefined)).toBe(DASH)
    expect(num(Number.NaN)).toBe(DASH)
    expect(num(Number.POSITIVE_INFINITY)).toBe(DASH)
  })
})

describe('pct', () => {
  it('treats input as a fraction and separates the sign with a no-break space', () => {
    expect(pct(0.934)).toBe(`93,4${NBSP}%`)
    expect(pct(1)).toBe(`100${NBSP}%`)
    expect(pct(0.05, 0)).toBe(`5${NBSP}%`)
  })

  it('handles negatives and missing values', () => {
    expect(pct(-0.05)).toBe(`${MINUS}5${NBSP}%`)
    expect(pct(null)).toBe(DASH)
  })
})

describe('hours', () => {
  it('formats hours with one decimal and grouping', () => {
    expect(hours(1123.44)).toBe(`1${NBSP}123,4${NBSP}ч`)
    expect(hours(12)).toBe(`12${NBSP}ч`)
    expect(hours(undefined)).toBe(DASH)
  })
})

describe('money', () => {
  it('compacts to тыс./млн/млрд with about three significant digits', () => {
    expect(money(950)).toBe(`950${NBSP}₽`)
    expect(money(12_345)).toBe(`12,3${NBSP}тыс.${NBSP}₽`)
    expect(money(1_234_567)).toBe(`1,23${NBSP}млн${NBSP}₽`)
    expect(money(123_456_789)).toBe(`123${NBSP}млн${NBSP}₽`)
    expect(money(2_500_000_000)).toBe(`2,5${NBSP}млрд${NBSP}₽`)
  })

  it('promotes to the next tier instead of printing «1000 тыс.»', () => {
    expect(money(999_960)).toBe(`1${NBSP}млн${NBSP}₽`)
    expect(money(999.7)).toBe(`1${NBSP}тыс.${NBSP}₽`)
  })

  it('keeps full precision when compact is off', () => {
    expect(money(1_234_567, { compact: false })).toBe(`1${NBSP}234${NBSP}567${NBSP}₽`)
  })

  it('writes losses with U+2212 minus', () => {
    expect(money(-1_500_000)).toBe(`${MINUS}1,5${NBSP}млн${NBSP}₽`)
    expect(money(-1_500_000)).not.toContain('-')
  })

  it('returns a dash for null', () => {
    expect(money(null)).toBe(DASH)
  })
})

describe('signed', () => {
  it('prefixes plus or U+2212 minus and leaves zero unsigned', () => {
    expect(signed(0.123, '%')).toBe(`+12,3${NBSP}%`)
    expect(signed(-1_500_000, '₽')).toBe(`${MINUS}1,5${NBSP}млн${NBSP}₽`)
    expect(signed(0)).toBe('0')
    expect(signed(null)).toBe(DASH)
  })
})

describe('fmtValue', () => {
  it('formats by unit', () => {
    expect(fmtValue(0.5, '%')).toBe(`50${NBSP}%`)
    expect(fmtValue(42, 'ч')).toBe(`42${NBSP}ч`)
    expect(fmtValue(1_200_000, '₽/мес')).toBe(`1,2${NBSP}млн${NBSP}₽/мес`)
    expect(fmtValue(3.456, 'ед./сут')).toBe(`3,46${NBSP}ед./сут`)
    expect(fmtValue(7.25, 'мес')).toBe(`7,3${NBSP}мес`)
  })

  it('declines «заказ» by the Russian plural rules', () => {
    expect(fmtValue(1, 'заказов')).toBe(`1${NBSP}заказ`)
    expect(fmtValue(3, 'заказов')).toBe(`3${NBSP}заказа`)
    expect(fmtValue(12, 'заказов')).toBe(`12${NBSP}заказов`)
    expect(fmtValue(21, 'заказов')).toBe(`21${NBSP}заказ`)
    expect(fmtValue(3.4, 'заказов')).toBe(`3,4${NBSP}заказа`)
  })

  it('passes strings through and maps empties to a dash', () => {
    expect(fmtValue('Токарный')).toBe('Токарный')
    expect(fmtValue('  ')).toBe(DASH)
    expect(fmtValue(null, 'ч')).toBe(DASH)
    expect(fmtValue(undefined, '%')).toBe(DASH)
  })
})

describe('bindFormula', () => {
  const vars = [
    { key: 'mean', unit: 'ч' as const },
    { key: 'otd', unit: '%' as const },
  ]

  it('substitutes values formatted with their declared unit', () => {
    expect(bindFormula('E[Cmax] = {mean}', { mean: 1123.4 }, vars)).toBe(`E[Cmax] = 1${NBSP}123,4${NBSP}ч`)
    expect(bindFormula('OTD = {otd}', { otd: 0.9 }, vars)).toBe(`OTD = 90${NBSP}%`)
  })

  it('renders unknown or null values as a dash', () => {
    expect(bindFormula('{mean} / {missing}', { mean: null }, vars)).toBe(`${DASH} / ${DASH}`)
    expect(bindFormula('{mean}', undefined, vars)).toBe(DASH)
  })

  it('keeps text around placeholders and repeats a value for repeated keys', () => {
    expect(bindFormula('({x} − {y}) / {x}', { x: 10, y: 4 })).toBe('(10 − 4) / 10')
  })

  it('splits into text and value parts with a known flag', () => {
    const parts = bindFormulaParts('a = {mean}, b = {otd}', { mean: 2 }, vars)
    expect(parts).toEqual([
      { kind: 'text', text: 'a = ' },
      { kind: 'value', key: 'mean', text: `2${NBSP}ч`, known: true },
      { kind: 'text', text: ', b = ' },
      { kind: 'value', key: 'otd', text: DASH, known: false },
    ])
  })

  it('lists placeholders in order of appearance', () => {
    expect(placeholders('{a} + {b_2} − {a}')).toEqual(['a', 'b_2', 'a'])
  })
})

describe('dateTime', () => {
  it('формат бэкенда «ГГГГ-ММ-ДД ЧЧ:ММ:СС» → дд.мм.гггг, чч:мм', () => {
    expect(dateTime('2026-10-22 18:35:10')).toBe('22.10.2026, 18:35')
    expect(dateTime('2026-10-22 18:35:10', { time: false })).toBe('22.10.2026')
  })
  it('пусто и мусор → тире', () => {
    expect(dateTime(null)).toBe('—')
    expect(dateTime('не дата')).toBe('—')
  })
})
