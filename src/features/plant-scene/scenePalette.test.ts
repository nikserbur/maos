import { describe, expect, it } from 'vitest'
import { mix, mute, scenePalette, type ScenePalette, type Tone } from './scenePalette'
import { resolveThemeColors } from './themeColors'
import type { Theme } from '../../shell/theme'

const HEX = /^#[0-9a-f]{6}$/
const FAMILIES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet'] as const

/** Токены не читаются (нет DOM) — берутся запасные значения темы = hex из tokens.css. */
const paletteOf = (theme: Theme): ScenePalette => scenePalette(resolveThemeColors(theme, () => '').colors)
const luma = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const flat = (p: ScenePalette): string[] => [
  ...p.n,
  ...FAMILIES.flatMap((f) => Object.values(p[f] as Tone)),
  p.lawn, p.lawnCell, p.lawnSection, p.floor, p.lamp,
]

describe('scenePalette', () => {
  it.each<Theme>(['dark', 'light'])('даёт только валидные #rrggbb в теме %s', (theme) => {
    for (const c of flat(paletteOf(theme))) expect(c).toMatch(HEX)
  })

  it('нейтральная шкала идёт от ink к bone и растёт по яркости', () => {
    const { n } = paletteOf('dark')
    expect(n).toHaveLength(9)
    expect(n[0]).toBe('#171a24')
    expect(n[8]).toBe('#f2eee6')
    for (let i = 1; i < n.length; i++) expect(luma(n[i])).toBeGreaterThan(luma(n[i - 1]))
  })

  it('тона семейств упорядочены: тёмный < средний < светлый', () => {
    for (const theme of ['dark', 'light'] as const) {
      const p = paletteOf(theme)
      for (const f of FAMILIES) {
        expect(luma(p[f].d)).toBeLessThan(luma(p[f].m))
        expect(luma(p[f].m)).toBeLessThan(luma(p[f].l))
      }
    }
  })

  it('окружение следует теме, а пол цеха не совпадает с газоном', () => {
    const [dark, light] = [paletteOf('dark'), paletteOf('light')]
    expect(dark.lawn).not.toBe(light.lawn)
    expect(dark.floor).not.toBe(dark.lawn)
  })

  it('кэширует палитру по ссылке на ThemeColors', () => {
    const colors = resolveThemeColors('dark', () => '').colors
    expect(scenePalette(colors)).toBe(scenePalette(colors))
  })
})

describe('mix / mute', () => {
  it('mix: концы диапазона и середина', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('mute: amount 1 даёт серый, 0 — исходный цвет', () => {
    expect(mute('#4a8f3c', 0)).toBe('#4a8f3c')
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(mute('#4a8f3c', 1)) ?? []
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
})
