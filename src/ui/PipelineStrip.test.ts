/**
 * Полоса методологии (владелец: «надписи странно отрисовались» — «Распредел◐Внутр◐ние»,
 * «Базовыйпортфель 17:3бплан»): ячейка шириной по подписи, вторая строка не раздвигает ячейку,
 * ступени по ширине полосы; ссылка ячейки текущего экрана — на ту же вкладку, что и вкладка экрана.
 * Раскладку без браузера проверить нельзя — проверяются правила CSS, от которых она зависит.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cellLink } from './PipelineStrip'

const css = readFileSync(fileURLToPath(new URL('./pipeline.css', import.meta.url)), 'utf8')
const ruleOf = (sel: string) => {
  const at = css.indexOf(`\n${sel} {`)
  return at < 0 ? '' : css.slice(at + 1, css.indexOf('}', at))
}

describe('cellLink — то же слово ведёт в то же место', () => {
  it('«Условия» на «Сценариях» — вкладка «Условия» открытого сценария, а не карта', () => {
    expect(cellLink('external', true, { screenId: 'scenarios', anchor: '7/distributions' })).toEqual({ href: '#/scenarios/7/conditions', tab: true })
    expect(cellLink('distributions', true, { screenId: 'scenarios', anchor: 'forecast' })).toEqual({ href: '#/scenarios/distributions', tab: true })
    expect(cellLink('external', true, { screenId: 'scenarios', anchor: 'compare/1,2' })).toEqual({ href: '#/scenarios/conditions', tab: true })
  })

  it('блок текущего экрана без своей вкладки — узел карты; чужой блок — экран-владелец; MENTAT — действие', () => {
    expect(cellLink('criteria', true, { screenId: 'scenarios', anchor: null })).toEqual({ href: '#/map/criteria', tab: false })
    expect(cellLink('external', true, { screenId: 'monitoring', anchor: null })).toEqual({ href: '#/map/external', tab: false })
    expect(cellLink('decisions', false, { screenId: 'scenarios', anchor: null })).toEqual({ href: '#/optimization', tab: false })
    expect(cellLink('llm', false, { screenId: 'plan', anchor: null })).toEqual({ href: null, tab: false })
  })
})

describe('раскладка полосы — подписи не наезжают', () => {
  it('ячейка — по содержимому (не равные доли с min-width: 0), имя не сжимается', () => {
    expect(ruleOf('.pstrip__cell')).toContain('flex: 1 0 auto')
    expect(ruleOf('.pstrip__cell')).not.toContain('min-width: 0')
    expect(ruleOf('.pstrip__text')).toContain('min-width: max-content')
    expect(ruleOf('.pstrip__name')).toContain('white-space: nowrap')
  })

  it('вторая строка не раздвигает ячейку и не обрезается многоточием', () => {
    const badge = ruleOf('.pstrip__badge')
    expect(badge).toContain('contain: inline-size')
    expect(badge).not.toContain('ellipsis')
  })

  it('ступени по ширине полосы: родословная прячется, у обычных ячеек остаются номер и глиф, последняя мера — прокрутка', () => {
    expect(css).toMatch(/@container pstrip \(max-width: 1240px\) \{ \.pstrip__lineage \{ display: none; \} \}/)
    expect(css).toMatch(/@container pstrip \(max-width: 1100px\)[\s\S]*?\.pstrip__text \{\s*position: absolute/)
    expect(ruleOf('.pstrip__cells')).toContain('overflow-x: auto')
  })

  it('родословная: части не сжимаются друг на друга, выпадающий список не обрезается', () => {
    expect(ruleOf('.pstrip__lin')).not.toContain('min-width: 0')
    expect(ruleOf('.pstrip__lineage')).not.toContain('overflow: hidden')
    expect(ruleOf('.pstrip__lineage')).toContain('flex: 0 1000 auto')
  })

  it('текущий блок — подчёркивание цветом блока без второй подсвеченной «полосы вкладок»', () => {
    expect(css).not.toMatch(/\.is-current \.pstrip__link \{[^}]*background/)
  })
})
