import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import { DEFAULT_MENU, fromMacroMode, regimeLabel, regimeMenuReducer, regimeSummary, toMacroMode } from './regimeMenu'

describe('regime / stress menu reducer (§2.6б)', () => {
  it('starts as the base forecast and serialises to the plain name', () => {
    expect(toMacroMode(DEFAULT_MENU)).toBe('base')
    expect(regimeLabel(DEFAULT_MENU).isForecast).toBe(true)
  })

  it('forces a regime, clamps quantiles and keeps episode length', () => {
    const r = regimeMenuReducer(DEFAULT_MENU, { type: 'regime', regime: 1 })
    expect(toMacroMode(r)).toEqual({ mode: 'regime', stress: { regime: 1 } })
    expect(regimeLabel(r, ['спокойный', 'кризис'])).toEqual({ text: 'режим «кризис» навязан — стресс', isForecast: false })
    const q = regimeMenuReducer(r, { type: 'quantile', quantile: 1.7 })
    expect(toMacroMode(q)).toEqual({ mode: 'quantile', stress: { quantile_t: 0.99 } })
    const e = regimeMenuReducer(q, { type: 'episode', episode: '2014-12', months: 4 })
    expect(toMacroMode(e)).toEqual({ mode: 'episode', stress: { episode: '2014-12', months: 4 } })
    expect(regimeLabel(e).isForecast).toBe(false)
  })

  it('adds the reference only when it is non-default and builds the custom key path', () => {
    const s = regimeMenuReducer(regimeMenuReducer(DEFAULT_MENU, { type: 'refCpi', refCpi: 'nodes' }), { type: 'refKey', refKey: 'custom', customKey: 12 })
    expect(toMacroMode(s, 3)).toEqual({ mode: 'base', ref: { cpi: 'nodes', key: [12, 12, 12] } })
    const back = regimeMenuReducer(s, { type: 'refKey', refKey: 'flat' })
    expect(back.customKey).toBeNull()
    expect(toMacroMode(back)).toEqual({ mode: 'base', ref: { cpi: 'nodes' } })
  })

  it('round-trips through the scenario JSON field and tolerates junk', () => {
    const s = regimeMenuReducer(regimeMenuReducer(DEFAULT_MENU, { type: 'quantile', quantile: 0.05 }), { type: 'refCpi', refCpi: 'nodes' })
    const json = JSON.stringify(toMacroMode(s))
    expect(fromMacroMode(json)).toMatchObject({ kind: 'quantile', quantile: 0.05, refCpi: 'nodes' })
    expect(fromMacroMode(JSON.stringify(toMacroMode(regimeMenuReducer(DEFAULT_MENU, { type: 'episode', episode: '2022-03' }))))).toMatchObject({ kind: 'episode', episode: '2022-03', episodeMonths: 6 })
    expect(fromMacroMode('')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode('base')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode('{broken')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode('iid_v063')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode({ mode: 'regime' })).toMatchObject({ kind: 'regime' })
  })

  it('formats the quantile label through the ru formatter (ru locale, comma)', () => {
    const q = regimeMenuReducer(DEFAULT_MENU, { type: 'quantile', quantile: 0.9 })
    expect(regimeLabel(q).text).toBe('квантильный стресс q = 0,9')
  })

  it('builds the one-line summary for the collapsed regimes section', () => {
    const shares = [{ label: 'спокойный', share: 0.92 }, { label: 'кризис', share: 0.08 }]
    expect(regimeSummary(DEFAULT_MENU, shares, 0.976)).toBe(`базовый · 92${NBSP}% спокойный / 8${NBSP}% кризис · CRPS 0,98`)
    expect(regimeSummary(DEFAULT_MENU, [], null)).toBe('базовый')
    const forced = regimeMenuReducer(DEFAULT_MENU, { type: 'regime', regime: 1 })
    expect(regimeSummary(forced, shares, undefined)).toBe(`режим «кризис» навязан · 92${NBSP}% спокойный / 8${NBSP}% кризис`)
  })

  it('reset returns the default and identical actions do not create new objects', () => {
    const r = regimeMenuReducer(DEFAULT_MENU, { type: 'regime', regime: 0 })
    expect(regimeMenuReducer(r, { type: 'reset' })).toBe(DEFAULT_MENU)
    expect(regimeMenuReducer(DEFAULT_MENU, { type: 'kind', kind: 'base' })).toBe(DEFAULT_MENU)
  })
})
