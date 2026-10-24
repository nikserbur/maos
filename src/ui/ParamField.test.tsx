/**
 * Карточка параметра (владелец: «■ вручную вернуть» — похоже на пустой флажок, «вернуть» — неизвестно
 * к чему; «вне диапазона −20–30» читается как «от −20 до −30»): изменённое — «✎ изменено · вернуть к
 * 0,50 (норматив)», предупреждение — «обычно от −20 до +30 %».
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NBSP } from '../explain/format'
import { ParamField, rangeText, revertText } from './ParamField'
import { TailStrip } from './kit'

const noop = () => {}

describe('ParamField — мета-строка и предупреждение словами', () => {
  it('изменённое: «✎ изменено», кнопка называет значение и источник, без ■', () => {
    const html = renderToStaticMarkup(
      <ParamField label="Связь цен между изделиями" value={0.7} provenance="manual" changed onRevert={noop} revertTo={0.5} revertSource="норматив" onChange={noop} />,
    )
    expect(html).toContain('✎')
    expect(html).toContain('изменено')
    expect(html).toContain('вернуть к 0,5 (норматив)')
    expect(html).not.toContain('■')
  })

  it('без исходного значения — «вернуть исходное», а не голое «вернуть»', () => {
    expect(revertText(undefined)).toBe('вернуть исходное')
    expect(revertText(undefined, '%', 'генератор')).toBe('вернуть исходное (генератор)')
    expect(revertText(12.68, '% г/г', 'генератор')).toBe(`вернуть к 12,68${NBSP}% г/г (генератор)`)
  })

  it('вне диапазона: границы со знаком и единицей («от −20 до +30 %»)', () => {
    expect(rangeText([-20, 30], '%')).toBe(`от −20 до +30${NBSP}%`)
    expect(rangeText([0.1, 3])).toBe('от 0,1 до 3')
    const html = renderToStaticMarkup(<ParamField label="Сдвиг курса доллара" value={-35} unit="%" range={[-20, 30]} onChange={noop} />)
    expect(html).toContain('обычно от −20')
    expect(html).toContain('до +30')
    expect(html).not.toContain('вне диапазона')
  })
})

describe('TailStrip — хвост риска словами', () => {
  it('без «дет.», «E[Cmax]», «CVaR»: средняя, средняя по 10 % худших, худший прогон', () => {
    const html = renderToStaticMarkup(<TailStrip det={377.6} mean={418.6} cvar={507} worst={684} alpha={0.1} />)
    expect(html).toContain('без сбоев')
    expect(html).toContain('средняя по 10')
    expect(html).toContain('худший прогон')
    expect(html).not.toMatch(/дет\.|E\[Cmax\]|CVaR/)
  })
})
