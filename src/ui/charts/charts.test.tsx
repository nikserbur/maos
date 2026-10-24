/**
 * Рендер-тесты chart-системы без снапшотов: каждый график рендерится в статическую разметку
 * (react-dom/server, DOM не нужен), у тела есть role="img" + aria-label, есть таблица-двойник
 * и легенда при ≥ 2 рядов, сетка — без пунктира, пустые данные дают пустое состояние.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AreaChart, BarList, ColumnChart, DataTwin, Fan, Forest, Heatmap, Histogram, LineChart, Meter, RangeStrip, Sankey, Scatter, Sparkline, StackBar, fanLegend, fanTicks, heatStep } from './index'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    expect(html).toContain('Действия графика')
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

describe('G3c extensions', () => {
  it('LineChart draws a CI band, a dashed threshold series and annotations', () => {
    const html = renderToStaticMarkup(<LineChart labels={labels} endLabels
      series={[
        { key: 'a', name: 'цена', values: [10, 12, 11, 14], band: { lo: [9, 11, 10, 13], hi: [11, 13, 12, 15], label: 'ДИ' } },
        { key: 'b', name: 'порог', values: [12, 12, 12, 12], dashed: true },
      ]}
      annotations={[{ key: 'peak', index: 3, seriesKey: 'a', label: 'пик 14' }, { key: 'now', index: 1, kind: 'line', label: 'сейчас' }]}
      tipRows={() => []} />)
    expect(html).toContain('ch-band')
    expect(html).toContain('ch-line--dashed')
    expect(html).toContain('ДИ')
    expect(html).toContain('пик 14')
    expect(html).toContain('ch-vmark')
    expect(html).toContain('сейчас')
    expect(html).not.toContain('stroke-dasharray="2 4"')
  })

  it('Histogram renders the hatched tail, a dashed outline, lane markers and a bracket', () => {
    const bins = Array.from({ length: 6 }, (_, i) => ({ x0: i * 10, x1: i * 10 + 10, count: i + 1 }))
    const html = renderToStaticMarkup(<Histogram bins={bins} highlight={(b) => b.x1 <= 20}
      outline={{ shares: [0.1, 0.2, 0.3, 0.2, 0.1, 0.1], label: 'макс. E' }}
      markers={[{ key: 'var', x: 20, label: 'VaR = 20', kind: 'line' }, { key: 'e', x: 35, label: 'E', kind: 'dot' }, { key: 'w', x: 5, label: 'худший', kind: 'square' }]}
      bracket={{ from: 20, to: 50, label: 'E − CVaR = 30' }} xExtent={[-5, 60]} />)
    expect(html).toContain('ch-hist__hatch')
    expect(html).toContain('ch-hist__outline')
    expect(html).toContain('VaR = 20')
    expect(html).toContain('ch-hist__lanemark')
    expect(html).toContain('E − CVaR = 30')
    expect(html).toContain('макс. E')
  })

  it('Scatter renders triangle/square shapes and uses custom tooltip rows', () => {
    const pts = [
      { key: 'r', x: 1, y: 2, label: 'выбрано', emphasis: 'selected' as const, shape: 'triangle' as const, onFront: true },
      { key: 'm', x: 2, y: 3, label: 'макс. E', emphasis: 'alt' as const, shape: 'square' as const, onFront: true },
      { key: 'd', x: 3, y: 1, emphasis: 'muted' as const },
    ]
    const html = renderToStaticMarkup(<Scatter points={pts} frontArea legend={[{ key: 'a', label: 'фронт', color: 'var(--chart-1)' }, { key: 'b', label: 'выбрано', color: 'var(--chart-2)', swatchClass: 'pf-sw-tri' }]} />)
    expect(html).toContain('ch-dot--alt')
    expect(html).toContain('ch-front__area')
    expect((html.match(/<path class="ch-marker"/g) ?? []).length).toBe(2)
    expect(html).toContain('ch-swatch--custom')
  })

  it('Heatmap maps shares to 11 sequential steps and lists every cell in the table twin', () => {
    expect(heatStep(0)).toBe(0)
    expect(heatStep(0.05)).toBe(1)
    expect(heatStep(0.5)).toBe(5)
    expect(heatStep(1)).toBe(10)
    expect(heatStep(2)).toBe(10)
    const html = renderToStaticMarkup(<Heatmap rows={[{ key: 'm1', label: 'Токарный станок', values: [0, 0.5, 1] }]} columns={['0–1 ч', '1–2 ч', '2–3 ч']} />)
    expect(html).toContain('ch-heat__c--0')
    expect(html).toContain('ch-heat__c--5')
    expect(html).toContain('ch-heat__c--10')
    expect(html).toContain('Действия графика')
    expect(html).toContain('Токарный станок')
    expect(renderToStaticMarkup(<Heatmap rows={[]} columns={[]} />)).toContain('ch-empty')
  })

  it('RangeStrip places four glyph marks, a hatched zone and only the requested values', () => {
    const html = renderToStaticMarkup(<RangeStrip fmt={(v) => `${v} ч`} zone={[84, 175]}
      marks={[
        { key: 'det', value: 60, label: 'дет.', glyph: 'ring', tone: 'idle' },
        { key: 'mean', value: 69, label: 'E', glyph: 'dot', tone: 'accent' },
        { key: 'cvar', value: 84, label: 'CVaR', glyph: 'triangle', tone: 'warn', showValue: true },
        { key: 'worst', value: 175, label: 'худший', glyph: 'square', tone: 'danger', showValue: true },
      ]} />)
    expect(hasImgRole(html)).toBe(true)
    expect(html).toContain('ch-range__ring')
    expect(html).toContain('ch-range__dot')
    expect((html.match(/ch-range__shape/g) ?? []).length).toBe(2)
    expect(html).toContain('ch-range__hatch')
    expect((html.match(/ch-range__value/g) ?? []).length).toBe(2)
    expect(html).toContain('84 ч')
    expect(html).not.toContain('>60 ч<')
  })

  it('StackBar hatches a segment and shows glyph legend items; Meter supports the good tone', () => {
    const html = renderToStaticMarkup(<StackBar fmt={(v) => `${v} ч`} total="фонд 10 ч"
      segments={[{ key: 'b', label: 'обработка', value: 6, glyph: 'glyph-running' }, { key: 'd', label: 'ТО', value: 4, hatched: true, glyph: 'glyph-down' }]} />)
    expect(html).toContain('ch-swatch--glyph glyph-running')
    expect(html).toContain('ch-stack__hatch')
    expect(html).toContain('фонд 10 ч')
    expect(renderToStaticMarkup(<Meter value={0.9} tone="good" />)).toContain('ch-meter--good')
  })
})

describe('histogram window (domain)', () => {
  it('clips bins and the outline to the domain, marks mass beyond the edge and keeps every bin in the table', () => {
    const bins = Array.from({ length: 10 }, (_, i) => ({ x0: i * 10, x1: i * 10 + 10, count: i < 3 ? 10 : 0 }))
    const html = renderToStaticMarkup(<Histogram bins={bins} domain={[-5, 35]} fmtX={(v) => `${v}`}
      outline={{ shares: bins.map(() => 0.1), label: 'макс. E' }}
      markers={[{ key: 'a', x: 5, label: 'CVaR', kind: 'dot' }, { key: 'b', x: 7, label: 'E', kind: 'dot' }, { key: 'w', x: 3, label: 'худший', kind: 'square' }]} />)
    expect(html).toContain('ch-hist__beyond')
    expect(html).toContain('→ до 100')
    expect((html.match(/<g class="ch-col/g) ?? []).length).toBe(4)
    expect(html).toContain('Действия графика')
    expect((html.match(/ch-hist__lanemark/g) ?? []).length).toBe(3)
  })
})

describe('честные состояния (X2)', () => {
  it('loading с пустыми рядами — скелет, а не «пусто»', () => {
    const html = renderToStaticMarkup(<LineChart labels={[]} series={[]} loading emptyTitle="Нет данных" />)
    expect(html).not.toContain('ch-empty')
    expect(html).toContain('ch-skel')
    expect(html).toContain('aria-busy="true"')
  })
  it('пересчёт с данными — прежний кадр приглушён и подписан', () => {
    const html = renderToStaticMarkup(<LineChart labels={labels} series={series} loading title="Т" />)
    expect(html).toContain('is-refetching')
    expect(html).toContain('пересчитывается')
    expect(html).not.toContain('ch-skel')
  })
  it('после загрузки без данных — «пусто»', () => {
    expect(renderToStaticMarkup(<LineChart labels={[]} series={[]} emptyTitle="Нет данных" />)).toContain('ch-empty')
  })
})

describe('грамматика веера', () => {
  const fan = { p10: [8, 7, 6], p50: [10, 10, 10], p90: [12, 13, 14], p25: [9, 9, 8], p75: [11, 11, 12], history: [9, 10, 11, 10], trend: [10, 10.5, 11] }
  it('легенда называет каждый элемент словами: коридоры с покрытием, без кодов P10/P50 и без глифа в тексте', () => {
    const labelsOf = fanLegend({ hasHistory: true, hasTrend: true, hasInner: true, backtestK: 2 }).map((i) => i.label)
    expect(labelsOf).toEqual(expect.arrayContaining(['медиана', 'коридор: 5 из 10 исходов', 'коридор: 8 из 10 исходов', 'факт проверки', 'окно проверки 2 мес', 'тренд', 'история (факт)']))
    expect(labelsOf.join(' ')).not.toMatch(/P\d0|◆/)
    expect(labelsOf.some((l) => l.includes('штриховка'))).toBe(false)
  })
  it('штриховка в легенде — если хоть одна карточка заштрихована (качество warn/bad)', () => {
    expect(fanLegend({ hatched: true }).map((i) => i.label)).toContain('штриховка — коридору доверять осторожно')
    const html = renderToStaticMarkup(<Fan a={fan} quality="warn" title="В" />)
    expect(html).toContain('штриховка — коридору доверять осторожно')
  })
  it('общая шкала уже данных: марки обрезаны рамкой плота, выход за край подписан «↑ до …»', () => {
    const html = renderToStaticMarkup(<Fan a={fan} yDomain={[5, 12]} fmt={(v) => num(v, 0)} title="В" />)
    expect(html).toMatch(/<clipPath id="[^"]+"><rect/)
    expect(html).toMatch(/class="ch-fan__marks" clip-path="url\(#[^)]+\)"/)
    expect(html).toContain('ch-fan__over')
    expect(html).toContain('↑ до 14')
    const inside = renderToStaticMarkup(<Fan a={fan} yDomain={[0, 20]} title="В" />)
    expect(inside).not.toContain('ch-fan__over')
  })
  it('ось Y — не меньше трёх делений', () => {
    expect(fanTicks(0, 1).length).toBeGreaterThanOrEqual(3)
    expect(fanTicks(10, 10.4).length).toBeGreaterThanOrEqual(3)
  })
  it('общая шкала yDomain задаёт деления, порог подписан в легенде и таблице', () => {
    const html = renderToStaticMarkup(<Fan a={fan} backtestK={2} yDomain={[0, 100]} refLines={[{ key: 'lim', value: 50, label: 'лимит' }]} title="В" />)
    expect(html).toContain('>100<')
    expect(html).toContain('>0<')
    expect(html).toContain('ch-fan__ref')
    expect(html).toContain('лимит')
  })
  it('в CSS веера нет --chart-2 у окна проверки и факта', () => {
    const css = readFileSync(fileURLToPath(new URL('./charts.css', import.meta.url)), 'utf8')
    const rule = (sel: string) => css.split('\n').filter((l) => l.startsWith(sel)).join('\n')
    expect(rule('.ch-fan__bt')).not.toContain('--chart-2')
    expect(rule('.ch-fan__fact')).not.toContain('--chart-2')
    expect(css).not.toContain('var(--accent)')
  })
})

describe('примитивы вердикта (P-19)', () => {
  it('RangeStrip: ДИ — без штриховки, хвост — со штриховкой', () => {
    const marks = [{ key: 'e', value: 5, label: 'E', glyph: 'dot' as const, tone: 'accent' as const }]
    const ci = renderToStaticMarkup(<RangeStrip marks={marks} fmt={(v) => num(v, 0)} zone={[3, 7]} zoneKind="ci" domain={[0, 10]} />)
    const tail = renderToStaticMarkup(<RangeStrip marks={marks} fmt={(v) => num(v, 0)} zone={[3, 7]} />)
    expect(ci).toContain('ch-range__zone--ci')
    expect(ci.slice(ci.indexOf('ch-range__zone'))).not.toMatch(/fill="url\(#/)
    expect(tail).toMatch(/fill="url\(#/)
  })
  it('Forest: подписанная нулевая линия, порог, доля побед и таблица-двойник', () => {
    const html = renderToStaticMarkup(<Forest rows={[{ key: 'a', label: 'Вариант A', delta: 1.2, lo: 0.4, hi: 2, share: 0.62 }, { key: 'b', label: 'Вариант B', delta: -0.1, lo: -0.6, hi: 0.5 }]}
      fmt={(v) => num(v, 1)} threshold={{ value: 1, label: 'порог' }} baseLabel="к CR" title="Сравнение" />)
    expect(html).toContain('ch-forest__zero')
    expect(html).toContain('0 — как база')
    expect(html).toContain('ch-forest__thr')
    expect(html).toContain('62 из 100')
    expect(html).toContain('Действия графика')
  })
  it('BarList: переход «откуда → куда» — двумя строками; подпись без многоточия и обрезки', () => {
    const html = renderToStaticMarkup(<BarList rows={[{ key: 'a', label: 'Токарный с ЧПУ → Фрезерный обрабатывающий центр', value: 12 }]} fmt={(v) => num(v, 0)} />)
    expect(html).toContain('<span class="ch-bar__from">Токарный с ЧПУ</span><span class="ch-bar__to">→ Фрезерный обрабатывающий центр</span>')
    const css = readFileSync(fileURLToPath(new URL('./charts.css', import.meta.url)), 'utf8')
    const name = css.slice(css.indexOf('.ch-bar__name {'), css.indexOf('}', css.indexOf('.ch-bar__name {')))
    expect(name).not.toMatch(/line-clamp|ellipsis|overflow: hidden/)
  })
  it('Heatmap: много подписанных столбцов — номера на оси, ключ с полными именами, тот же номер у строки', () => {
    const cols = ['Токарный', 'Фрезерный', 'Сверлильный', 'Шлифовальный', 'Сварочный', 'Покрасочный', 'Сборка', 'Контроль']
    const html = renderToStaticMarkup(<Heatmap rows={[{ key: 'f', label: 'Фрезерный', values: cols.map(() => 0.3) }]} columns={cols} axis={cols} />)
    expect(html).toContain('ch-heat__axis--numbered')
    expect(html).toContain('ch-heat__key')
    expect(html).toContain('<span class="ch-heat__no">2</span>Фрезерный')
    const few = renderToStaticMarkup(<Heatmap rows={[{ key: 'f', label: 'А', values: [0.1, 0.2] }]} columns={['а', 'б']} axis={['а', 'б']} />)
    expect(few).not.toContain('ch-heat__key')
  })
  it('BarList: отметка цели на дорожке и в легенде, «Все N» при лимите', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ key: String(i), label: `Станок ${i}`, value: i * 10 }))
    const html = renderToStaticMarkup(<BarList rows={rows} fmt={(v) => num(v, 0)} mark={{ value: 30, label: 'цель' }} limit={4} />)
    expect(html).toContain('ch-bar__mark')
    expect(html).toContain('цель')
    expect(html).toContain('Все 6')
    expect((html.match(/class="ch-bar(?: |")/g) ?? []).length).toBe(4)
  })
  it('Sankey: длинные подписи — до трёх строк без многоточия, прочие ленты приглушены', () => {
    const nodes = [{ id: 'a', label: 'Токарно-винторезный участок номер один с длинным именем цеха' }, { id: 'b', label: 'Сборка' }, { id: 'c', label: 'Склад' }]
    const html = renderToStaticMarkup(<Sankey nodes={nodes} links={[{ from: 'a', to: 'b', value: 5 }, { from: 'b', to: 'c', value: 3 }]} emphasis={['a']} ariaLabel="Потоки партий" />)
    expect(html).not.toContain('…')
    expect(html).toContain('is-other')
    expect(html).toContain('Потоки партий')
  })
})

describe('шапка рамки (владелец: «надписи странно отрисовались»)', () => {
  const a = { history: [10, 11, 12], p10: [11, 10, 9], p50: [12, 12.5, 13], p90: [13, 15, 17] }
  it('заголовок и действия — в первой строке, бейджи и предупреждение — в мета-строке на всю ширину', () => {
    const html = renderToStaticMarkup(<Fan a={a} title="Пруток нержавеющий" badges={<span>+8,6 %</span>} subtitle="веер не откалиброван" />)
    const top = html.slice(html.indexOf('ch-head__top'), html.indexOf('ch-head__meta'))
    expect(top).toContain('Пруток нержавеющий')
    expect(top).toContain('Действия графика')
    expect(top).not.toContain('+8,6 %')
    const meta = html.slice(html.indexOf('ch-head__meta'), html.indexOf('ch-body'))
    expect(meta).toContain('+8,6 %')
    expect(meta).toContain('веер не откалиброван')
  })

  it('малые кратные — без «⋯»; заголовок-действие — кнопка и видимая иконка «Открыть веер»; ось месяцев — через XAxis', () => {
    const html = renderToStaticMarkup(<Fan a={a} title="Ряд" variant="multiple" onTitleClick={() => {}} titleActionLabel="Открыть веер" />)
    expect(html).not.toContain('Действия графика')
    expect(html).toContain('class="ch-title-btn"')
    expect(html).toContain('aria-label="Открыть веер"')
    expect(html).toContain('ch-frame--clickable')
    expect(html).toContain('ch-axis--x')
  })

  it('мета — колонкой: строка бейджей, под ней подзаголовок во всю ширину', () => {
    const html = renderToStaticMarkup(<Fan a={a} title="Ставка" badges={<span>14 % → 13 %</span>} subtitle="проверено на отложенных данных" />)
    const meta = html.slice(html.indexOf('ch-head__meta'), html.indexOf('ch-body'))
    expect(meta.indexOf('ch-head__badges')).toBeGreaterThan(-1)
    expect(meta.indexOf('ch-head__badges')).toBeLessThan(meta.indexOf('ch-sub'))
    const css = readFileSync(fileURLToPath(new URL('./charts.css', import.meta.url)), 'utf8')
    const rule = css.slice(css.indexOf('.ch-head__meta {'), css.indexOf('}', css.indexOf('.ch-head__meta {')))
    expect(rule).toContain('flex-direction: column')
    expect(css).toMatch(/\.ch-actions \.btn--icon \{ width: 28px; height: 28px/)
    expect(css).toContain('grid-template-rows: subgrid')
  })

  it('подписи осей Scatter не обрезаются: Y — от левого края над делениями, X — строкой под делениями', () => {
    const pts = [{ key: 'a', x: 1e8, y: 2e8 }, { key: 'b', x: 5e8, y: 4e8 }]
    const html = renderToStaticMarkup(<Scatter points={pts} xLabel="риск (разброс прибыли), ₽" yLabel="ожидаемая прибыль, ₽ ↑" height={260} />)
    const yUnit = html.match(/<text x="(-?[\d.]+)" y="([\d.]+)" text-anchor="(\w+)" class="ch-tick ch-tick--unit">ожидаемая/)
    expect(yUnit?.[1]).toBe('0')
    expect(yUnit?.[3]).toBe('start')
    const xTitle = html.match(/<text class="ch-tick ch-tick--unit" x="[\d.]+" y="([\d.]+)"[^>]*>риск/)
    const tickYs = [...html.matchAll(/<text x="[\d.]+" y="([\d.]+)" text-anchor="middle" class="ch-tick"/g)].map((m) => Number(m[1]))
    expect(tickYs.length).toBeGreaterThan(0)
    expect(Number(xTitle?.[1])).toBeGreaterThanOrEqual(Math.max(...tickYs) + 20)
    expect(Number(xTitle?.[1])).toBeLessThanOrEqual(260)
  })

  it('таблица-двойник — на классах таблицы кита, первая колонка всегда с заголовком', () => {
    const html = renderToStaticMarkup(<DataTwin table={{ columns: ['', 'Значение'], rows: [['Токарный', '52 %']] }} />)
    expect(html).toContain('dk-table')
    expect(html).toContain('dk-col-primary')
    expect(html).toContain('Показатель')
  })
})
