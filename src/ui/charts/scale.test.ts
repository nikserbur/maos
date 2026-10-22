import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import { areaPath, axisNum, bandPath, extent, labelStep, linePath, niceTicks, segments, wrapLabel, yDomain, yTicks } from './scale'

describe('extent / yDomain / yTicks', () => {
  it('ignores NaN and returns [0, 1] for an empty series', () => {
    expect(extent([3, Number.NaN, -2, 7])).toEqual([-2, 7])
    expect(extent([])).toEqual([0, 1])
  })

  it('includes zero for columns and pads a degenerate domain', () => {
    const [lo, hi] = yDomain(40, 60, true)
    expect(lo).toBe(0)
    expect(hi).toBeGreaterThan(60)
    const [a, b] = yDomain(5, 5, false)
    expect(a).toBeLessThan(5)
    expect(b).toBeGreaterThan(5)
  })

  it('keeps a negative lower bound when zero is included', () => {
    const [lo] = yDomain(-10, 5, true)
    expect(lo).toBeLessThan(-10)
  })

  it('falls back to the domain bounds when no round tick fits', () => {
    expect(yTicks(0.12, 0.13, 4).length).toBeGreaterThanOrEqual(2)
    expect(yTicks(0, 100, 4)).toEqual(niceTicks(0, 100, 4))
  })
})

describe('labelStep', () => {
  it('shows every label when there is room and thins them when there is not', () => {
    expect(labelStep(['01', '02', '03'], 600)).toBe(1)
    const dense = Array.from({ length: 40 }, (_, i) => `07-06 09:${String(i).padStart(2, '0')}`)
    expect(labelStep(dense, 600)).toBeGreaterThan(3)
  })
})

describe('paths', () => {
  const xAt = (i: number) => i * 10
  const yAt = (v: number) => 100 - v

  it('splits segments at NaN gaps', () => {
    const segs = segments([1, 2, Number.NaN, 4], xAt, yAt)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual([{ x: 0, y: 99 }, { x: 10, y: 98 }])
  })

  it('builds line, area and band paths', () => {
    const pts = [{ x: 0, y: 10 }, { x: 10, y: 5 }]
    expect(linePath(pts)).toBe('M0.0,10.0L10.0,5.0')
    expect(areaPath(pts, 20)).toBe('M0.0,10.0L10.0,5.0L10.0,20.0L0.0,20.0Z')
    expect(bandPath(pts, [{ x: 0, y: 30 }, { x: 10, y: 25 }])).toBe('M0.0,10.0L10.0,5.0L10.0,25.0L0.0,30.0Z')
    expect(linePath([])).toBe('')
  })
})

describe('wrapLabel', () => {
  it('wraps by words into at most two lines and marks the cut with an ellipsis', () => {
    expect(wrapLabel('Отрезка заготовки вала', 14)).toEqual(['Отрезка', 'заготовки вала'])
    const lines = wrapLabel('Ленточнопильный отрезной станок с ЧПУ большой', 16, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('keeps a short label on one line', () => {
    expect(wrapLabel('Ковка', 20)).toEqual(['Ковка'])
  })
})

describe('axisNum', () => {
  it('compacts thousands and millions, keeps small values plain', () => {
    expect(axisNum(86)).toBe('86')
    expect(axisNum(12400)).toBe(`12,4${NBSP}тыс.`)
    expect(axisNum(-2_500_000)).toBe(`−2,5${NBSP}млн`)
  })
})
