import { describe, expect, it } from 'vitest'
import { oklchToHex, parseCssColor, resolveThemeColors } from './themeColors'

/** Расстояние между hex-цветами по худшему каналу (округление OKLCH→sRGB ±1). */
function channelDelta(a: string, b: string): number {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return Math.max(...[0, 1, 2].map((i) => Math.abs(ch(a, i) - ch(b, i))))
}

describe('oklchToHex', () => {
  it('matches the sRGB hex quoted next to each token in tokens.css', () => {
    const cases: Array<[number, number, number, string]> = [
      [0.17, 0.014, 268, '#0d0f16'], // --bg-app (dark)
      [0.56, 0.2, 268, '#4366e8'], // --accent / --ultramarine
      [0.76, 0.15, 152, '#5bcc80'], // --status-running
      [0.68, 0.19, 27, '#f75e54'], // --status-down
      [0.97, 0.008, 85, '#f8f5ef'], // --bg-app (light)
    ]
    for (const [l, c, h, hex] of cases) expect(channelDelta(oklchToHex(l, c, h), hex)).toBeLessThanOrEqual(2)
  })

  it('clips out-of-gamut colours instead of producing invalid hex', () => {
    expect(oklchToHex(0.9, 0.4, 140)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('parseCssColor', () => {
  it('parses oklch literals with spaces, alpha and percent lightness', () => {
    expect(parseCssColor(' oklch(0.560 0.200 268) ')).toBe(oklchToHex(0.56, 0.2, 268))
    expect(parseCssColor('oklch(56% 0.2 268deg / 0.5)')).toBe(oklchToHex(0.56, 0.2, 268))
  })

  it('normalises hex and rejects unknown syntax', () => {
    expect(parseCssColor('#ABC')).toBe('#aabbcc')
    expect(parseCssColor('#0D0F16')).toBe('#0d0f16')
    expect(parseCssColor('color-mix(in oklch, red, blue)')).toBeNull()
    expect(parseCssColor('')).toBeNull()
  })
})

describe('resolveThemeColors', () => {
  it('reads every token and reports a complete read', () => {
    const { colors, complete } = resolveThemeColors('dark', () => 'oklch(0.56 0.2 268)')
    expect(complete).toBe(true)
    expect(colors.status.running).toBe(oklchToHex(0.56, 0.2, 268))
    expect(colors.chart).toHaveLength(8)
    expect(colors.textMuted).toBe(oklchToHex(0.56, 0.2, 268))
    expect(colors.chartGrid).toBe(oklchToHex(0.56, 0.2, 268))
  })

  it('exposes map-label and floor-grid tokens with per-theme fallbacks', () => {
    const dark = resolveThemeColors('dark', () => '').colors
    const light = resolveThemeColors('light', () => '').colors
    expect(dark.textMuted).toBe('#9b9ea7')
    expect(dark.chartGrid).toBe('#282b33')
    expect(light.textMuted).toBe('#5c606a')
    expect(light.chartGrid).toBe('#e4e1db')
  })

  it('falls back to the theme table when a variable is missing or unparsable', () => {
    const { colors, complete } = resolveThemeColors('light', (name) => (name === '--bg-app' ? '' : 'nonsense'))
    expect(complete).toBe(false)
    expect(colors.theme).toBe('light')
    expect(colors.bgApp).toBe('#f8f5ef')
  })

  it('uses the probe for syntax the analytic parser does not cover', () => {
    const { colors } = resolveThemeColors('dark', () => 'color-mix(in oklch, red, blue)', () => '#123456')
    expect(colors.accent).toBe('#123456')
  })
})
