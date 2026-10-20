import { describe, expect, it } from 'vitest'
import { axisMoney, clamp, linear, nearestIndex, niceTicks, shareBelow, svgId } from './scale'

describe('linear', () => {
  it('maps the domain onto the range', () => {
    const x = linear(0, 10, 100, 200)
    expect(x(0)).toBe(100)
    expect(x(5)).toBe(150)
    expect(x(10)).toBe(200)
  })

  it('returns the middle of the range for a degenerate domain', () => {
    expect(linear(3, 3, 0, 10)(42)).toBe(5)
  })
})

describe('niceTicks', () => {
  it('produces round steps that straddle zero', () => {
    expect(niceTicks(-1.3e6, 4.1e6, 5)).toEqual([-1e6, 0, 1e6, 2e6, 3e6, 4e6])
  })

  it('stays inside the requested interval', () => {
    const ticks = niceTicks(0.12, 0.93, 4)
    expect(ticks[0]).toBeGreaterThanOrEqual(0.12)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(0.93)
    expect(ticks).toEqual([0.2, 0.4, 0.6, 0.8])
  })

  it('never emits a negative zero', () => {
    expect(niceTicks(-2, 2, 4).some((t) => Object.is(t, -0))).toBe(false)
  })

  it('handles empty and invalid input', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(Number.NaN, 1)).toEqual([])
  })
})

describe('axisMoney', () => {
  it('drops the rouble sign but keeps the magnitude suffix', () => {
    expect(axisMoney(2_500_000)).toBe('2,5 млн')
    expect(axisMoney(-1_200_000)).toBe('−1,2 млн')
  })
})

describe('shareBelow', () => {
  const bins = [
    { x0: 0, x1: 10, count: 10 },
    { x0: 10, x1: 20, count: 30 },
    { x0: 20, x1: 30, count: 60 },
  ]

  it('counts whole bins left of the threshold', () => {
    expect(shareBelow(bins, 20)).toBeCloseTo(0.4)
  })

  it('interpolates inside a bin', () => {
    expect(shareBelow(bins, 15)).toBeCloseTo(0.25)
  })

  it('is zero for an empty histogram', () => {
    expect(shareBelow([], 1)).toBe(0)
  })
})

describe('helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
  })

  it('finds the nearest point', () => {
    expect(nearestIndex([{ x: 0, y: 0 }, { x: 10, y: 10 }], 8, 9)).toBe(1)
    expect(nearestIndex([], 0, 0)).toBe(-1)
  })

  it('builds url-safe svg ids', () => {
    expect(svgId(':r1:', 'tail')).toBe('r1-tail')
  })
})
