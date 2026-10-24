/**
 * «Мониторинг» — чистая логика: сбой генератора не роняет экран, ошибка без данных — не вечный скелет,
 * полнота данных — отдельно от делового статуса, важность по направлению × роли (понижение — только
 * при проваленной проверке), похожие позиции — одна карточка, надёжность — одной формулировкой,
 * инфляция в сигнале — та, что у движка, план устарел — по контексту решения.
 */
import { describe, expect, it } from 'vitest'
import type { ForecastProduct, ForecastResult } from '../../lib/api'
import { NBSP } from '../../explain/format'
import {
  calendarLabel, forecastPhase, headlineText, horizonBy, monitorStatus, normalizeForecast, priceMove, signedRangeText, trustText, usableFan,
} from './monitorModel'
import { NO_PLAN, buildSignals, inflationGap, planLabel, severityMeta, type PlanFacts, type SignalInput } from './monitorSignals'

const bt = (skill: number, coverage80: number) => ({ k: 6, mape: 10, mape_naive: 10, skill, pinball10: 1, pinball90: 1, coverage80 })
const prod = (id: string, over: Partial<ForecastProduct> = {}): ForecastProduct => ({
  id, name: `Позиция ${id}`, role: 'product', base: 100, p10: [100, 110], p50: [100, 115], p90: [100, 120], mean: [100, 115], history: [95, 100], ...over,
})
const rate = (over: Partial<ForecastProduct> = {}): ForecastProduct => ({
  id: 'keyrate', name: 'Ключевая ставка', role: 'rate', base: 14, history: [16, 14], p10: [14, 11.4], p50: [14, 13.5], p90: [14, 18.1], mean: [14, 13.6], ...over,
})
const res = (products: ForecastProduct[], over: Partial<ForecastResult> = {}): ForecastResult => ({
  months: 6, inflation_monthly: 0.005, fx: 1, demand: 1, volatility: 0.05, corr: 0.5, inflation_index: [100], products, rate: rate(),
  synthetic: false, demo: false, deprecated_fields: [], macro: { available: true, error: '' }, ...over,
})
const PLAN: PlanFacts = { ...NO_PLAN, planNo: '12', planKey: '12', otd: 0.95, cashGap: { p: 0.01, ci: null }, bottleneck: { name: 'Токарный участок', load: 0.4 } }
const input = (over: Partial<SignalInput> = {}): SignalInput => ({
  res: res([prod('a')]), forecastFailed: false, rateFailed: false, plan: PLAN, scenario: { id: 's1', name: 'Базовый' },
  hrefs: { forecast: '#/scenarios/s1/forecast', conditions: '#/scenarios/s1/conditions' }, by: 'к марту 2027',
  generatorCpi: 0.06, forecastAt: Date.UTC(2026, 9, 24), cbrLast: '2026-09', today: '2026-10', ...over,
})
const keys = (i: SignalInput) => buildSignals(i).map((s) => `${s.key}:${s.severity}`)
const up = (id: string, role: 'product' | 'raw', end: number, over: Partial<ForecastProduct> = {}) =>
  prod(id, { role, p10: [100, end - 5], p50: [100, end], p90: [100, end + 5], ...over })

describe('сбой генератора и честные состояния', () => {
  it('rate = {id, role, error} — не веер: экран не падает, ошибка отдельно', () => {
    const broken = { id: 'keyrate', role: 'rate', error: 'macro: эпизод 1999-01 вне истории' } as unknown as ForecastProduct
    expect(usableFan(broken)).toBe(false)
    const n = normalizeForecast(res([prod('a')], { rate: broken }))
    expect(n.res?.rate).toBeNull()
    expect(n.rateError).toBe('macro: эпизод 1999-01 вне истории')
    expect(headlineText({ res: n.res!, by: 'к марту 2027' })).not.toContain('ставка')
    expect(keys(input({ res: n.res, rateFailed: true }))).toContain('no-rate:missing')
  })

  it('ошибка без данных — «не рассчитано», а не вечный скелет; пересчёт с данными — данные', () => {
    expect(forecastPhase({ hasResult: false, loading: false, error: new Error('HTTP 500'), waiting: false, refsReady: true })).toBe('failed')
    expect(forecastPhase({ hasResult: false, loading: true, error: null, waiting: false, refsReady: true })).toBe('pending')
    expect(forecastPhase({ hasResult: true, loading: true, error: new Error('x'), waiting: false, refsReady: true })).toBe('ready')
    expect(keys(input({ res: null, forecastFailed: true }))).toContain('no-forecast:missing')
  })

  it('нет плана и кассы — полнота отдельно от делового статуса: «по рассчитанному», пропуск назван словом', () => {
    const s = buildSignals(input({ plan: NO_PLAN, res: res([prod('a')]) }))
    expect(s.map((x) => x.key)).toContain('no-plan')
    expect(s.find((x) => x.key === 'no-plan')?.actions[0]).toMatchObject({ kind: 'href', href: '#/plan/new' })
    expect(monitorStatus(s)).toMatchObject({ level: 'ok', title: 'В пределах порогов по рассчитанному', missing: ['план'] })
    const noCash = buildSignals(input({ plan: { ...PLAN, cashGap: null } }))
    expect(noCash.find((x) => x.key === 'no-cash')?.actions[0]).toMatchObject({ href: '#/plan/run/12/cash' })
    expect(monitorStatus(noCash).missing).toEqual(['касса'])
    expect(monitorStatus(buildSignals(input()))).toMatchObject({ level: 'ok', title: 'В пределах порогов', missing: [] })
  })

  it('пропуск данных не перекрывает тревогу: статус — худший деловой сигнал словами, качество модели — после', () => {
    const raw = up('r', 'raw', 144, { name: 'Прокат' })
    const narrow = { coverage80: 0.4, coverage90: 0.5, mean_CRPS: 1, mean_CRPS_persistence: 1.2, rmse_mean: 1, rmse_persistence: 1, PIT_histogram10: [] }
    const st = monitorStatus(buildSignals(input({ plan: { ...PLAN, cashGap: null }, res: res([raw]), rateHoldout: narrow })))
    expect(st).toMatchObject({ level: 'warn', title: 'Внимание', lead: `сырьё дорожает до +44${NBSP}%`, more: 1, missing: ['касса'] })
  })
})

describe('сигналы цен: направление × роль × надёжность', () => {
  it('сырьё дорожает — ▲; сбыт дорожает — ◆; три позиции сырья — одна карточка', () => {
    const s = buildSignals(input({ res: res([up('r1', 'raw', 132), up('r2', 'raw', 120), up('r3', 'raw', 111), up('g1', 'product', 129)]) }))
    const raw = s.find((x) => x.key === 'move-raw-up')!
    expect(raw.severity).toBe('warn')
    expect(raw.items).toHaveLength(3)
    expect(raw.title).toBe(`Сырьё дорожает: 3${NBSP}позиции — на 10${NBSP}% и больше к марту 2027 (до +32${NBSP}%)`)
    expect(raw.consequence).toContain('себестоимость')
    expect(raw.actions.map((a) => a.kind)).toEqual(['filter', 'open', 'href'])
    expect(s.find((x) => x.key === 'move-product-up')?.severity).toBe('info')
    expect(s.filter((x) => x.key.startsWith('move-'))).toHaveLength(2)
  })

  it('сбыт падает — ▲; полоса по обе стороны от «сейчас» — только метка «▲ ненадёжно», важность та же', () => {
    const down = prod('g', { p10: [100, 80], p50: [100, 85], p90: [100, 90] })
    expect(buildSignals(input({ res: res([down]) })).find((x) => x.key === 'move-product-down')?.severity).toBe('warn')
    const shaky = prod('g', { p10: [100, 70], p50: [100, 85], p90: [100, 104] })
    const sig = buildSignals(input({ res: res([shaky]) })).find((x) => x.key === 'move-product-down')!
    expect(sig.severity).toBe('warn')
    expect(sig.meta?.join(' ')).toContain('▲ ненадёжно')
  })

  it('сырьё +44 % при полосе через ноль и проверке ok/warn — ▲; проваленная проверка — на ступень ниже', () => {
    const wide = (backtest: ReturnType<typeof bt>) => up('r', 'raw', 144, { p10: [100, 85], p90: [100, 220], backtest })
    for (const q of [bt(0.6, 0.9), bt(1.2, 0.9)]) {
      expect(buildSignals(input({ res: res([wide(q)]) })).find((x) => x.key === 'move-raw-up')?.severity).toBe('warn')
    }
    const bad = buildSignals(input({ res: res([wide(bt(2, 0.3))]) })).find((x) => x.key === 'move-raw-up')!
    expect(bad.severity).toBe('info')
    expect(bad.meta?.join(' ')).toContain('✕ ненадёжно')
  })

  it('позиции — имя и изменение отдельно (колонка чисел)', () => {
    const name = 'Отливки из спецсплавов для агрессивных сред'
    const sig = buildSignals(input({ res: res([up('r1', 'raw', 144, { name })]) })).find((x) => x.key === 'move-raw-up')!
    expect(sig.items?.[0]).toEqual({ name, value: `+44${NBSP}%` })
  })

  it('важность сортирует: ✕ касса раньше ▲ сырья', () => {
    const s = buildSignals(input({ plan: { ...PLAN, cashGap: { p: 0.2, ci: null } }, res: res([up('r1', 'raw', 140)]) }))
    expect(s[0]).toMatchObject({ key: 'cash', severity: 'crit' })
    expect(s[0].actions[0]).toMatchObject({ href: '#/plan/run/12/cash' })
  })
})

describe('план, ставка, инфляция, счёт рядов', () => {
  it('план устарел (контекст решения) — ▲ «Перестроить план»; на другом сценарии — к сведению; перегрузка — с порогом «Плана»', () => {
    const stale = buildSignals(input({ plan: { ...PLAN, stale: 'портфель пересчитан после построения плана' } }))
    expect(stale.find((x) => x.key === 'stale-plan')).toMatchObject({ severity: 'warn', title: 'План №12 устарел', actions: [{ href: '#/plan/new' }] })
    const s = buildSignals(input({ plan: { ...PLAN, scenarioId: 's0', scenarioName: 'Как 2022', bottleneck: { name: 'ТВЧ', load: 0.86 } } }))
    expect(s.find((x) => x.key === 'plan-scenario')).toMatchObject({ severity: 'info', actions: [{ href: '#/scenarios/s0' }] })
    expect(s.find((x) => x.key === 'overload')?.actions[0]).toMatchObject({ href: '#/plan/run/12/load' })
    expect(buildSignals(input({ plan: { ...PLAN, bottleneck: { name: 'ТВЧ', load: 0.21 } } })).some((x) => x.key === 'overload')).toBe(false)
  })

  it('без номера плана — подпись по дате сборки, а не одинокое «План»', () => {
    expect(planLabel({ planNo: null, builtAt: null })).toBe('последний план')
    expect(planLabel({ planNo: '12', builtAt: null })).toBe('план №12')
    expect(planLabel({ planNo: null, builtAt: Date.UTC(2026, 9, 24, 14, 36) })).toMatch(/^план от \d{2}\.\d{2}/)
  })

  it('веер ставки узковат по проверке генератора — ▲ и «полоса занижена» в фразе; у стресса — нет', () => {
    const holdout = { coverage80: 0.4, coverage90: 0.5, mean_CRPS: 1, mean_CRPS_persistence: 1.2, rmse_mean: 1, rmse_persistence: 1, PIT_histogram10: [] }
    const sig = buildSignals(input({ rateHoldout: holdout })).find((x) => x.key === 'rate-quality')!
    expect(sig).toMatchObject({ severity: 'warn', title: 'Веер ставки узковат: факт внутри 4 из 10, норма 8' })
    expect(buildSignals(input({ rateHoldout: holdout, stress: true })).some((x) => x.key === 'rate-quality')).toBe(false)
    expect(headlineText({ res: res([prod('a')]), by: 'к марту 2027', rateNarrow: true })).toContain('полоса занижена')
  })

  it('инфляция в сигнале — та, с которой считал движок (inflation_monthly), против генератора', () => {
    const r = res([prod('a')], { inflation_monthly: 0.01 })
    const sig = buildSignals(input({ res: r, generatorCpi: 0.0635 })).find((x) => x.key === 'inflation')!
    expect(sig.severity).toBe('warn')
    expect(sig.title).toBe(`Цены считаются с инфляцией 12,7${NBSP}% в год, генератор ждёт 6,4${NBSP}%`)
    expect(inflationGap(0.005, 0.0635)).toBeNull()
    expect(inflationGap(0.01, null)).toBeNull()
  })

  it('надёжность — одна формулировка в строке доверия и в сигнале; ряды цен без ставки', () => {
    const r = res([prod('a', { backtest: bt(2, 0.3) }), prod('b', { backtest: bt(0.5, 0.9) })])
    expect(trustText(r.products)).toContain('надёжен 1 · осторожно 0 · ненадёжен 1 из 2 позиций')
    expect(buildSignals(input({ res: r })).find((x) => x.key === 'calibration')?.title).toBe('Надёжность прогноза цен: надёжен 1 · осторожно 0 · ненадёжен 1 из 2')
  })

  it('мета-строка сигналов — по уровням', () => {
    expect(severityMeta([{ severity: 'info' }, { severity: 'info' }, { severity: 'missing' }])).toBe('0 требуют решения · 2 к сведению · 1 не рассчитано')
    expect(severityMeta([{ severity: 'crit' }, { severity: 'warn' }])).toBe('1 требует решения · 1 требует внимания')
  })
})

describe('вердикт и календарь', () => {
  it('одна фраза: сбыт, сырьё, вывод для маржи, ставка с интервалом', () => {
    const r = res([prod('a', { p50: [100, 107.6] }), prod('b', { p50: [100, 107.6] })])
    expect(headlineText({ res: r, by: 'к марту 2027' }))
      .toBe(`К марту 2027 цены сбыта +7,6${NBSP}%; ставка ЦБ — около 13,5${NBSP}% (8 из 10 исходов: 11,4–18,1${NBSP}%).`)
    const both = res([prod('a', { p50: [100, 120] }), prod('r', { role: 'raw', p50: [100, 115] })])
    expect(headlineText({ res: both, by: 'к марту 2027' }))
      .toContain(`цены сбыта +20${NBSP}%, сырьё +15${NBSP}% — сбыт обгоняет сырьё на ~5${NBSP}п.${NBSP}п., маржа скорее растёт`)
    expect(headlineText({ res: r, by: 'к марту 2027', stress: 'Как 2022' })).toMatch(/^В условиях «Как 2022» к марту 2027/)
  })

  it('диапазон плитки: знаки у обеих границ, одна единица, не рвётся', () => {
    expect(signedRangeText(-0.152, 0.696, 0)).toBe(`от${NBSP}−15${NBSP}до${NBSP}+70${NBSP}%`)
    expect(signedRangeText(0.02, 0.081, 1)).toBe(`от${NBSP}+2${NBSP}до${NBSP}+8,1${NBSP}%`)
  })

  it('медиана по позициям и типичная полоса', () => {
    const m = priceMove([prod('a', { p10: [100, 95], p50: [100, 110], p90: [100, 130] }), prod('b', { role: 'raw' })], 'product')!
    expect(m).toMatchObject({ n: 1 })
    expect(m.median).toBeCloseTo(0.1)
    expect(m.lo).toBeCloseTo(-0.05)
    expect(m.index[0]).toBe(100)
    expect(m.index[1]).toBeCloseTo(110)
  })

  it('календарь от последнего наблюдения ЦБ', () => {
    expect(horizonBy('2026-09', 6)).toBe('к марту 2027')
    expect(horizonBy(null, 6)).toBe(`за 6${NBSP}мес`)
    const label = calendarLabel('2026-09')
    expect(label(0)).toMatch(/^сейчас · сент\./)
    expect(label(6)).toMatch(/^март/)
  })
})
