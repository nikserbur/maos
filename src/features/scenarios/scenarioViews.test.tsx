/**
 * Дымовые проверки разметки «Сценариев» (SSR): шапка с одним главным действием, пресетом и сводкой
 * критерия; «Условия» — карточка пресета и поля в понятных единицах без сырого текста паспорта;
 * сравнение с Δ и источником умолчания; распределения таблицей без сокращений; галерея пресетов.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MacroRegimes, PriceScenario, Product } from '../../lib/api'
import { NBSP } from '../../explain/format'
import { ConditionsTab } from './ConditionsTab'
import { DistributionsTab } from './DistributionsTab'
import { ScenarioCompare } from './ScenarioCompare'
import { ScenarioHeader } from './ScenarioHeader'
import { PresetDiff, PresetGallery } from './PresetGallery'
import { getPreset } from './scenarioPresets'
import { ScenarioTabs } from './ScenarioTabs'

const sc = (id: string, over: Partial<PriceScenario> = {}): PriceScenario => ({ id, name: `Сценарий ${id}`, description: '', horizon_hours: '720', created_at: '', ...over })
const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, code: `A-${id}`, name: `Вал ${id}, сталь`, unit: 'шт', parent_id: '', qty_in_parent: '1', batch_size: '10',
  stock: '0', purchased: '0', created_at: '', sellable: '1', base_cost: '500', base_price: '1000', demand_max: '100', ...over,
})
const noop = () => {}
const regimes = {
  k: 2, block_months: 4, crisis_index: 1, p_last: [1, 0], note: '', transition: [[0.96, 0.04], [0.34, 0.66]],
  last_obs: { month: '2026-09', cpi_yoy_pp: 6.35, key_pp: 14, usd_rub: 84.4283 }, stress_quantiles: [0.05, 0.95], episodes_available: ['2013-09', '2026-09'],
  episode_first: '2013-10',
  regimes: [
    { index: 0, label: 'спокойный', share_of_history: 0.92, n_months: 144, stationary_prob: 0.9, resid_sd: { log_cpi_pp: 0.46, real_key_pp: 0.69, log_fx_pct: 4.4 }, mean_duration_months: 28.8, months: [], stay_prob: 0.96, stay_prob_block: 0.9 },
    { index: 1, label: 'кризис (макс. дисперсия)', share_of_history: 0.08, n_months: 12, stationary_prob: 0.1, resid_sd: { log_cpi_pp: 3.2, real_key_pp: 5.3, log_fx_pct: 13.3 }, mean_duration_months: 3, months: ['2022-02', '2022-03'], stay_prob: 0.66, stay_prob_block: 0.4 },
  ],
} as MacroRegimes
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
    expect(html).toContain(`доля изделия до <span class="num">60${NBSP}%</span>`)
    expect(html).toContain('Базовый · прогноз')
    expect(html).toContain('Начало: сегодня')        // без сырого «дд.мм.гггг» и «▲ без даты»
    expect(html).not.toContain('▲ без даты')
    expect(html).not.toContain('sc2-crumbs')           // путь — только в крошках верхней панели
  })

  it('правка условий Базового — уже «что если»; критерий словами, без «E − λ·σ»', () => {
    const html = renderToStaticMarkup(
      <ScenarioHeader sc={sc('1', { macro_mode: '{"mode":"base","preset":"base"}', market_corr: '0.05', objective: 'meanvariance' })} regimes={regimes} isWorking
        onPatch={noop} onMakeWorking={noop} onFindPortfolio={noop} onBuildPlan={noop} onClone={noop} onRemove={noop} />,
    )
    expect(html).toContain('Базовый + 1 правка · что если')
    expect(html).toContain('Критерий: прибыль минус риск')
  })
})

describe('вкладки сценария', () => {
  it('ссылки-вкладки (не «пилюли»), счётчик ручных рядов, одно имя «Прогноз цен» у любого сценария', () => {
    const html = renderToStaticMarkup(
      <ScenarioTabs sc={sc('7', { macro_mode: '{"mode":"episode","stress":{"episode":"2022-02","months":7,"order":"replay"},"preset":"sanctions-2022"}', volatility: '0.12', market_corr: '0.75', demand: '0.9' })}
        tab="conditions" products={[product('1')]} productsFailed={false} regimes={regimes} macro={null} isWorking onTab={noop} onPatch={noop}
        onSetDist={async () => {}} onSetDists={async () => {}} onMakeWorking={noop} onFindPortfolio={noop} onBuildPlan={noop} onClone={noop} onRemove={noop} />,
    )
    expect(html).toContain('href="#/scenarios/7/distributions"')
    expect(html).toContain('Прогноз цен')
    expect(html).not.toContain('Пути цен')
    expect(html).not.toContain('Прогноз и проверка')
    expect(html).toContain('Как 2022 · что если')
    expect(html).not.toMatch(/dk-seg\b/)
  })
})

describe('вкладка «Условия»', () => {
  it('без кодов паспорта и легаси-ползунков; ρ 0,25 — «вручную»; пресет и расширенные настройки', () => {
    const html = renderToStaticMarkup(<ConditionsTab sc={sc('1', { market_corr: '0.25' })} regimes={null} macro={null} onPatch={noop} />)
    expect(html).not.toMatch(/macro\.ref_key|\(14\.0\)|Устаревшие параметры|btn--primary/)
    expect(html).toContain('data-key="manual"')
    expect(html).toContain('Базовый — обучено на истории')
    expect(html).toContain('Сменить пресет')
    expect(html).toContain('Расширенные настройки генератора')
  })

  it('умолчания — из генератора и данных, в понятных единицах; никакого «0 %/мес», «1 ×», CAPS-пилюль и сырого текста', () => {
    const html = renderToStaticMarkup(<ConditionsTab sc={sc('1')} regimes={regimes} macro={null} onPatch={noop} />)
    expect(html).toMatch(/value="6\.[34]"/)              // 6,35 % г/г ЦБ РФ, с шагом 0,1
    expect(html).toContain(`%${NBSP}г/г`)
    expect(html).toContain('генератор · ЦБ РФ, сент. 2026')
    expect(html).toContain('value="100"')
    expect(html).toContain('% от исторического')
    expect(html).toContain('% к курсу по прогнозу')
    expect(html).toContain('% к справочнику')
    expect(html).toContain(`84,43${NBSP}₽`)
    expect(html).not.toContain('к генератору')
    expect(html).not.toMatch(/%\/мес<|>×<|ПО УМОЛЧАНИЮ|flat|\(14 0\)|опора —|\d{4}-\d{2}(?!-)/)
    expect(html).not.toContain('data-key="manual"')
  })

  it('пресет «Как 2022»: экспертные значения подписаны пресетом, а не «нормативом»', () => {
    const html = renderToStaticMarkup(<ConditionsTab sc={sc('1', {
      macro_mode: '{"mode":"episode","stress":{"episode":"2022-02","months":7,"order":"replay"},"preset":"sanctions-2022"}', volatility: '0.12', market_corr: '0.75', demand: '0.9', months: '12',
    })} regimes={regimes} macro={null} onPatch={noop} />)
    expect(html).toContain('Как 2022: санкционный шок')
    expect(html).toContain('экспертная оценка пресета «Как 2022»')
    expect(html).toContain('value="200"')
    expect(html).toContain('что если')
    expect(html).not.toContain('вернуть')
  })
})

describe('создание сценария', () => {
  it('галерея пресетов по группам; «Базовый — обучено на истории» выбран; есть COVID и 2022', () => {
    const html = renderToStaticMarkup(<PresetGallery value="base" onChange={noop} regimes={regimes} />)
    for (const t of ['Прогноз', 'Как в истории', 'Стресс-тесты', 'Как COVID-2020', 'Как 2022: санкционный шок', 'Как 2023', 'Как 2024', 'Высокая ставка 21', 'Ценовой кризис', 'Слабый рубль']) expect(html).toContain(t)
    expect(html).toMatch(/aria-checked="true"[^>]*data-choice="base"/)
    expect(html).toContain('повторяет февр.–авг. 2022')
    expect(html).not.toMatch(/квантиль|С нуля|α хвоста|\d{4}-\d{2}/)
    const diff = renderToStaticMarkup(<PresetDiff preset={getPreset('covid-2020')!} regimes={regimes} />)
    expect(diff).toContain('Что меняет «Как COVID-2020» относительно Базового')
    expect(diff).toContain('повтор изменений март–сент. 2020 по порядку')
    expect(diff).toContain('экспертная оценка: провал заказов')
  })
})

describe('сравнение', () => {
  it('пустое — подсказка; два сценария — Δ к базе и глиф умолчания с подсказкой, одна главная кнопка', () => {
    const empty = renderToStaticMarkup(<ScenarioCompare scenarios={[sc('1')]} ids={['1']} workingId="1" products={[]} regimeNames={[]} onMakeWorking={noop} onDrop={noop} />)
    expect(empty).toContain('Отметьте 2–5 сценариев')
    const html = renderToStaticMarkup(
      <ScenarioCompare scenarios={[sc('1'), sc('2', { market_corr: '0.25', objective: 'meanvariance' })]} ids={['2', '1']} workingId="1"
        products={[]} regimeNames={[]} onMakeWorking={noop} onDrop={noop} />,
    )
    expect(filled(html)).toBe(1)
    expect(html).not.toContain('meanvariance')
    expect(html).toContain('dk-delta')
    expect(html).toContain('sc2-cmp__dflt')
    expect(html).toContain('Не задано в сценарии — по умолчанию')
    expect(html).not.toContain('○ по умолчанию')
    expect(html).toContain('sc2-cmp__table--n2')
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
