/**
 * Дымовые проверки разметки «Сценариев» (SSR): шапка с одним главным действием и сводкой критерия,
 * «Условия» без внутренностей движка, сравнение с Δ и «○ по умолчанию», распределения таблицей.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PriceScenario, Product } from '../../lib/api'
import { NBSP } from '../../explain/format'
import { ConditionsTab } from './ConditionsTab'
import { DistributionsTab } from './DistributionsTab'
import { ScenarioCompare } from './ScenarioCompare'
import { ScenarioHeader } from './ScenarioHeader'

const sc = (id: string, over: Partial<PriceScenario> = {}): PriceScenario => ({ id, name: `Сценарий ${id}`, description: '', horizon_hours: '720', created_at: '', ...over })
const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, code: `A-${id}`, name: `Вал ${id}, сталь`, unit: 'шт', parent_id: '', qty_in_parent: '1', batch_size: '10',
  stock: '0', purchased: '0', created_at: '', sellable: '1', base_cost: '500', base_price: '1000', demand_max: '100', ...over,
})
const noop = () => {}
const filled = (html: string) => (html.match(/btn--primary/g) ?? []).length

describe('шапка сценария', () => {
  it('одно главное действие — следующий шаг; незаданная доля — «≤ 60 %»', () => {
    const html = renderToStaticMarkup(
      <ScenarioHeader sc={sc('1')} tab="conditions" regimes={null} isWorking={false} onPatch={noop} onMakeWorking={noop}
        onFindPortfolio={noop} onBuildPlan={noop} onClone={noop} onRemove={noop} />,
    )
    expect(filled(html)).toBe(1)
    expect(html).toContain('Найти робастный портфель →')
    expect(html).toContain('Сделать рабочим')
    expect(html).toContain(`≤ <span class="num">60${NBSP}%</span>`)
    expect(html).toContain('▲ без даты')
  })
})

describe('вкладка «Условия»', () => {
  it('без кодов паспорта и легаси-ползунков; ρ 0,25 — «вручную»', () => {
    const html = renderToStaticMarkup(<ConditionsTab sc={sc('1', { market_corr: '0.25' })} regimes={null} macro={null} onPatch={noop} />)
    expect(html).not.toMatch(/macro\.ref_key|\(14\.0\)|Устаревшие параметры|btn--primary/)
    expect(html).toContain('data-key="manual"')
    expect(html).toContain('Режим генератора')
  })
})

describe('сравнение', () => {
  it('пустое — подсказка; два сценария — Δ к базе и «○ по умолчанию», одна главная кнопка', () => {
    const empty = renderToStaticMarkup(<ScenarioCompare scenarios={[sc('1')]} ids={['1']} workingId="1" products={[]} regimeNames={[]} onMakeWorking={noop} onDrop={noop} />)
    expect(empty).toContain('Отметьте 2–5 сценариев')
    const html = renderToStaticMarkup(
      <ScenarioCompare scenarios={[sc('1'), sc('2', { market_corr: '0.25', objective: 'meanvariance' })]} ids={['2', '1']} workingId="1"
        products={[]} regimeNames={[]} onMakeWorking={noop} onDrop={noop} />,
    )
    expect(filled(html)).toBe(1)
    expect(html).not.toContain('meanvariance')
    expect(html).toContain('dk-delta')
    expect(html).toContain('○ по умолчанию')
    expect(html.indexOf('Сценарий 1')).toBeLessThan(html.indexOf('Сценарий 2'))
  })
})

describe('распределения', () => {
  it('группы, счётчик «вручную · по умолчанию», корреляция одной строкой при равных β', () => {
    const html = renderToStaticMarkup(
      <DistributionsTab sc={sc('1')} products={[product('1'), product('2'), product('3', { purchased: '1', sellable: '0' })]} productsFailed={false}
        onSetDist={async () => {}} onSetDists={async () => {}} />,
    )
    expect(html).toContain('Изделия (сбыт) · 2')
    expect(html).toContain('Сырьё · 1')
    expect(html).toContain('0 вручную · 3 по умолчанию')
    expect(html).toContain('для всех пар')
    expect(html).not.toContain('Происхождение')
    expect(html).not.toMatch(/ts_data|R7|R20|по AIC|для UI/)
  })
})
