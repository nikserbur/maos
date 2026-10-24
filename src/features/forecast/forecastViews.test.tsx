/**
 * Дымовые проверки «Мониторинга» и общих частей прогноза (SSR): нет «0» там, где «не рассчитано»;
 * сигналы — карточки с глифом важности и настоящими кнопками, а не подчёркнутые ссылки; сбой ставки
 * не роняет «Внешние условия»; у ненадёжного веера — ▲; таблица — имя полностью и шеврон строки.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ForecastProduct } from '../../lib/api'
import { ForecastFan, ForecastTable } from './ForecastGrid'
import { MacroFans } from './MacroFans'
import { AlertList, MissingChip } from './MonitorAlerts'
import { KpiRow, StatusHeadline } from './MonitorHeadline'
import { monitorStatus } from './monitorModel'
import { NO_PLAN, buildSignals } from './monitorSignals'

const bt = (skill: number, coverage80: number) => ({ k: 6, mape: 10, mape_naive: 10, skill, pinball10: 1, pinball90: 1, coverage80 })
const prod = (id: string, over: Partial<ForecastProduct> = {}): ForecastProduct => ({
  id, name: `Ряд ${id}`, role: 'product', base: 100, p10: [100, 90], p50: [100, 130], p90: [100, 150], mean: [100, 130], history: [95, 100], ...over,
})

describe('Мониторинг', () => {
  it('без плана и кассы — «—» и кнопки, а не ноль', () => {
    const html = renderToStaticMarkup(<KpiRow goods={null} raw={null} by="к марту 2027" plan={NO_PLAN} loading={false} failed />)
    expect(html).toContain('Построить план')
    expect(html).toContain('прогноз не рассчитан')
    expect(html).not.toMatch(/>0<span class="unit">/)
    expect(html).toContain('Заказы в срок')
  })

  it('сигналы — карточки с глифом и словом важности, кнопки и ссылки на раздел плана', () => {
    const signals = buildSignals({
      res: null, forecastFailed: true, rateFailed: false, scenario: { id: 's1', name: 'Базовый' },
      plan: { ...NO_PLAN, planNo: '12', planKey: '12', otd: 0.7, cashGap: { p: 0.2, ci: null } },
      hrefs: { forecast: '#/scenarios/s1/forecast', conditions: '#/scenarios/s1/conditions' }, by: 'к марту 2027',
      generatorCpi: null, forecastAt: null, cbrLast: null, today: null,
    })
    const html = renderToStaticMarkup(<AlertList signals={signals} onAction={() => {}} />)
    expect(html).toContain('mon-alert--crit')
    expect(html).toContain('требует решения')
    expect(html).toContain('href="#/plan/run/12/cash"')
    expect(html).toContain('href="#/plan/run/12"')
    // «Не рассчитано» — не карточка, а строка после карточек с действием.
    expect(html).toContain('mon-missing')
    expect(html).toContain('<button type="button" class="mon-missing__act">Повторить</button>')
    expect(html).not.toContain('mon-alert--missing')
    expect(html).not.toContain('pf-link')
    const head = renderToStaticMarkup(
      <StatusHeadline status={monitorStatus(signals)} answer="Ответ." trust={null} missing={<MissingChip signals={signals} onAction={() => {}} />} />,
    )
    expect(head).toContain('Требует решения')
    expect(head).toContain('mon-status--crit')
    expect(head).toContain('Не рассчитано: прогноз цен')
  })

  it('плитки цен: состояние — только по порогу, диапазон со знаками в одном неразрывном блоке, без «демо»', () => {
    const move = { n: 9, median: 0.2, lo: -0.152, hi: 0.696, index: [100, 120] }
    const html = renderToStaticMarkup(<KpiRow goods={move} raw={{ ...move, median: 0.15 }} by="к марту 2027" plan={NO_PLAN} loading={false} failed={false} />)
    expect(html).toContain('у типичной позиции')
    expect(html).toContain('mon-kpi__range')
    expect(html).toContain('+70')
    expect(html).not.toContain('синтетическ')
    expect(html).toContain('выше порога 10')
  })

  it('план без номера и устаревший план: подпись по дате и «план устарел» на плитке', () => {
    const plan = { ...NO_PLAN, planKey: 'abc', otd: 1, builtAt: Date.UTC(2026, 9, 24, 14, 36), stale: 'портфель пересчитан после построения плана' }
    const html = renderToStaticMarkup(<KpiRow goods={null} raw={null} by="к марту 2027" plan={plan} loading={false} failed={false} />)
    expect(html).toContain('план от ')
    expect(html).toContain('план устарел')
  })

  it('сбой генератора ставки — «недоступно» с «Подробнее», остальное рисуется', () => {
    const html = renderToStaticMarkup(
      <MacroFans rate={null} rateError="macro: эпизод 1999-01 вне истории" ratePending={false} refetching={false}
        sample={{ sample: null, status: 'error', error: 'Макро-генератор не загружен', retry: () => {} }} summary={null} history={undefined}
        anchor="2026-09" stress={null} onRetry={() => {}} />,
    )
    expect(html).toContain('Генератор не ответил')
    expect(html).toContain('Подробнее')
    expect(html).toContain('эпизод 1999-01 вне истории')
    expect(html).toContain('Инфляция, % в год')
  })

  it('стресс: без оговорки под каждым веером и без служебного текста; проверка генератора не выдаётся за проверку стресса', () => {
    const paths = [0, 1, 2].map((i) => ({ monthly: { key: [15 + i, 14 + i], cpi: [8, 7], fx: [80, 82] } }))
    const sample = { sample: { paths, last_obs: { month: '2026-09', key_pp: 16, cpi_yoy_pp: 8, usd_rub: 84 } }, status: 'ready', error: null } as unknown as Parameters<typeof MacroFans>[0]['sample']
    const html = renderToStaticMarkup(
      <MacroFans rate={null} rateError={null} ratePending refetching={false} sample={sample} summary={null} history={undefined}
        anchor="2026-09" stress="Как 2022" onRetry={() => {}} />,
    )
    expect(html).not.toContain('Не прогноз')
    expect(html).not.toContain('прежний способ')
    expect(html).toContain('проверка генератора относится к прогнозу, не к этому стрессу')
    expect(html).toMatch(/к нояб\. 2026/)
  })
})

describe('веер и таблица рядов', () => {
  it('покрытие 50 % — ▲ и фраза частотой, без зелёной точки; заголовок — действие «Открыть веер»', () => {
    const html = renderToStaticMarkup(<ForecastFan p={prod('a', { backtest: bt(0.6, 0.5) })} onOpen={() => {}} />)
    expect(html).toContain('fc-q--warn')
    expect(html).toContain('▲')
    expect(html).toContain('факт в полосе 3 из 6 мес')
    expect(html).not.toContain('glyph-running')
    expect(html).toContain('ch-title-btn')
    expect(html).not.toContain('открыть веер')
  })

  it('таблица: группы по роли, полные заголовки, надёжность словом, шеврон вместо «открыть веер»', () => {
    const html = renderToStaticMarkup(<ForecastTable products={[prod('a'), prod('r', { role: 'raw' })]} onOpen={() => {}} caption="ряды" withQuality={false} sortBy="delta" />)
    expect(html).toContain('Изделия (цены сбыта) · 1')
    expect(html).toContain('Сырьё (закупочные цены) · 1')
    expect(html).toMatch(/Медиана через 1.месяц и изменение/)
    expect(html).toMatch(/130.₽<span class="fc-t__delta"> · \+30.%/)
    expect(html).toContain('8 из 10 исходов')
    expect(html).not.toContain('P10')
    expect(html).toContain('Надёжность')
    expect(html).toContain('не проверен')
    expect(html).toContain('fc-t__chev')
    expect(html).not.toContain('открыть веер')
    expect(html).not.toContain('Δ к сейчас')
  })
})
