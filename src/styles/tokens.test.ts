/**
 * Роли цвета (X2 «у цвета одна работа»): акцент — только взаимодействие, данные (--chart-*) отделены
 * от акцента, бренд/блок [2] не совпадает с акцентом; категориальные слоты — в полосе светлоты и выше
 * порога хроматичности (те же пороги, что у валидатора dataviz). Читает tokens.css как текст.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

interface Oklch { l: number; c: number; h: number }

function block(selector: string): string {
  const at = css.indexOf(selector)
  if (at < 0) throw new Error(`нет блока ${selector}`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('\n}', open)
  return css.slice(open + 1, close)
}

function token(body: string, name: string): Oklch {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(body)
  if (!m) throw new Error(`нет литерала oklch у --${name}`)
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }
}

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const THEMES = [
  { name: 'dark', body: block(':root {'), band: [0.48, 0.67] as const },
  { name: 'light', body: block("[data-theme='light'] {"), band: [0.43, 0.77] as const },
]

describe.each(THEMES)('цветовые роли — $name', ({ body, band }) => {
  const accent = token(body, 'accent')

  it('--chart-1 отделён от --accent: |Δh| ≥ 30° или |ΔL| ≥ 0,12', () => {
    const c1 = token(body, 'chart-1')
    expect(hueGap(c1.h, accent.h) >= 30 || Math.abs(c1.l - accent.l) >= 0.12).toBe(true)
  })

  it('--ultramarine (бренд, блок [2]) не равен акценту и спокойнее его', () => {
    const u = token(body, 'ultramarine')
    expect(u.c).toBeLessThan(accent.c)
    expect(u.c).toBeGreaterThanOrEqual(0.12)
    expect(u.c).toBeLessThanOrEqual(0.16)
  })

  it('категориальные слоты 1–7 — в полосе светлоты и выше порога хроматичности', () => {
    for (let i = 1; i <= 7; i++) {
      const t = token(body, `chart-${i}`)
      expect(t.l, `chart-${i} L`).toBeGreaterThanOrEqual(band[0])
      expect(t.l, `chart-${i} L`).toBeLessThanOrEqual(band[1])
      expect(t.c, `chart-${i} C`).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('соседние слоты различаются по тону (≥ 25°) — без «двух синих» подряд', () => {
    for (let i = 1; i < 7; i++) {
      expect(hueGap(token(body, `chart-${i}`).h, token(body, `chart-${i + 1}`).h), `chart-${i}↔${i + 1}`).toBeGreaterThanOrEqual(25)
    }
  })
})

describe('блоки карты — идентичность, не слот графика', () => {
  it('--block-6 и --block-8 заданы своими литералами в обеих темах', () => {
    for (const { body } of THEMES) {
      expect(() => token(body, 'block-6')).not.toThrow()
      expect(() => token(body, 'block-8')).not.toThrow()
    }
  })
})
