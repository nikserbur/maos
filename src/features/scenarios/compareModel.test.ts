import { describe, expect, it } from 'vitest'
import type { PriceScenario } from '../../lib/api'
import { MINUS } from '../../explain/format'
import { buildLines, conditionRows, visibleLines } from './compareModel'

const sc = (id: string, over: Partial<PriceScenario> = {}): PriceScenario => ({ id, name: id, description: '', horizon_hours: '720', created_at: '', ...over })

describe('сравнение сценариев', () => {
  it('α 10 % по умолчанию и заданные 10 % — не отличие; умолчание помечено', () => {
    const lines = buildLines(conditionRows(), [sc('a'), sc('b', { alpha: '0.1' })])
    const alpha = lines.find((l) => l.key === 'alpha')!
    expect(alpha.differs).toBe(false)
    expect(alpha.cells[0].isDefault).toBe(true)
    expect(alpha.cells[0].text).not.toBe('—')
    expect(visibleLines(lines, true).some((l) => l.key === 'alpha')).toBe(false)
  })

  it('критерий — человеческим словом, без «meanvariance»; Δ к базе посчитана', () => {
    const lines = buildLines(conditionRows(), [sc('a'), sc('b', { objective: 'meanvariance', market_corr: '0.25' })])
    const obj = lines.find((l) => l.key === 'objective')!
    expect(obj.cells[1].text).not.toContain('meanvariance')
    expect(obj.cells[1].text).toBe('E − λ·σ')
    const corr = lines.find((l) => l.key === 'market_corr')!
    expect(corr.differs).toBe(true)
    expect(corr.cells[1].delta).toBeCloseTo(-0.25)
    expect(corr.deltaFmt?.(-0.25)).toBe(`${MINUS}0,25`)
  })

  it('режим генератора показывается всегда', () => {
    const lines = visibleLines(buildLines(conditionRows(), [sc('a'), sc('b')]), true)
    expect(lines.map((l) => l.key)).toEqual(['mode'])
  })
})
