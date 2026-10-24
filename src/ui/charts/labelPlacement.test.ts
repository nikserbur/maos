/**
 * Подписи внутри графиков не обрезаются рамкой SVG и не ложатся друг на друга: вертикальные
 * отметки (L_min, «решения нет»), подписи нулевой линии и порога Forest, подсказка в малых кратных.
 */
import { describe, expect, it } from 'vitest'
import { placeVmarkLabels } from './Cartesian'
import { axisLabels } from './Forest'
import { tipLeft, tipWidth } from './Tooltip'

describe('вертикальные отметки', () => {
  it('у правого края подпись уходит влево; близкие отметки — разными строками', () => {
    const xAt = (i: number) => 40 + i * 10
    const m = placeVmarkLabels([
      { key: 'a', index: 10, label: 'L_min 1,2 млн', kind: 'line' },
      { key: 'b', index: 11, label: 'решения нет', kind: 'line' },
      { key: 'c', index: 29, label: 'конец горизонта', kind: 'line' },
    ], xAt, 40, 340)
    expect(m.get('a')?.row).not.toBe(m.get('b')?.row)
    expect(m.get('c')?.anchor).toBe('end')
    const c = m.get('c')
    expect(c && c.x - c.text.length * 6.4).toBeGreaterThanOrEqual(40)
  })
})

describe('подписи Forest', () => {
  it('у края дорожки прижимаются внутрь; при наезде порог уходит строкой выше', () => {
    const x = (v: number) => 8 + v * 224
    const [zero] = axisLabels(x, 240, '0 — как база')
    expect(zero.anchor).toBe('start')
    const [, thr] = axisLabels(x, 240, '0 — как база', { value: 0.1, label: 'порог' })
    expect(thr.row).toBe(1)
    const [, far] = axisLabels(x, 240, '0 — как база', { value: 0.9, label: 'порог' })
    expect(far.row).toBe(0)
  })
})

describe('подсказка', () => {
  it('в узком графике — уже 212 px; не помещается справа — слева; нигде — прижата к краю, а не к нулю', () => {
    expect(tipWidth(900)).toBe(212)
    expect(tipWidth(315)).toBe(151)
    expect(tipLeft(50, 900, 212)).toBe(62)
    expect(tipLeft(850, 900, 212)).toBe(850 - 12 - 212)
    const w = tipWidth(200)
    const l = tipLeft(100, 200, w)
    expect(l).toBeGreaterThanOrEqual(0)
    expect(l + w).toBeLessThanOrEqual(200)
  })
})
