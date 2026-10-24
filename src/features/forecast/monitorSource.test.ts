/**
 * Источник «Мониторинга»: всегда «Базовый» (обучено на истории), а не «рабочий» стресс; явный `?sc=`
 * уважается; ручные правки — в единицах «Сценариев»; имя стресса — короткое имя пресета; план устарел —
 * по тем же признакам, что полоса методологии.
 */
import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import type { MethodMapState } from '../method-map/types'
import { getPreset, presetMacroMode, scenarioView } from '../scenarios/scenarioPresets'
import { changesText, isBaseScenario, manualChanges, pickMonitorScenario, stressShort } from './monitorSource'
import { planStaleReason } from './planStale'

const mode = (id: string) => JSON.stringify(presetMacroMode(getPreset(id)!))
const LEGACY_SHUFFLE = JSON.stringify({ mode: 'episode', stress: { episode: '2022-02', months: 6, order: 'blocks' } })
const SCENARIOS = [
  { id: 'work', macro_mode: LEGACY_SHUFFLE },
  { id: 'crisis', macro_mode: mode('sanctions-2022') },
  { id: 'base', macro_mode: mode('base') },
  { id: 'base2', macro_mode: mode('base') },
]

describe('сценарий «Мониторинга»', () => {
  it('рабочий стресс не становится основой: берётся сценарий с пресетом «Базовый»', () => {
    expect(isBaseScenario(SCENARIOS[2])).toBe(true)
    expect(isBaseScenario(SCENARIOS[0])).toBe(false)
    expect(pickMonitorScenario(SCENARIOS, { context: 'work', plan: 'crisis' })).toBe('base')
    expect(pickMonitorScenario(SCENARIOS, { context: 'base2' })).toBe('base2')
    expect(pickMonitorScenario(SCENARIOS, { plan: 'base2' })).toBe('base2')
  })

  it('явный ?sc= уважается; «Базового» нет — пусто (считаем пресет без сценария)', () => {
    expect(pickMonitorScenario(SCENARIOS, { explicit: 'crisis', context: 'base' })).toBe('crisis')
    expect(pickMonitorScenario(SCENARIOS, { explicit: 'нет-такого' })).toBe('base')
    expect(pickMonitorScenario(SCENARIOS.slice(0, 2), {})).toBe('')
  })

  it('имя стресса — короткое имя пресета, не текст режима генератора', () => {
    expect(stressShort(scenarioView(mode('sanctions-2022')))).toBe('Как 2022')
    expect(stressShort(scenarioView(mode('base')))).toBeNull()
    const legacy = stressShort(scenarioView(LEGACY_SHUFFLE))
    expect(legacy).not.toMatch(/прежний способ|вперемешку/)
    expect(legacy).toBeTruthy()
  })
})

describe('ручные правки сценария', () => {
  it('отличия от пресета — в единицах карточек «Сценариев»', () => {
    const sc = { fx: '0.65', demand: '0.75', volatility: String(0.06 * 1.75) }
    const ch = manualChanges(sc, getPreset('base')!, null)
    expect(ch.map((c) => c.key)).toEqual(['volatility', 'fx', 'demand'])
    const text = changesText(ch)
    expect(text).toContain(`разброс цен 175${NBSP}% от исторического`)
    expect(text).toContain(`спрос −25${NBSP}% к справочнику`)
    expect(text).toMatch(/сдвиг курса доллара −35/)
  })

  it('значения пресета и пустые поля — не правки', () => {
    const p = getPreset('sanctions-2022')!
    const asPreset = { volatility: String(p.values.volatility), market_corr: String(p.values.market_corr), demand: String(p.values.demand) }
    expect(manualChanges(asPreset, p, null)).toEqual([])
    expect(manualChanges({ ...asPreset, market_corr: '0.5' }, p, null).map((c) => c.key)).toEqual(['market_corr'])
    expect(manualChanges({ fx: '', demand: '' }, getPreset('base')!, null)).toEqual([])
    expect(manualChanges(null, null, null)).toEqual([])
  })
})

describe('план устарел', () => {
  const state = (nodes: MethodMapState['nodes']) => ({ nodes } as unknown as MethodMapState)
  const fresh = state({ 'dec.schedule': { state: 'estimated' }, 'dec.portfolio': { state: 'estimated' } })

  it('узел «План» или портфель плана устарели — причина словами', () => {
    expect(planStaleReason({ state: state({ 'dec.schedule': { state: 'stale', reason: 'портфель пересчитан после построения плана' } }), builtAt: 1, fromPortfolio: true, portfolioAt: 2, changed: {} }))
      .toBe('портфель пересчитан после построения плана')
    expect(planStaleReason({ state: state({ 'dec.portfolio': { state: 'stale', reason: 'портфель считался под другой сценарий' } }), builtAt: 1, fromPortfolio: true, portfolioAt: 1, changed: {} }))
      .toBe('портфель считался под другой сценарий')
  })

  it('справочники или сценарий изменены после построения; плана нет — не устарел', () => {
    expect(planStaleReason({ state: fresh, builtAt: 10, fromPortfolio: false, portfolioAt: null, changed: { nsi: 20 } })).toBe('справочники изменились после построения плана')
    expect(planStaleReason({ state: fresh, builtAt: 10, fromPortfolio: false, portfolioAt: null, changed: { scenario: 20 } })).toBe('сценарий изменён после построения плана')
    expect(planStaleReason({ state: fresh, builtAt: 30, fromPortfolio: false, portfolioAt: null, changed: { nsi: 20 } })).toBeNull()
    expect(planStaleReason({ state: fresh, builtAt: null, fromPortfolio: false, portfolioAt: null, changed: { nsi: 20 } })).toBeNull()
  })
})
