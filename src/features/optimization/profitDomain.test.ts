import { describe, expect, it } from 'vitest'
import { robustDomain } from './ProfitDistribution'

describe('robustDomain', () => {
  const bins = Array.from({ length: 24 }, (_, i) => ({ x0: -1000 + i * 150, x1: -850 + i * 150, count: i >= 6 && i <= 8 ? [40, 2900, 60][i - 6] : 0, count_expected: 100 }))
  it('windows the axis to the robust mass with half-bin padding and keeps the marks inside', () => {
    const [lo, hi] = robustDomain(bins, [-73, -53, -44, 58])
    expect(lo).toBe(-100 - 75)
    expect(hi).toBe(350 + 75)
  })
  it('expands the window when a mark lies outside the bins', () => {
    const [lo] = robustDomain(bins, [-400])
    expect(lo).toBe(-475)
  })
})
