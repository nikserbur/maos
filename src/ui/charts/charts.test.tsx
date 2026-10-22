/**
 * Рендер-тесты chart-системы без снапшотов: каждый график рендерится в статическую разметку
 * (react-dom/server, DOM не нужен), у тела есть role="img" + aria-label, есть таблица-двойник
 * и легенда при ≥ 2 рядов, сетка — без пунктира, пустые данные дают пустое состояние.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AreaChart, BarList, ColumnChart, Fan, Histogram, LineChart, Meter, Sankey, Scatter, Sparkline, StackBar } from './index'
import { num } from '../../explain/format'

const labels = ['01', '02', '03', '04']
const series = [
  { key: 'a', name: 'Загрузка', values: [10, 20, 15, 30] },
  { key: 'b', name: 'Очередь', values: [5, Number.NaN, 8, 12] },
]

const hasImgRole = (html: string) => /role="img"/.test(html) && /aria-label="[^"]+"/.test(html)

describe('cartesian charts', () => {
  it.each([['line', LineChart], ['area', AreaChart], ['column', ColumnChart]] as const)('%s renders axes, legend and table toggle', (_, Chart) => {
    const html = renderToStaticMarkup(<Chart labels={labels} series={series} title="Тест" fmtY={(v) => num(v, 0)} />)
    expect(hasImgRole(html)).toBe(true)
    expect(html).toContain('ch-legend')
    expect(html).toContain('Загрузка')
    expect(html).toContain('Таблица')
    expect(html).not.toContain('stroke-dasharray="2 4"')
    expect(html).toContain('class="ch-grid"')
  })

  it('omits the legend for a single series and shows the empty state without data', () => {
    const one = renderToStaticMarkup(<LineChart labels={labels} series={[series[0]]} />)
    expect(one).not.toContain('ch-legend')
    const empty = renderToStaticMarkup(<ColumnChart labels={[]} series={[]} emptyTitle="Нет данных" />)
    expect(empty).toContain('ch-empty')
    expect(empty).toContain('Нет данных')
  })

  it('formats tick labels through the formatter (no raw toFixed output)', () => {
    const html = renderToStaticMarkup(<LineChart labels={labels} series={[{ key: 'm', name: 'Деньги', values: [1_200_000, 2_400_000, 1_900_000, 3_100_000] }]} />)
    expect(html).toMatch(/млн/)
  })
})

describe('bar forms', () => {
  it('BarList renders a row per item and a value in text tokens', () => {
    const rows = [
      { key: 'x', label: 'Токарно-карусельный станок с ЧПУ', value: 0.52 },
      { key: 'y', label: 'Фрезерный', value: 0.26 },
    ]
    const html = renderToStaticMarkup(<BarList rows={rows} fmt={(v) => `${Math.round(v * 100)} %`} title="Загрузка" />)
    expect(hasImgRole(html)).toBe(true)
    expect((html.match(/class="ch-bar"/g) ?? []).length).toBe(2)
    expect(html).toContain('52 %')
  })

  it('StackBar lists every segment in the legend; Meter is bipolar when the range crosses zero', () => {
    const stack = renderToStaticMarkup(<StackBar segments={[{ key: 'a', label: 'A', value: 3 }, { key: 'b', label: 'B', value: 1 }]} fmt={(v) => String(v)} />)
    expect(stack).toContain('A · 3')
    expect(stack).toContain('B · 1')
    const meter = renderToStaticMarkup(<Meter value={-0.5} min={-1} max={1} label="skill −50 %" />)
    expect(meter).toContain('ch-meter__zero')
    expect(meter).toContain('aria-label="skill −50 %"')
  })
})

describe('histogram and scatter', () => {
  it('Histogram highlights the tail with the second colour and labels markers in text', () => {
    const bins = Array.from({ length: 6 }, (_, i) => ({ x0: i * 10, x1: i * 10 + 10, count: i + 1 }))
    const html = renderToStaticMarkup(<Histogram bins={bins} highlight={(b) => b.x1 <= 20} markers={[{ key: 'e', x: 35, label: 'E', glyph: '●' }]} />)
    expect(hasImgRole(html)).toBe(true)
    expect(html).toContain('var(--chart-4)')
    expect(html).toContain('● E')
    expect(html).toContain('ch-legend')
  })

  it('Scatter renders a hit area per point and a leader label for labelled points', () => {
    const pts = [
      { key: 'p1', x: 1, y: 2, label: 'выбрано', emphasis: 'selected' as const },
      { key: 'p2', x: 2, y: 1, emphasis: 'muted' as const },
    ]
    const html = renderToStaticMarkup(<Scatter points={pts} xLabel="риск" yLabel="прибыль" />)
    expect((html.match(/ch-dot__hit/g) ?? []).length).toBe(2)
    expect(html).toContain('выбрано')
    expect(html).toContain('ch-leader')
  })
})

describe('fan, sparkline, sankey', () => {
  it('Fan renders history, band, median and the month axis; empty forecast → empty state', () => {
    const a = { history: [10, 11, 12], p10: [11, 10, 9], p50: [12, 12.5, 13], p90: [13, 15, 17], trend: [12, 12.2, 12.4] }
    const html = renderToStaticMarkup(<Fan a={a} fmt={(v) => num(v, 1)} title="Изделие" backtestK={1} />)
    expect(hasImgRole(html)).toBe(true)
    expect(html).toContain('ch-fan__band')
    expect(html).toContain('ch-fan__hist')
    expect(html).toContain('сейчас')
    expect(html).toContain('+2 мес')
    expect(html).toContain('ch-fan__fact')
    const empty = renderToStaticMarkup(<Fan a={{ p10: [], p50: [], p90: [] }} />)
    expect(empty).toContain('ch-empty')
  })

  it('Sparkline draws a line with a marker and returns nothing for fewer than two points', () => {
    expect(renderToStaticMarkup(<Sparkline points={[1, 3, 2]} />)).toContain('ch-spark__line')
    expect(renderToStaticMarkup(<Sparkline points={[1]} />)).toBe('')
  })

  it('Sankey keeps full node labels and shows link values for the top-N links', () => {
    const nodes = [{ id: 'a', label: 'Ленточнопильный отрезной станок' }, { id: 'b', label: 'Токарный с ЧПУ' }, { id: 'c', label: 'Шлифовальный' }]
    const links = [{ from: 'a', to: 'b', value: 12 }, { from: 'b', to: 'c', value: 7 }]
    const html = renderToStaticMarkup(<Sankey nodes={nodes} links={links} topN={1} />)
    expect(html).toContain('Ленточнопильный')
    expect(html).toContain('ch-sankey__value')
    expect(html).toContain('>12<')
    expect(renderToStaticMarkup(<Sankey nodes={nodes.slice(0, 1)} links={[]} />)).toContain('ch-empty')
  })
})
