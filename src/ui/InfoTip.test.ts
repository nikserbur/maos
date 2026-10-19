import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InfoTip, MetricLabel } from './InfoTip'

// Среда node без DOM: проверяем закрытое состояние (разметку и ARIA) серверным рендером.
describe('InfoTip (closed state)', () => {
  it('renders a labelled dialog trigger without the popover', () => {
    const html = renderToStaticMarkup(createElement(InfoTip, { id: 'plan.makespan', values: { mean: 1123 } }))
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Как считается: Длина расписания"')
    expect(html).not.toContain('aria-controls')
    expect(html).not.toContain('role="dialog"')
  })

  it('accepts an accessible-name override', () => {
    const html = renderToStaticMarkup(createElement(InfoTip, { id: 'plan.otd', label: 'Формула OTD' }))
    expect(html).toContain('aria-label="Формула OTD"')
  })

  it('renders no interactive control for an unknown id', () => {
    const html = renderToStaticMarkup(createElement(InfoTip, { id: 'plan.does_not_exist' }))
    expect(html).not.toContain('<button')
  })

  it('MetricLabel renders the label text followed by the trigger', () => {
    const html = renderToStaticMarkup(createElement(MetricLabel, { id: 'plan.otd', children: 'OTD' }))
    expect(html).toMatch(/^<span class="metric-label">OTD<button/)
  })
})
