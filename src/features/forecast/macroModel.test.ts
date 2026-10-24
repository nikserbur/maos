/**
 * «Внешние условия» и «Что если…»: квантили по траекториям генератора, качество словами по отложенной
 * проверке, история ЦБ до опоры, перевод настоящих единиц в параметры движка и состояние в адресе.
 */
import { describe, expect, it } from 'vitest'
import type { MacroPath } from '../../lib/api'
import { NBSP } from '../../explain/format'
import { fanFromPaths, generatorInflation, historyTail, macroQuality, monthlyToYoy, withHistory, yoyToMonthly } from './macroModel'
import { whatIfFromParams, whatIfLabel, whatIfRequest, whatIfToParams, type WhatIf } from './whatIfModel'

const path = (i: number, cpi: number[]): MacroPath => ({ id: i, regime: cpi.map(() => 0), monthly: { cpi, key: cpi.map((v) => v + 8), fx: cpi.map((v) => 80 + v) }, weekly: null })

describe('веер по траекториям', () => {
  it('опора — последнее наблюдение, дальше P10/P50/P90 по месяцам', () => {
    const paths = Array.from({ length: 11 }, (_, i) => path(i, [i, i + 1]))
    const f = fanFromPaths(paths, 'cpi', 6.35)
    expect(f.p50).toEqual([6.35, 5, 6])
    expect(f.p10).toEqual([6.35, 1, 2])
    expect(f.p90).toEqual([6.35, 9, 10])
    expect(fanFromPaths([], 'fx', 84).p50).toEqual([])
  })

  it('инфляция генератора — среднее медианного пути, иначе последнее наблюдение', () => {
    expect(generatorInflation({ p10: [], p50: [6.35, 6, 5], p90: [] }, 6.35)).toBeCloseTo(0.055)
    expect(generatorInflation(null, 6.35)).toBeCloseTo(0.0635)
    expect(generatorInflation(null, null)).toBeNull()
    expect(monthlyToYoy(yoyToMonthly(0.0635))).toBeCloseTo(0.0635)
  })

  it('история ЦБ до опоры включительно', () => {
    const h = { month: ['2026-07', '2026-08', '2026-09'], key_pp: [16, 15, 14], cpi_yoy_pp: [7, 6.5, 6.35], usd_rub: [90, 88, 84.4] }
    expect(historyTail(h, 'key', '2026-09', 2)).toEqual([15, 14])
    expect(historyTail(h, 'fx', '2030-01')).toBeNull()
    expect(withHistory({ p10: [14], p50: [14], p90: [14], history: [14] }, [15, 14]).history).toEqual([15, 14])
  })

  it('качество — частотой и словами; без проверки — «не проверено»', () => {
    const q = macroQuality({ coverage80: 0.8, coverage90: 0.9, mean_CRPS: 0.88, mean_CRPS_persistence: 1, rmse_mean: 1, rmse_persistence: 1, PIT_histogram10: [] })
    expect(q.level).toBe('ok')
    expect(q.sentence).toBe(`проверено на отложенных данных: внутри полосы 8 из 10 (норма 8 из 10) · точнее «как вчера» на 12${NBSP}%`)
    expect(macroQuality(undefined).sentence).toBe('качество не проверено')
  })
})

describe('«Что если…»', () => {
  const ctx = { generatorCpi: 0.0635, usdNow: 84.43, volatility: 0.05, corr: 0.5 }

  it('настоящие единицы → параметры движка: г/г → в месяц, курс → множитель к текущему', () => {
    const w: WhatIf = { preset: 'base', months: 6, inflation: null, usd: 92.873, demand: null }
    const p = whatIfRequest(w, ctx, { runs: 3000, backtest: 6 })
    expect(p.inflation).toBeCloseTo(yoyToMonthly(0.0635))
    expect(p.fx).toBeCloseTo(1.1, 3)
    expect(p.demand).toBe(1)
    expect(p.macro_stress).toBeNull()
  })

  it('пресет из истории — эпизод по порядку; экспертный спрос пресета, если не задан свой', () => {
    const p = whatIfRequest({ preset: 'covid-2020', months: 6, inflation: 0.08, usd: null, demand: null }, ctx, {})
    expect(p.macro_stress).toMatchObject({ episode: '2020-03', order: 'replay' })
    expect(p.demand).toBe(0.8)
    expect(p.inflation).toBeCloseTo(yoyToMonthly(0.08))
  })

  it('состояние в адресе переживает F5; мусор — значения по умолчанию', () => {
    const w: WhatIf = { preset: 'sanctions-2022', months: 9, inflation: 0.085, usd: 95, demand: 0.9 }
    expect(whatIfFromParams(whatIfToParams(w) as Record<string, string>, 6)).toEqual(w)
    expect(whatIfFromParams({ wp: 'нет-такого', wm: 'x' }, 6)).toEqual({ preset: 'base', months: 6, inflation: null, usd: null, demand: null })
    expect(whatIfLabel(w)).toBe(`Как 2022 · 9${NBSP}мес · инфляция 8,5${NBSP}% в год · курс 95${NBSP}₽ за $ · спрос −10${NBSP}% к справочнику`)
  })
})
