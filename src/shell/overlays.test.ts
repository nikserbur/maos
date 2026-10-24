import { afterEach, describe, expect, it } from 'vitest'
import { handleEscape, pushEscapeLayer, resetEscapeLayersForTests, topEscapeLayer } from './overlays'

function esc(target: unknown = null, defaultPrevented = false) {
  const ev = { key: 'Escape', defaultPrevented, target, prevented: false, stopped: false,
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
  return ev as typeof ev & KeyboardEvent
}

describe('стек Esc — закрывается только самый внутренний слой', () => {
  afterEach(() => resetEscapeLayersForTests())

  it('палитра поверх MENTAT: первый Esc закрывает палитру, второй — MENTAT', () => {
    const closed: string[] = []
    pushEscapeLayer('mentat', () => closed.push('mentat'))
    const offPalette = pushEscapeLayer('palette', () => closed.push('palette'))
    const e1 = esc()
    expect(handleEscape(e1)).toBe(true)
    expect(closed).toEqual(['palette'])
    expect(e1.stopped).toBe(true)
    offPalette()
    handleEscape(esc())
    expect(closed).toEqual(['palette', 'mentat'])
  })

  it('ранг важнее порядка открытия: MENTAT, открытый после модалки, закрывается после неё', () => {
    pushEscapeLayer('modal', () => {})
    pushEscapeLayer('mentat', () => {})
    expect(topEscapeLayer()?.kind).toBe('modal')
    pushEscapeLayer('tip', () => {})
    expect(topEscapeLayer()?.kind).toBe('tip')
  })

  it('уже обработанное событие и пустой стек не трогаются', () => {
    let n = 0
    expect(handleEscape(esc())).toBe(false)
    pushEscapeLayer('panel', () => { n++ })
    expect(handleEscape(esc(null, true))).toBe(false)
    expect(n).toBe(0)
  })

  it('первый Esc в textarea только снимает фокус', () => {
    let closed = 0
    let blurred = 0
    pushEscapeLayer('mentat', () => { closed++ })
    expect(handleEscape(esc({ tagName: 'TEXTAREA', blur: () => { blurred++ } }))).toBe(true)
    expect(blurred).toBe(1)
    expect(closed).toBe(0)
    handleEscape(esc({ tagName: 'DIV' }))
    expect(closed).toBe(1)
  })
})
