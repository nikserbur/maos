/**
 * Дымовые проверки «Мониторинга» и общих частей прогноза (SSR): нет «0» там, где «не рассчитано»;
 * у ненадёжного веера — ▲, а не зелёная точка; таблица рядов сгруппирована и открывает веер.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ForecastProduct, ForecastResult } from '../../lib/api'
import { ForecastFan, ForecastTable } from './ForecastGrid'
import { Exceptions, KpiStrip, buildExceptions, type PlanFacts } from './MonitorParts'

const bt = (skill: number, coverage80: number) => ({ k: 6, mape: 10, mape_naive: 10, skill, pinball10: 1, pinball90: 1, coverage80 })
const prod = (id: string, over: Partial<ForecastProduct> = {}): ForecastProduct => ({
  id, name: `Ряд ${id}`, role: 'product', base: 100, p10: [100, 90], p50: [100, 130], p90: [100, 150], mean: [100, 130], history: [95, 100], ...over,
})
const res = (products: ForecastProduct[]): ForecastResult => ({
  months: 1, inflation_monthly: 0, fx: 1, demand: 1, volatility: 0.05, corr: 0.5, inflation_index: [100, 101], products,
  synthetic: true, demo: true, deprecated_fields: [], macro: { available: true, error: '' },
})
const NONE: PlanFacts = { planNo: null, otd: null, bottleneck: null, cashGap: null }

describe('Мониторинг', () => {
  it('без плана и кассы — «не рассчитано», а не ноль', () => {
    const html = renderToStaticMarkup(<KpiStrip res={res([prod('a', { backtest: bt(2, 0.4) })])} plan={NONE} />)
    expect(html.match(/не рассчитано/g)?.length).toBe(3)
    expect(html).toContain('1<span class="unit">из 1</span>')
  })

  it('исключения по важности ведут в веер или «План»', () => {
    const exc = buildExceptions(res([prod('a', { backtest: bt(2, 0.3) })]), { ...NONE, cashGap: { p: 0.2, ci: null }, otd: 0.85 }, '#/scenarios/1/forecast')
    expect(exc.crit.map((e) => e.key)).toEqual(['cash'])
    expect(exc.warn.map((e) => e.key)).toEqual(['otd', 'cal', 'mv-a'])
    const html = renderToStaticMarkup(<Exceptions crit={exc.crit} warn={exc.warn} onOpen={() => {}} />)
    expect(html).toContain('Требует решения · 1')
    expect(html).toContain('href="#/plan"')
  })
})

describe('веер и таблица рядов', () => {
  it('покрытие 50 % — ▲ и фраза частотой, без зелёной точки', () => {
    const html = renderToStaticMarkup(<ForecastFan p={prod('a', { backtest: bt(0.6, 0.5) })} />)
    expect(html).toContain('fc-q--warn')
    expect(html).toContain('▲')
    expect(html).toContain('внутри полосы 3 из 6 мес')
    expect(html).not.toContain('glyph-running')
  })

  it('таблица: группы по роли, Δ от «сейчас», «открыть веер»', () => {
    const html = renderToStaticMarkup(<ForecastTable products={[prod('a'), prod('r', { role: 'raw' })]} onOpen={() => {}} caption="ряды" />)
    expect(html).toContain('Изделия (цены сбыта) · 1')
    expect(html).toContain('Сырьё (закупочные цены) · 1')
    expect(html).toContain('открыть веер')
  })
})
