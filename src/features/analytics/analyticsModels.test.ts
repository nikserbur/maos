import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import type { InvestCrn, InvestCrnCandidate, KpiBundle, SimPlanSummary } from '../../lib/api'
import { analyticsAnchor, analyticsCrumb, parseAnalyticsAnchor } from './analyticsRoute'
import { REC_THRESHOLDS, buildRecommendations, type TypeLoad } from './analyticsModel'
import { bottleneckShare, flowMatrix, topTransitions, type FlowModel } from './flowModel'
import { chosenCandidate, crnNotice, freqScenarios, gapShiftText, investRows, loseIfText, verdictLine } from './investModel'
import { kpiDef, kpiLabel, withTail } from './kpiCatalog'
import { kpiDeviation } from './kpiFormat'
import { planOptionLabel, planRefs, planSeqMap, previousPlan } from './planRuns'
import { LOAD_THRESHOLDS, loadLevel } from './thresholds'
import { buildVerdict, verdictText } from './verdict'

const plan = (id: string, created: string, nTasks = 10): SimPlanSummary => ({ id, created_at: created, n_tasks: String(nTasks), makespan: '400' })
const kb = (id: string, created: string, kpi: Record<string, number> = {}): KpiBundle => ({ plan_id: id, created_at: created, kpi })

describe('адрес «Аналитики»', () => {
  it('вкладка и план в якоре; мусор — KPI последнего', () => {
    expect(parseAnalyticsAnchor('invest/ab12')).toEqual({ tab: 'invest', planId: 'ab12' })
    expect(parseAnalyticsAnchor('flow')).toEqual({ tab: 'flow', planId: null })
    expect(parseAnalyticsAnchor(null)).toEqual({ tab: 'kpi', planId: null })
    expect(parseAnalyticsAnchor('nope/1')).toEqual({ tab: 'kpi', planId: null })
    expect(analyticsAnchor('bottleneck', 'ab12')).toBe('bottleneck/ab12')
    expect(analyticsAnchor('kpi', null)).toBe('kpi')
    expect(analyticsCrumb('invest', 'План №3')).toBe('Инвестпроекты · План №3')
  })
})

describe('номера построений', () => {
  const plans = [plan('c', '2026-10-24 10:00:00'), plan('b', '2026-10-23 10:00:00'), plan('a', '2026-10-22 10:00:00')]
  const series = [kb('old', '2026-10-01 10:00:00'), kb('a', '2026-10-22 10:00:00', { makespan_mean: 419.4 }), kb('b', '2026-10-23 10:00:00')]

  it('старое — №1; планы вне окна списка сохраняют номер', () => {
    const seq = planSeqMap(plans, series)
    expect([seq.get('old'), seq.get('a'), seq.get('b'), seq.get('c')]).toEqual([1, 2, 3, 4])
  })

  it('подпись выбора и предыдущее построение', () => {
    const refs = planRefs(plans, series)
    expect(refs.map((r) => r.seq)).toEqual([4, 3, 2])
    const a = refs.find((r) => r.id === 'a')!
    expect(planOptionLabel(a)).toMatch(new RegExp(`^№2 · E${NBSP}419${NBSP}ч · 10${NBSP}оп · `))
    expect(previousPlan(refs, 'c')?.id).toBe('b')
    expect(previousPlan(refs, 'a')).toBeNull()
  })
})

describe('пороги загрузки — одно определение', () => {
  it('уровни и правило рекомендаций читают один порог', () => {
    expect(loadLevel(0.63)).toBe('ok')
    expect(loadLevel(LOAD_THRESHOLDS.warn)).toBe('warn')
    expect(loadLevel(0.97)).toBe('bad')
    expect(REC_THRESHOLDS.bottleneck).toBe(LOAD_THRESHOLDS.warn)
    const bn = kpiDef('BN_UTIL')!
    expect(kpiDeviation(bn, 0.5, kb('x', ''))).toBeNull()
    expect(kpiDeviation(bn, 0.85, kb('x', ''))).toBe('warn')
    expect(kpiDeviation(bn, 0.96, kb('x', ''))).toBe('bad')
  })

  it('средняя загрузка — без светофора, подписи общие с «Планом»', () => {
    const util = kpiDef('UTIL')!
    expect(util.status).toBeUndefined()
    expect(util.name).toBe('Загрузка оборудования (средняя)')
    expect(kpiLabel(util)).toBe('Загрузка оборудования (ср.)')
    expect(kpiLabel(kpiDef('OTD')!)).toBe('Заказы в срок · OTD')
    expect(withTail('MAKESPAN')).toEqual(['MAKESPAN', 'MK_CVAR'])
    expect(withTail('OTD')).toEqual(['OTD'])
  })

  it('рекомендация «инвестпроект» — от порога «внимание»', () => {
    const b: KpiBundle = { plan_id: 'p', kpi: {}, bottleneck: { wc_type_id: 't', wc_name: 'Резьбонарезной', utilization: 0.82 } }
    expect(buildRecommendations(b, []).map((r) => r.kind)).toEqual(['bottleneck'])
  })
})

describe('строка-вердикт', () => {
  const loads: TypeLoad[] = [{ typeId: 't1', name: 'Резьбонарезной', machines: 2, operators: 2, utilization: 0.63, laborBound: false }]

  it('все в срок, узкое место без глифа, ожидание', () => {
    const v = buildVerdict({ seq: 28, nTasks: 618, bundle: kb('p', '', { n_late: 0, otd: 1, wait_share: 0.73 }), loads })
    expect(v.head).toBe(`План №28 · 618${NBSP}оп.`)
    expect(v.facts.map((f) => f.text)).toEqual(['все заказы в срок', `узкое место — «Резьбонарезной» 63${NBSP}%`, `73${NBSP}% времени потока — ожидание`])
    expect(v.facts[1].glyph).toBeUndefined()
    expect(v.bottleneck?.typeId).toBe('t1')
  })

  it('отклонения — глиф и слово', () => {
    const hot: TypeLoad[] = [{ ...loads[0], utilization: 0.97 }]
    const v = buildVerdict({ seq: 3, nTasks: 0, bundle: kb('p', '', { n_late: 2, otd: 0.8 }), loads: hot })
    expect(v.facts[0].glyph).toBe('glyph-setup')
    expect(v.facts[0].text).toContain(`просрочено 2${NBSP}заказа`)
    expect(v.facts[1].word).toBe('перегрузка')
    expect(verdictText(v)).toContain('(перегрузка)')
  })

  it('без KPI — честная пустота', () => {
    const v = buildVerdict({ seq: null, nTasks: 0, bundle: null, loads: [] })
    expect(v.facts[0].key).toBe('none')
  })
})

describe('потоки', () => {
  const model: FlowModel = { types: ['a', 'b', 'c'], links: [{ from: 'a', to: 'b', v: 5 }, { from: 'b', to: 'c', v: 3 }, { from: 'a', to: 'c', v: 2 }] }

  it('топ переходов и матрица', () => {
    expect(topTransitions(model, 2).map((l) => `${l.from}${l.to}`)).toEqual(['ab', 'bc'])
    const m = flowMatrix(model)
    expect(m.from).toEqual(['a', 'b'])
    expect(m.to).toEqual(['b', 'c'])
    expect(m.values).toEqual([[5, 2], [0, 3]])
    expect(m.max).toBe(5)
  })

  it('доля партий через узкое место', () => {
    expect(bottleneckShare(model, 'b')).toBeCloseTo(0.8)
    expect(Number.isNaN(bottleneckShare(model, null))).toBe(true)
  })
})

describe('вероятностный вердикт инвестпроекта', () => {
  const cand = (id: string, wct: string, source: string, npv: number, apply: boolean): InvestCrnCandidate => ({
    cand: { id, kind: 'machine', wc_type: wct, capex: 2.5e6, lead_weeks: 8, opex_weekly: 5000, life_weeks: 520, mtbf_mul: 1, repair_mul: 1, prepay_share: 0.3, source },
    n: 48, week: 0, horizon_weeks: 26, weeks_used: 26, cont_weeks: 260,
    npv_mean: npv, npv_ci95: [npv - 2e6, npv + 2e6], npv_cvar: npv - 4e6, p_npv_neg: 0.07,
    d_profit_mean: 1e6, d_profit_ci95: [0, 2e6], d_profit_cvar: -1e5, profit_cvar_base: 1e7, profit_cvar: 1.1e7,
    cash_min_cvar_base: -1e6, cash_min_cvar: -1.2e6, liquidity_cvar_base: 0, liquidity_cvar: 0, liq_threshold: 0,
    p_cash_gap: 0.05, p_cash_gap_ci95: [0.01, 0.1], p_cash_gap_base: 0.03,
    cf_weekly_mean: 1e4, payback_weeks: 120, payback_months: 27.6, rate_owner: 0.18,
    apply, reasons: apply ? [] : ['нижняя граница 95%-ДИ E[ЧДД] ≤ 0 (выигрыш не подтверждён)'],
    selection: { npv_mean: npv, npv_ci95: [0, 1], d_profit_mean: 0, cash_min_cvar: 0, p_cash_gap: 0, apply },
  })
  const crn: InvestCrn = { status: 'ok', candidates: [cand('m-t2', 't2', 'toc', 5e6, true), cand('m-t1', 't1', 'user', 3.1e6, false)], params: { cont_weeks: 260, liq_threshold: 0, rate_owner: 0.18, horizon_weeks: 26, alpha: 0.05, beta: 0.05, salvage: 0, tax_cumulative: true } }
  const name = (id: string) => ({ t1: 'Резьбонарезной', t2: 'Фрезерный' } as Record<string, string>)[id] ?? id

  it('оценивается тип из формы, а не лучший', () => {
    expect(chosenCandidate(crn, 't1')?.cand.id).toBe('m-t1')
    expect(chosenCandidate(crn, 'zzz')?.cand.id).toBe('m-t2')
    expect(chosenCandidate(null, 't1')).toBeNull()
  })

  it('таблица: кандидаты по E[ЧДД] + «ничего не делать», выбранный отмечен', () => {
    const rows = investRows(crn, chosenCandidate(crn, 't1'), name)
    expect(rows.map((r) => r.label)).toEqual(['станок «Фрезерный»', 'станок «Резьбонарезной»', 'ничего не делать'])
    expect(rows.filter((r) => r.chosen).map((r) => r.key)).toEqual(['m-t1'])
    expect(rows[2].pGap).toBe(0.03)
    expect(rows[2].apply).toBeNull()
  })

  it('частоты и вердикт словами', () => {
    const c = chosenCandidate(crn, 't1')!
    expect(freqScenarios(0.07)).toBe('в 7 из 100 сценариев')
    expect(gapShiftText(c)).toBe('3 → 5 из 100 к базе')
    expect(verdictLine(c).word).toBe('не применять')
    expect(verdictLine(c).reason).toContain('95%-ДИ')
    expect(loseIfText(c, 0.05)).toMatch(/^Выиграет у «ничего не делать», только если/)
    expect(loseIfText(chosenCandidate(crn, 't2')!, 0.05)).toMatch(/^Проиграет «ничего не делать», если сбудется худший хвост: в худших 5/)
  })

  it('нет оценки — причина простыми словами', () => {
    expect(crnNotice(crn)).toBeNull()
    expect(crnNotice({ status: 'no_orders', reason: 'нет открытых заказов (demand_orders)' })?.title).toBe('Нет открытых заказов — оценивать нечего')
    expect(crnNotice({ status: 'error', reason: 'boom' })?.detail).toBe('boom')
    expect(crnNotice(null)?.title).toBe('Вероятностная оценка не запрашивалась')
  })
})
