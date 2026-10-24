import { describe, expect, it } from 'vitest'
import {
  DASH,
  bp,
  countText,
  dateTime,
  dateTimeShort,
  freqText,
  plural,
  pp,
  rangeText,
  runLabel,
  time,
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
  const local = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  it('серверное «ГГГГ-ММ-ДД ЧЧ:ММ:СС» без зоны — это UTC, показывается в местном времени', () => {
    expect(dateTime('2026-10-22 18:35:10')).toBe(local.format(new Date(Date.UTC(2026, 9, 22, 18, 35, 10))))
    expect(dateTime('2026-10-22T18:35:10')).toBe(dateTime('2026-10-22 18:35:10'))
    expect(dateTime('2026-10-22 18:35:10', { time: false })).toMatch(/^\d{2}\.\d{2}\.2026$/)
  })
  it('строка с зоной и число не сдвигаются', () => {
    const ms = Date.UTC(2026, 9, 22, 18, 35)
    expect(dateTime('2026-10-22T18:35:00Z')).toBe(local.format(new Date(ms)))
    expect(dateTime(ms)).toBe(local.format(new Date(ms)))
  })
  it('пусто и мусор → тире', () => {
    expect(dateTime(null)).toBe('—')
    expect(dateTime('не дата')).toBe('—')
    expect(time('')).toBe('—')
    expect(dateTimeShort(undefined)).toBe('—')
  })
  it('один прогон — одно время в шапке, истории и аналитике (time/dateTimeShort из одной отметки)', () => {
    const at = '2026-10-24 14:38:00'
    const t = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(Date.UTC(2026, 9, 24, 14, 38)))
    expect(time(at)).toBe(t)
    expect(dateTimeShort(at, new Date(Date.UTC(2026, 0, 1)))).toMatch(new RegExp(`^\\d{2}\\.\\d{2} ${t}$`))
    expect(dateTimeShort(at, new Date(Date.UTC(2027, 5, 1)))).toMatch(/\.2026 /)
  })
})

describe('plural / countText', () => {
  const forms = ['запись', 'записи', 'записей'] as const
  it.each([[1, 'запись'], [2, 'записи'], [5, 'записей'], [11, 'записей'], [12, 'записей'], [21, 'запись'], [22, 'записи'], [111, 'записей']])('%i → %s', (n, w) => {
    expect(plural(n, forms)).toBe(w)
    expect(plural(n, ...forms)).toBe(w)
  })
  it('дробное число — родительный единственного («2,5 записи»)', () => {
    expect(plural(2.5, forms)).toBe('записи')
  })
  it('countText пишет число с NBSP', () => {
    expect(countText(24, forms)).toBe(`24${NBSP}записи`)
    expect(countText(1200, forms)).toBe(`1${NBSP}200${NBSP}записей`)
  })
})

describe('rangeText', () => {
  it('один порядок и одна единица на оба конца', () => {
    expect(rangeText(54_000, 86_700, '₽')).toBe(`54–86,7${NBSP}тыс.${NBSP}₽`)
    expect(rangeText(0.12, 0.15, '%')).toBe(`12–15${NBSP}%`)
    expect(rangeText(10, 12.5, 'ч')).toBe(`10–12,5${NBSP}ч`)
  })
  it('со знаком — словами и с U+2212', () => {
    expect(rangeText(-150e6, -50e6, '₽')).toBe(`от ${MINUS}150 до ${MINUS}50${NBSP}млн${NBSP}₽`)
    expect(rangeText(-2e6, 3e6, '₽')).toBe(`от ${MINUS}2 до 3${NBSP}млн${NBSP}₽`)
    expect(rangeText(-150e6, -50e6, '₽')).not.toContain('-')
  })
  it('концы в любом порядке; нет данных → тире', () => {
    expect(rangeText(86_700, 54_000, '₽')).toBe(rangeText(54_000, 86_700, '₽'))
    expect(rangeText(null, 5)).toBe(DASH)
  })
})

describe('bp / pp / freqText', () => {
  it('базисные и процентные пункты из долей', () => {
    expect(bp(0.0047)).toBe(`47${NBSP}б.${NBSP}п.`)
    expect(bp(-0.0012)).toBe(`${MINUS}12${NBSP}б.${NBSP}п.`)
    expect(pp(0.012)).toBe(`1,2${NBSP}п.${NBSP}п.`)
    expect(pp(0.012, { signed: true })).toBe(`+1,2${NBSP}п.${NBSP}п.`)
    expect(pp(-0.005, { signed: true })).toBe(`${MINUS}0,5${NBSP}п.${NBSP}п.`)
    expect(pp(null)).toBe(DASH)
  })
  it('вероятность как частота', () => {
    expect(freqText(0.03)).toBe('в 3 из 100')
    expect(freqText(0.5, 10)).toBe('в 5 из 10')
    expect(freqText(0.001)).toBe('реже 1 из 100')
    expect(freqText(0)).toBe('ни в одном из 100')
    expect(freqText(Number.NaN)).toBe(DASH)
  })
})

describe('runLabel', () => {
  it('номер, правило и короткое время; хэш не показывается', () => {
    const at = '2026-10-24 14:38:00'
    expect(runLabel({ seq: 28, rule: 'CR', createdAt: at })).toBe(`План №28 · CR · ${dateTimeShort(at)}`)
    expect(runLabel({ id: 'a3f9c2e1b7', rule: 'CR' })).toBe('План · CR')
    expect(runLabel({ id: '27' })).toBe('План №27')
    expect(runLabel({ seq: 3, kind: 'Портфель' })).toBe('Портфель №3')
  })
})
