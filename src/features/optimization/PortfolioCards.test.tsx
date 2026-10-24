import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExpectedCard, PriceOfRobustness, RobustHero } from './PortfolioCards'
import { ExactCard, LoadCard, OosCard, ParetoCard } from './ResultCards'
import type { OptResultExt } from './optTypes'

const metrics = (expected: number, cvar: number, p_loss: number) => ({
  expected, std: 60e6, worst_case: -120e6, var: -47e6, cvar, p_loss, downside: 0, best: 2.25e9, max_regret: 80e6,
})
const pf = (m: ReturnType<typeof metrics>, concentration: number) => ({
  items: Array.from({ length: 6 }, (_, i) => ({
    product_id: `p${i}`, qty: 100 - i * 10, unit_price: 1, unit_cost: 1, unit_margin: 1, contribution: (10 - i) * 1e6, risk_contribution: (6 - i) / 21,
  })),
  resource_load: Array.from({ length: 14 }, (_, i) => ({ wc_type_id: `w${i}`, load_hours: 100 + i, capacity_hours: 1000, utilization: i === 0 ? 0.85 : 0.1 + i / 100 })),
  total_load_hours: 1, diversification: { n_products: 6, hhi: 0.38, effective_n: 2.6, concentration }, metrics: m,
})
const bins = Array.from({ length: 24 }, (_, i) => ({ x0: -200e6 + i * 20e6, x1: -180e6 + i * 20e6, count: 50 + i, count_expected: 10 }))
const R = {
  scenario_id: 's1', scenario_name: 'Базовый', objective: 'cvar', samples: 3000, alpha: 0.1, lambda: 0.5, seed: 1, horizon_hours: 9360,
  market_corr: 0.3, max_share: 0.6, sellables: 6, robust: pf(metrics(45.7e6, -53.7e6, 0.35), 0.6), expected: pf(metrics(60e6, -497e6, 0.4), 0.9),
  price_of_robustness: 14.3e6, histogram: bins, histogram_robust: bins,
  candidates: [
    { expected: 45.7e6, cvar: -53.7e6, worst_case: -1, std: 60e6, p_loss: 0.35, max_regret: 0, is_robust: true, is_expected: false, is_pareto: true },
    { expected: 60e6, cvar: -497e6, worst_case: -1, std: 300e6, p_loss: 0.4, max_regret: 0, is_robust: false, is_expected: true, is_pareto: true },
    { expected: 10e6, cvar: -90e6, worst_case: -1, std: 200e6, p_loss: 0.5, max_regret: 0, is_robust: false, is_expected: false, is_pareto: false },
  ],
  warnings: [], run_id: 'a1b2c3d4',
  oos: { expected: 49.7e6, cvar: -52.8e6, worst_case: -130e6, std: 61e6, p_loss: 0.34, gap_expected: -0.088, gap_cvar: -0.016 },
  exact: {
    status: 'optimal', n_scenarios: 3000, pwl_segments: 8, pwl_max_error: 1e4, solve_ms: 40,
    gap_vs_heuristic: { objective_pct: 2.1, oos_objective_pct: -0.4, expected_pct: 0.3, cvar_pct: 2.1 },
    duals: [{ wc_type: 'w0', shadow_price: 1200, utilization: 1 }, { wc_type: 'w1', shadow_price: 300, utilization: 0.97 }],
  },
} as unknown as OptResultExt
const nameOf = (id: string) => `Имя ${id}`

describe('Портфель: карточки результата', () => {
  it('hero: σ stays lowercase, ochre ▲ marks the selected portfolio and the optimised tile, no coloured number text', () => {
    const html = renderToStaticMarkup(<RobustHero result={R} nameOf={nameOf} />)
    expect(html).toContain('>σ</span> прибыли')
    expect(html).toContain('в 35 из 100 сценариев')
    expect(html).toContain('opt-sel')
    expect(html.match(/opt-obj"/g)?.length).toBe(1)
    expect(html).not.toMatch(/dk-tone-(good|bad)/)
    expect(html).toContain('Объём, шт')
    expect(html).toContain('Показать все 6')
    expect(html).toContain('на пределе')
  })

  it('comparison card: Δ chips, frequency and the flip condition', () => {
    const html = renderToStaticMarkup(<ExpectedCard result={R} />)
    expect(html).toContain('dk-delta')
    expect(html).toContain('в 40 из 100 сценариев')
    expect(html).toContain('лучше, только если важно лишь среднее')
    expect(renderToStaticMarkup(<PriceOfRobustness result={R} />)).toContain('плата за худший сценарий')
  })

  it('secondary cards: OOS verdict by direction, LP gap in words, statement titles', () => {
    const oos = renderToStaticMarkup(<OosCard result={R} />)
    expect(oos).toContain('вне выборки не хуже')
    expect(oos).not.toContain('переобучение')
    const exact = renderToStaticMarkup(<ExactCard result={R} nameOf={nameOf} />)
    expect(exact).toContain('LP лучше на 2,1')
    expect(exact).toContain('эвристика лучше на 0,4')
    expect(exact).toContain('Теневая цена, ₽/ч')
    expect(renderToStaticMarkup(<ParetoCard result={R} />)).toContain('Устойчивый портфель — на границе')
    const load = renderToStaticMarkup(<LoadCard result={R} nameOf={nameOf} />)
    expect(load).toContain('Мощности близки к пределу')
    expect(load).toContain('Все 14')
  })
})
