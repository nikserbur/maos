import { describe, expect, it } from 'vitest'
import { makeLandscape, run } from './ga'

describe('GA landscape', () => {
  it('детерминирован по seed', () => {
    const a = run(7, 20).history.map((g) => g.best.fit)
    const b = run(7, 20).history.map((g) => g.best.fit)
    expect(a).toEqual(b)
  })

  it('глобальный максимум не в центре и выше локальных', () => {
    for (let s = 1; s <= 20; s++) {
      const ls = makeLandscape(s)
      const g = ls.peaks[ls.globalIdx]
      expect(Math.hypot(g.x, g.y)).toBeGreaterThan(0.3)
      for (const p of ls.peaks.slice(1)) expect(ls.f(p.x, p.y)).toBeLessThan(ls.fMax)
    }
  })

  it('элитизм: лучшее значение не убывает, гены в границах', () => {
    const { history } = run(3, 40)
    for (let i = 1; i < history.length; i++) {
      expect(history[i].best.fit).toBeGreaterThanOrEqual(history[i - 1].best.fit - 1e-12)
    }
    for (const g of history) for (const x of g.pop) {
      expect(Math.abs(x.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(x.y)).toBeLessThanOrEqual(1)
    }
  })

  it('сходится к глобальному максимуму на ≥ 80 % сидов', () => {
    let ok = 0
    for (let s = 1; s <= 20; s++) {
      const { ls, history } = run(s, 70)
      if (history[history.length - 1].best.fit >= ls.fMax * 0.97) ok++
    }
    expect(ok).toBeGreaterThanOrEqual(16)
  })
})
