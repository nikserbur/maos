/**
 * «Аналитика» — разметка (renderToStaticMarkup): вердикт без ложной пустоты при загрузке, плитки
 * без «зелёной нормы» и с Δ к названной базе, герой не одиночное число, вердикт инвестпроекта —
 * от движка (без «окупается» по сроку окупаемости), ровный график схлопнут в строку-итог.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InvestCrnCandidate, InvestmentResult, KpiBundle } from '../../lib/api'
import { AnalyticsVerdict } from './AnalyticsVerdict'
import { KpiPins } from './KpiPins'
import { InvestVerdictCard } from './InvestResult'
import { KpiCharts } from './KpiCharts'
import { buildVerdict } from './verdict'
import type { PlanRef } from './planRuns'

const kpi = (id: string, k: Record<string, number>, created = '2026-10-24 10:00:00'): KpiBundle => ({ plan_id: id, created_at: created, kpi: k })
const noop = () => {}

describe('строка-вердикт', () => {
  it('во время загрузки — скелет, а не «нет данных»', () => {
    const html = renderToStaticMarkup(<AnalyticsVerdict verdict={null} loading onInvest={noop} />)
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toMatch(/Нет данных|не сохранены/)
  })

  it('факты и переход к инвестпроекту', () => {
    const v = buildVerdict({ seq: 28, nTasks: 618, bundle: kpi('p', { n_late: 0, otd: 1 }), loads: [{ typeId: 't', name: 'Резьбонарезной', machines: 2, operators: 2, utilization: 0.63, laborBound: false }] })
    const html = renderToStaticMarkup(<AnalyticsVerdict verdict={v} loading={false} onInvest={noop} />)
    expect(html).toContain('План №28')
    expect(html).toContain('все заказы в срок')
    expect(html).toContain('Инвестпроект')
  })
})

describe('плитки KPI', () => {
  const bundle = kpi('p2', { makespan: 400, makespan_mean: 419, makespan_cvar: 460, makespan_worst: 500, otd: 1, n_late: 0 })
  const base = kpi('p1', { makespan: 420, makespan_mean: 437, makespan_cvar: 470, makespan_worst: 520, otd: 1, n_late: 0 }, '2026-10-23 10:00:00')
  const ref: PlanRef = { id: 'p1', seq: 27, createdAt: base.created_at ?? '', nTasks: 600, makespanMean: 437, makespanDet: 420 }

  it('норма не подписывается; Δ к названной базе; герой с полосой хвоста', () => {
    const html = renderToStaticMarkup(
      <KpiPins pinned={['MAKESPAN', 'OTD']} bundle={bundle} loading={false} series={[base, bundle]} seriesLoading={false}
        ctx={{}} base={{ ref, bundle: base }} onOpen={noop} editing={false} onToggleEdit={noop} />,
    )
    expect(html).toContain('Заказы в срок · OTD')
    expect(html).toContain('Длина расписания · E[Cmax]')
    expect(html).not.toContain('glyph-running')
    expect(html).not.toContain('в норме')
    expect(html).toContain('к №27')
    expect(html).toContain('dk-tail-legend')
  })

  it('пока KPI грузятся — скелеты плиток, спарклайн держит место', () => {
    const html = renderToStaticMarkup(
      <KpiPins pinned={['MAKESPAN']} bundle={null} loading series={[]} seriesLoading ctx={{}} base={null} onOpen={noop} editing={false} onToggleEdit={noop} />,
    )
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('—')
  })
})

describe('графики KPI', () => {
  it('ровный ряд — строка-итог вместо графика из одинаковых точек', () => {
    const series = [1, 2, 3].map((i) => kpi(`p${i}`, { otd: 1 }, `2026-10-2${i} 10:00:00`))
    const html = renderToStaticMarkup(
      <KpiCharts charts={[{ type: 'line', axis: 'plans', metrics: ['OTD'] }]} axis="plans" period="all" series={series} res={null}
        seqOf={new Map()} onChange={noop} onReplace={noop} />,
    )
    expect(html).toContain('во всех 3 построениях')
    expect(html).toContain('Показать «Время потока заказа»')
  })
})

describe('вердикт инвестпроекта', () => {
  const cand: InvestCrnCandidate = {
    cand: { id: 'm-t1', kind: 'machine', wc_type: 't1', capex: 2.5e6, lead_weeks: 8, opex_weekly: 5000, life_weeks: 520, mtbf_mul: 1, repair_mul: 1, prepay_share: 0.3, source: 'user' },
    n: 48, week: 0, horizon_weeks: 26, weeks_used: 26, cont_weeks: 260,
    npv_mean: 3.1e6, npv_ci95: [-0.4e6, 5.9e6], npv_cvar: -2e6, p_npv_neg: 0.07,
    d_profit_mean: 1e6, d_profit_ci95: [0, 2e6], d_profit_cvar: -1e5, profit_cvar_base: 1e7, profit_cvar: 1.1e7,
    cash_min_cvar_base: -1e6, cash_min_cvar: -1.2e6, liquidity_cvar_base: 0, liquidity_cvar: 0, liq_threshold: 0,
    p_cash_gap: 0.05, p_cash_gap_ci95: [0.01, 0.1], p_cash_gap_base: 0.03,
    cf_weekly_mean: 1e4, payback_weeks: null, payback_months: null, rate_owner: 0.18,
    apply: false, reasons: ['нижняя граница 95%-ДИ E[ЧДД] ≤ 0 (выигрыш не подтверждён)'],
    selection: { npv_mean: 3e6, npv_ci95: [0, 1], d_profit_mean: 0, cash_min_cvar: 0, p_cash_gap: 0, apply: false },
  }
  const r: InvestmentResult = {
    wc_type_id: 't1', add_machines: 2, capex: 5e6, plan_months: 6, life_months: 60, discount_annual: 0.19,
    profit_before: 1e7, profit_after: 1.1e7, delta_profit_horizon: 1e6, delta_cf_month: 2e5, payback_months: 25,
    npv: 3e6, irr_annual: 0.3, roi: 1.4, util_before: 0.9, util_after: 0.6,
    next_bottleneck: { wc_type_id: '', wc_name: '', utilization: 0 },
    crn: { status: 'ok', candidates: [cand] },
  }

  it('вердикт движка с ДИ и частотами, без «окупается» по сроку', () => {
    const html = renderToStaticMarkup(<InvestVerdictCard r={r} chosen={cand} nameOfType={() => 'Резьбонарезной'} />)
    expect(html).toContain('не применять')
    expect(html).toContain('в 7 из 100 сценариев')
    expect(html).toContain('3 → 5 из 100 к базе')
    expect(html).toContain('95')
    expect(html).not.toMatch(/dk-chip[^>]*>(<[^>]*>)*[^<]*окупается/)
    expect(html).toContain('Ничего не применяется автоматически')
  })

  it('нет оценки — причина простыми словами', () => {
    const html = renderToStaticMarkup(<InvestVerdictCard r={{ ...r, crn: { status: 'no_orders', reason: 'нет открытых заказов (demand_orders)' } }} chosen={null} nameOfType={() => 'Резьбонарезной'} />)
    expect(html).toContain('Нет открытых заказов — оценивать нечего')
    expect(html).not.toContain('не применять')
  })
})
