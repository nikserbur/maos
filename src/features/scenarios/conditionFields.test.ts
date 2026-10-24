/**
 * Поля «Условий» и месяцы словами: единицы как у ЦБ РФ (% г/г), разброс — % от исторического, курс и
 * спрос — сдвиг к генератору и справочнику (а не «1 ×»), источник умолчания словами; эффект — одна строка.
 */
import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import { CONDITION_SPECS, conditionSpec } from './conditionFields'
import { addMonths, monthRuns, monthShort, monthsBetween, windowLabel } from './monthText'
import { inflationFromYoy } from './scenarioDefaults'
import { isDuplicateName, uniqueName } from './scenarioNames'

const lastObs = { month: '2026-09', cpi_yoy_pp: 6.35, key_pp: 14, usd_rub: 84.4283 }
const ctx = { lastObs, months: 6 }

describe('поля условий', () => {
  it('инфляция: % г/г с шагом 0,1 ↔ доля в месяц; умолчание — пути генератора от ЦБ РФ; своё — опора путей везде', () => {
    const s = conditionSpec('inflation')
    const m = inflationFromYoy(6.5)
    expect(s.unit).toBe(`%${NBSP}г/г`)
    expect(s.toShown(m)).toBe(6.5)
    expect(s.toShown(inflationFromYoy(12.68))).toBe(12.7)                 // без ложной точности
    expect(s.toStored(6.5)).toBeCloseTo(m, 12)
    const gen = { ...ctx, lastObs: { ...lastObs, cpi_yoy_pp: 6.5 }, generator: { cpiEnd: 5.8, fxEnd: 86.5 } }
    expect(s.effect(m, gen, true)).toBe(`генератор: 6,5${NBSP}% → 5,8${NBSP}% г/г через 6${NBSP}мес`)
    expect(s.effect(inflationFromYoy(12), gen, false)).toBe(`пути инфляции вокруг 12${NBSP}% г/г — в ценах, Портфеле и кассе`)
    expect(s.origin(ctx)).toEqual({ status: 'О', source: 'генератор · ЦБ РФ, сент. 2026' })
    expect(s.origin({ months: 6 }).status).toBe('техн.')
    expect(s.range[0]).toBeGreaterThan(0)
    expect(s.min).toBeLessThan(0)
  })

  it('разброс — % от исторического (0,06 = 100 %), курс и спрос — сдвиг в %, без «×»', () => {
    const v = conditionSpec('volatility')
    expect(v.toShown(0.06)).toBe(100)
    expect(v.toStored(200)).toBeCloseTo(0.12, 12)
    expect(v.effect(0.06, ctx)).toBe('вееры цен — как колебания в истории')
    expect(v.effect(0.12, ctx)).toBe('вееры цен в 2 раза шире исторических')
    const fx = conditionSpec('fx')
    expect(fx.toShown(1)).toBe(0)
    expect(fx.toStored(10)).toBeCloseTo(1.1, 12)
    expect(fx.effect(1, ctx)).toBe(`сейчас 84,43${NBSP}₽ за доллар, дальше — пути генератора`)
    expect(fx.effect(1, { ...ctx, generator: { cpiEnd: 5.8, fxEnd: 86.5 } })).toBe(`генератор: 84,4 → 86,5${NBSP}₽ за доллар через 6${NBSP}мес`)
    expect(fx.effect(1.1, ctx)).toBe(`84,43 → 92,87${NBSP}₽ за доллар · в Портфеле, кассе и ценах`)
    expect(fx.unit).toBe('% к курсу по прогнозу')
    const d = conditionSpec('demand')
    expect(d.toShown(0.85)).toBe(-15)
    expect(d.text(0.85)).toBe(`−15${NBSP}% к справочнику`)
    expect(d.hint(ctx)).not.toMatch(/упрощени|уровень цен/)          // спрос — потолок продаж, не цены
    for (const spec of CONDITION_SPECS) {
      expect(spec.unit ?? '').not.toMatch(/×|\/мес/)
      expect(spec.label).toBe(spec.label.charAt(0) + spec.label.slice(1).toLowerCase())   // обычный регистр
    }
  })
})

describe('месяцы словами', () => {
  it('месяц, окно, сдвиг, подряд идущие месяцы', () => {
    expect(monthShort('2026-09')).toBe('сент. 2026')
    expect(monthShort('junk')).toBe('')
    expect(addMonths('2022-02', 6)).toBe('2022-08')
    expect(addMonths('2014-12', 1)).toBe('2015-01')
    expect(monthsBetween('2026-05', '2026-09')).toBe(4)
    expect(windowLabel('2022-02', 7)).toBe('февр.–авг. 2022')
    expect(windowLabel('2014-12', 7)).toBe('дек. 2014 – июнь 2015')
    expect(windowLabel('2023-03', 1)).toBe('март 2023')
    expect(monthRuns(['2015-01', '2014-12', '2023-03'])).toBe('дек. 2014 – янв. 2015, март 2023')
  })
})

describe('имена сценариев', () => {
  it('занятое имя получает номер; повтор распознаётся без учёта регистра', () => {
    expect(uniqueName('Базовый', ['Базовый'])).toBe('Базовый 2')
    expect(uniqueName('Базовый', ['базовый', 'Базовый 2'])).toBe('Базовый 3')
    expect(uniqueName('Новый', [])).toBe('Новый')
    expect(isDuplicateName(' базовый ', ['Базовый'])).toBe(true)
    expect(isDuplicateName('Другой', ['Базовый'])).toBe(false)
  })
})
