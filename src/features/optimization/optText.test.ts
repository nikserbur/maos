import { describe, expect, it } from 'vitest'
import type { OptForm } from './optStore'
import {
  criterionText, exactGapView, formFromResult, histogramTitle, lineageText, loadTitle, lossFreqText, oosCvarText,
  oosExpectedText, oosWorse, paramsSummary, paretoTitle, serverTime, staleFields, verdictText,
} from './optText'
import type { OptResultExt } from './optTypes'
import { displayBins } from './ProfitDistribution'
import { OBJECTIVES, kpiLabels, lpApplies } from './optTypes'

const NB = '\u00a0'
const m = (expected: number, cvar: number, p_loss: number) => ({ expected, std: 1, worst_case: -1, var: -1, cvar, p_loss, downside: 0, best: 2.25e9, max_regret: 0 })
const R = {
  scenario_id: 's1', scenario_name: 'Базовый', objective: 'cvar', samples: 3000, alpha: 0.1, lambda: 0.5, horizon_hours: 9360, max_share: 0.6,
  robust: { diversification: { n_products: 6 }, metrics: m(45.7e6, -53.7e6, 0.35) },
  expected: { diversification: { n_products: 3 }, metrics: { ...m(60e6, -497e6, 0.4), worst_case: -792e6 } },
  histogram: [{ x0: 0, x1: 1, count: 1 }], run_id: 'a1b2c3d4-ffff',
} as unknown as OptResultExt
const FORM: OptForm = { scenarioId: 's1', objective: 'cvar', samples: '3000', alpha: '0.10', maxShare: '0.6', horizonMonths: '13', exact: false }

describe('Портфель: слова экрана', () => {
  it('verdict reads as one sentence with a frequency, not a probability', () => {
    expect(verdictText(R)).toBe(
      `Выпускать 6${NB}изделий: в среднем +45,7${NB}млн${NB}₽, убыток — в 35 из 100 сценариев; ` +
      `в худших 10${NB}% в среднем −53,7${NB}млн${NB}₽ против −497${NB}млн${NB}₽ у «макс. E»`)
    expect(lossFreqText(0)).toBe('ни в одном из 100 сценариев')
  })

  it('criterion: α only for CVaR, λ for E − λ·σ, raw ids never shown', () => {
    expect(criterionText('cvar', 0.1)).toBe(`CVaR · α = 10${NB}%`)
    expect(criterionText('meanvariance', 0.1, 0.5)).toBe('E − λ·σ · λ = 0,5')
    expect(criterionText('meanvariance', 0.1, 0.5)).not.toContain('α')
    expect(criterionText('worstcase', 0.1)).toBe('худший случай')
    expect(OBJECTIVES.map((o) => o.label)).toEqual(['CVaR', 'Худший случай', 'E − λ·σ', 'Мин. сожаление'])
    expect(lpApplies('cvar') && lpApplies('worstcase') && !lpApplies('meanvariance') && !lpApplies('minregret')).toBe(true)
  })

  it('one KPI label map keeps σ lowercase and names the tail', () => {
    const L = kpiLabels(0.1)
    expect(L.std).toBe('σ прибыли')
    expect(L.cvar).toBe(`CVaR (худшие 10${NB}%)`)
  })

  it('lineage and params summary', () => {
    expect(lineageText(R, null)).toBe('#a1b2c3 · «Базовый» · CVaR · N = 3' + NB + '000')
    expect(paramsSummary(FORM, 'Базовый')).toBe(`Базовый · CVaR · α 10${NB}% · 3${NB}000${NB}сценариев · доля ≤ 60${NB}% · 13 мес`)
    expect(paramsSummary({ ...FORM, objective: 'meanvariance' }, 'Базовый')).not.toContain('α')
  })

  it('stale: form vs result, with the same server clamps', () => {
    expect(staleFields(FORM, R)).toEqual([])
    expect(staleFields({ ...FORM, alpha: '0.05' }, R)).toEqual(['α'])
    expect(staleFields({ ...FORM, horizonMonths: '12', objective: 'worstcase' }, R)).toEqual(['критерий', 'горизонт'])
    expect(staleFields(FORM, { ...R, samples: 200 } as OptResultExt)).toEqual(['число сценариев'])
    expect(staleFields({ ...FORM, samples: '100' }, { ...R, samples: 200 } as OptResultExt)).toEqual([])
    expect(staleFields({ ...FORM, ...formFromResult(R) } as OptForm, R)).toEqual([])
  })

  it('out-of-sample verdict respects direction (worse only when OOS is lower by > 5 %)', () => {
    expect(oosWorse({ gap_expected: -0.088, gap_cvar: -0.016 })).toBe(false)
    expect(oosWorse({ gap_expected: 0.06, gap_cvar: 0 })).toBe(true)
    expect(oosExpectedText(-0.088)).toBe(`на 8,8${NB}% выше, чем в выборке`)
    expect(oosCvarText(-0.016)).toBe(`на 1,6${NB}% лучше`)
    expect(oosCvarText(0.02)).toBe(`на 2${NB}% хуже`)
  })

  it('LP gap in words; a negative gap is the heuristic winning', () => {
    expect(exactGapView(2.1)).toMatchObject({ glyph: '▲', text: `LP лучше на 2,1${NB}%`, tone: 'up' })
    expect(exactGapView(-0.4)).toMatchObject({ glyph: '▼', text: `эвристика лучше на 0,4${NB}%`, tone: 'down' })
    expect(exactGapView(null).text).toBe('—')
  })

  it('statement titles', () => {
    expect(histogramTitle(0.1, -47e6)).toBe(`В 1 из 10 сценариев прибыль ниже −47${NB}млн${NB}₽`)
    expect(histogramTitle(0.05, -47e6)).toMatch(/^В 5 из 100 сценариев/)
    const cands = [{ is_robust: true, is_pareto: true }, { is_robust: false, is_pareto: false }] as never
    expect(paretoTitle(cands)).toEqual({ title: 'Устойчивый портфель — на границе: меньше риска ценой доходности', meta: '1 недоминируемых из 2' })
    const load = [{ wc_type_id: 'a', load_hours: 1, capacity_hours: 1, utilization: 0.18 }]
    expect(loadTitle(load, () => 'Резьбонарезной станок')).toBe(`Мощности не ограничивают портфель: максимум 18${NB}% — Резьбонарезной станок`)
  })

  it('own robust bins win over the shared ones', () => {
    expect(displayBins({ histogram: [{ x0: 0, x1: 1, count: 1 }], histogram_robust: [{ x0: 0, x1: 2, count: 1 }, { x0: 2, x1: 3, count: 1 }] }).own).toBe(true)
    expect(displayBins({ histogram: [{ x0: 0, x1: 1, count: 1 }], histogram_robust: [] }).own).toBe(false)
  })

  it('server timestamps without a zone are UTC', () => {
    expect(serverTime('2026-10-24 11:32:00')).toBe(Date.UTC(2026, 9, 24, 11, 32))
    expect(serverTime('')).toBeNull()
    expect(serverTime('мусор')).toBeNull()
  })
})
