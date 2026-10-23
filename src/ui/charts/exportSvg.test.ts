import { describe, expect, it } from 'vitest'
import { styleText, svgFileName } from './exportSvg'

describe('SVG export helpers', () => {
  it('inlines only meaningful computed values', () => {
    const values: Record<string, string> = { fill: 'rgb(10, 20, 30)', opacity: '1', stroke: 'none', 'stroke-dasharray': 'none', 'font-size': '11px', 'font-weight': 'normal' }
    expect(styleText((p) => values[p] ?? '')).toBe('fill:rgb(10, 20, 30);stroke:none;font-size:11px')
  })

  it('builds a safe dated file name', () => {
    expect(svgFileName('Очереди / по типам: пик', new Date(2026, 9, 23))).toBe('Очереди_по_типам_пик_2026-10-23.svg')
    expect(svgFileName('', new Date(2026, 0, 2))).toBe('график_2026-01-02.svg')
  })
})
