import { describe, expect, it } from 'vitest'
import { TICK_CHAR_W, TICK_GAP, overlaps, placeXLabels } from './axisLayout'

const noOverlap = (placed: ReturnType<typeof placeXLabels>) => {
  for (let k = 1; k < placed.length; k++) expect(overlaps(placed[k - 1], placed[k])).toBe(false)
}

describe('placeXLabels', () => {
  const dense = ['07-06 10:03', '07-19 10:51', '08-02 09:12', '09-15 14:40', '10-20 12:37', '10-21 08:00', '10-22 09:30', '10-22 12:11', '10-22 18:35', '10-22 19:46']
  const evenXs = (n: number, x0: number, x1: number) => Array.from({ length: n }, (_, i) => x0 + (i / (n - 1)) * (x1 - x0))

  it('плотные даты в узком плоте: ни одна пара подписей не пересекается', () => {
    const placed = placeXLabels(dense, evenXs(10, 40, 360), 40, 360)
    noOverlap(placed)
    expect(placed.length).toBeGreaterThanOrEqual(2)
  })

  it('первая и последняя подписи сохраняются всегда и лежат внутри плота', () => {
    const placed = placeXLabels(dense, evenXs(10, 40, 360), 40, 360)
    expect(placed[0].i).toBe(0)
    expect(placed[placed.length - 1].i).toBe(9)
    for (const p of placed) {
      expect(p.tx - p.half).toBeGreaterThanOrEqual(40 - 1e-9)
      expect(p.tx + p.half).toBeLessThanOrEqual(360 + 1e-9)
    }
  })

  it('последняя подпись не налезает на предыдущую (случай «10-22 18:35-22 19:46»)', () => {
    const placed = placeXLabels(dense, evenXs(10, 40, 360), 40, 360, TICK_CHAR_W, TICK_GAP, 4)
    noOverlap(placed)
    const idx = placed.map((p) => p.i)
    expect(idx).toContain(9)
    expect(idx).not.toContain(8)
  })

  it('редкие подписи в широком плоте остаются все', () => {
    const labels = ['янв', 'фев', 'мар', 'апр', 'май']
    const placed = placeXLabels(labels, evenXs(5, 0, 800), 0, 800)
    expect(placed.map((p) => p.i)).toEqual([0, 1, 2, 3, 4])
    noOverlap(placed)
  })

  it('при большом числе пропусков шаг равномерный', () => {
    const labels = Array.from({ length: 20 }, (_, i) => `10-${String(i + 1).padStart(2, '0')} 12:00`)
    const placed = placeXLabels(labels, evenXs(20, 0, 500), 0, 500)
    noOverlap(placed)
    const inner = placed.slice(0, -1).map((p) => p.i)
    const gaps = inner.slice(1).map((v, k) => v - inner[k])
    expect(new Set(gaps).size).toBe(1)
  })

  it('«сейчас» не пропадает в узкой карточке (плот 240 px): уступает крайняя подпись', () => {
    // Веер 3 колонки при 1440: 24 мес истории + 12 мес прогноза, подписи — начало · сейчас · горизонт.
    const labels = ['окт. 2024', 'сейчас · сент. 2026', 'окт. 2027']
    const x0 = 40
    const x1 = 280
    const xs = [x0, x0 + (24 / 36) * (x1 - x0), x1]
    const plain = placeXLabels(labels, xs, x0, x1).map((p) => p.i)
    expect(plain).not.toContain(1)
    const kept = placeXLabels(labels, xs, x0, x1, TICK_CHAR_W, TICK_GAP, 1, [1])
    expect(kept.map((p) => p.i)).toContain(1)
    noOverlap(kept)
    for (const p of kept) {
      expect(p.tx - p.half).toBeGreaterThanOrEqual(x0 - 1e-9)
      expect(p.tx + p.half).toBeLessThanOrEqual(x1 + 1e-9)
    }
  })

  it('обязательная подпись не мешает остальным, если места хватает', () => {
    const labels = ['янв', 'сейчас', 'дек']
    const placed = placeXLabels(labels, [0, 400, 800], 0, 800, TICK_CHAR_W, TICK_GAP, 1, [1])
    expect(placed.map((p) => p.i)).toEqual([0, 1, 2])
  })

  it('пустой и одиночный ряд', () => {
    expect(placeXLabels([], [], 0, 100)).toEqual([])
    const one = placeXLabels(['x'], [50], 0, 100)
    expect(one).toHaveLength(1)
    expect(one[0].i).toBe(0)
  })

  it('ширина подписи зависит от ширины символа', () => {
    const wide = placeXLabels(['abcdef', 'ghijkl'], [10, 60], 0, 100, 12, 4)
    const narrow = placeXLabels(['abcdef', 'ghijkl'], [10, 60], 0, 100, 4, 4)
    expect(wide[0].half).toBeGreaterThan(narrow[0].half)
  })
})
