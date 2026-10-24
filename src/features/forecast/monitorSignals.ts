/**
 * Сигналы «Мониторинга» (X2 «исключения по важности», «честные состояния»): каждый сигнал — карточка
 * с важностью, заголовком, последствием для плана или денег и настоящими действиями; `short` — та же
 * мысль коротко для главного статуса («сырьё дорожает до +44 %»).
 *  - Цены: направление × роль. Сырьё дорожает или сбыт дешевеет ≥ 10 % — ▲; сбыт дорожает или сырьё
 *    дешевеет — ◆. На ступень ниже — только если проверка на истории провалена (`qualityOf` = bad) у
 *    большинства позиций; полоса по обе стороны от «сейчас» — вторичная метка «▲ ненадёжно», важность
 *    не трогает (на 13 месяцах широкая полоса почти всегда пересекает «сейчас»). Похожие позиции — одна карточка.
 *  - Источников нет — ○ «не рассчитано» с действием, а не ложное «всё в пределах порогов».
 *  - План устарел (признаки — из контекста решения и полосы методологии) — ▲ «Перестроить план»;
 *    план на другом сценарии — к сведению; инфляция движка расходится с генератором; веер ставки узковат.
 * Пороги — именованные константы; перегрузка — из «Плана» (OVERLOAD). Чистые функции — vitest.
 */
import type { ForecastProduct, ForecastResult, MacroHoldoutVar } from '../../lib/api'
import { NBSP, countText, dateTimeShort, freqText, num, pct, plural, pp } from '../../explain/format'
import { OVERLOAD } from '../plan/verdict'
import { runHref } from '../plan/planNav'
import { forecastDelta, qualityOf, qualitySummary, reliabilityCounts, reliabilityText } from './forecastModel'
import { narrowBand } from './macroModel'
import { monthsBetween } from '../scenarios/monthText'
import { SEVERITY, bandSpansNow, downgrade, monthName, moveText, type Severity } from './monitorModel'

/** Движение медианы к горизонту, с которого цена — сигнал. */
export const MOVE_ALERT = 0.1
/** Доля ненадёжных рядов цен, с которой это ▲, а не ◆. */
export const CALIBRATION_WARN_SHARE = 0.25
/** Кассовый разрыв: ▲ с 5 из 100 сценариев, ✕ с 15 из 100 (как плитка кассы «Плана»). */
export const CASH_GAP_WARN = 0.05
export const CASH_GAP_CRIT = 0.15
/** Заказы в срок: ▲ ниже 90 % (как плитка «Плана»), ✕ ниже 75 %. */
export const OTD_WARN = 0.9
export const OTD_CRIT = 0.75
/** Расхождение инфляции движка цен и генератора, г/г — с него сигнал. */
export const INFLATION_GAP = 0.02
/** План старше прогноза на столько дней — «к сведению: план построен давно». */
export const STALE_PLAN_DAYS = 7
/** Отставание данных ЦБ от текущего месяца, мес. */
export const CBR_LAG_MONTHS = 2
/** Карточек до «Ещё N сигналов» и позиций в карточке до «и ещё N». */
export const SIGNALS_SHOWN = 5
export const ITEMS_SHOWN = 3

const DAY_MS = 86_400_000
const POSITIONS = ['позиция', 'позиции', 'позиций'] as const

export type SignalAction =
  | { kind: 'href'; label: string; href: string }
  | { kind: 'open'; label: string; id: string }
  | { kind: 'filter'; label: string; ids: readonly string[]; title: string }
  | { kind: 'retry'; label: string }
  | { kind: 'whatif'; label: string }

/** Позиция в карточке: имя полностью слева, изменение — числом справа. */
export interface SignalItem { name: string; value?: string }

export interface Signal {
  key: string
  severity: Severity
  title: string
  /** Коротко для главного статуса и строки «Не рассчитано»: «сырьё дорожает до +44 %», «касса». */
  short: string
  items?: readonly SignalItem[]
  /** Сколько позиций не вошло в `items`. */
  more?: number
  /** Последствие для плана или денег — одна приглушённая строка. */
  consequence?: string
  /** Мета-строка: роль, горизонт, надёжность. */
  meta?: readonly string[]
  /** Для сортировки внутри важности: больше — выше. */
  impact: number
  /** Сигнал о качестве данных или модели (а не о деле): внутри важности — после деловых. */
  dataQuality?: boolean
  actions: readonly SignalAction[]
}

export interface PlanFacts {
  /** Номер плана для подписи («№28»); null — номер не числовой или плана нет. */
  planNo: string | null
  /** Ключ адреса результата (#/plan/run/<key>). */
  planKey: string | null
  otd: number | null
  nLate: number | null
  bottleneck: { name: string; load: number } | null
  cashGap: { p: number; ci: [number, number] | null } | null
  builtAt: number | null
  /** Сценарий, на котором построен план (через портфель); null — неизвестно или реестр заказов. */
  scenarioId: string | null
  scenarioName: string | null
  /** План устарел (вход изменился после расчёта) — причина словами; null — актуален или неизвестно. */
  stale: string | null
}

export const NO_PLAN: PlanFacts = {
  planNo: null, planKey: null, otd: null, nLate: null, bottleneck: null, cashGap: null, builtAt: null, scenarioId: null, scenarioName: null, stale: null,
}

export interface SignalInput {
  res: ForecastResult | null
  /** Прогноз не получен (ошибка, ответа нет). */
  forecastFailed: boolean
  /** Генератор ставки не ответил (текст — в «Подробнее» на карточке веера). */
  rateFailed: boolean
  plan: PlanFacts
  scenario: { id: string | null; name: string | null }
  hrefs: { forecast: string; conditions: string }
  /** «к марту 2027». */
  by: string
  /** Инфляция генератора г/г (доля), медиана за горизонт; null — генератора нет. */
  generatorCpi: number | null
  /** Когда рассчитан прогноз (ms). */
  forecastAt: number | null
  /** Последний месяц данных ЦБ и текущий месяц («YYYY-MM»). */
  cbrLast: string | null
  today: string | null
  /** Отложенная проверка генератора по ставке (сводка /macro/summary). */
  rateHoldout?: MacroHoldoutVar | null
  /** Считаем «что если», а не прогноз: проверка генератора к стрессу не относится. */
  stress?: boolean
}

/** «план №28» · «план от 24.10 17:36» · «последний план». */
export function planLabel(p: Pick<PlanFacts, 'planNo' | 'builtAt'>): string {
  if (p.planNo) return `план №${p.planNo}`
  return p.builtAt ? `план от ${dateTimeShort(p.builtAt)}` : 'последний план'
}

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`
const planHref = (p: PlanFacts, slug?: string) => (p.planKey ? runHref(p.planKey, slug) : '#/plan')

function planState(input: SignalInput): Signal[] {
  const { plan, scenario, forecastAt } = input
  const name = cap(planLabel(plan))
  const out: Signal[] = []
  if (plan.stale) {
    out.push({
      key: 'stale-plan', severity: 'warn', title: `${name} устарел`, short: 'план устарел', impact: 0.5,
      consequence: `${plan.stale} — заказы в срок, загрузка и касса посчитаны по прежним данным`,
      actions: [{ kind: 'href', label: 'Перестроить план →', href: '#/plan/new' }],
    })
  } else if (plan.builtAt && forecastAt && forecastAt - plan.builtAt > STALE_PLAN_DAYS * DAY_MS) {
    const days = Math.floor((forecastAt - plan.builtAt) / DAY_MS)
    out.push({
      key: 'stale-plan', severity: 'info', title: `${name} построен ${countText(days, ['день', 'дня', 'дней'])} назад`, short: 'план построен давно', impact: days,
      consequence: 'прогноз с тех пор пересчитан — план мог устареть', actions: [{ kind: 'href', label: 'Перестроить план →', href: '#/plan/new' }],
    })
  }
  if (plan.scenarioId && scenario.id && plan.scenarioId !== scenario.id) out.push({
    key: 'plan-scenario', severity: 'info', impact: 0.4, short: 'план на другом сценарии',
    title: `${name} построен на сценарии ${plan.scenarioName ? `«${plan.scenarioName}»` : 'другом'}`,
    consequence: `прогноз и сигналы цен — по сценарию «${scenario.name ?? 'Базовый'}», а план считали в других условиях`,
    actions: [{ kind: 'href', label: 'Открыть сценарий плана →', href: `#/scenarios/${encodeURIComponent(plan.scenarioId)}` }],
  })
  return out
}

function planSignals(input: SignalInput): Signal[] {
  const { plan } = input
  const out: Signal[] = []
  const hasPlan = Boolean(plan.planKey || plan.planNo || plan.otd !== null)
  if (!hasPlan) {
    return [{
      key: 'no-plan', severity: 'missing', title: 'План не построен', short: 'план', impact: 0,
      consequence: 'заказы в срок, загрузка участков и кассовый разрыв не отслеживаются',
      actions: [{ kind: 'href', label: 'Построить план →', href: '#/plan/new' }],
    }]
  }
  const meta = [cap(planLabel(plan))]
  if (plan.cashGap) {
    const p = plan.cashGap.p
    if (p >= CASH_GAP_WARN) out.push({
      key: 'cash', severity: p >= CASH_GAP_CRIT ? 'crit' : 'warn', title: `Кассовый разрыв ${freqText(p)} сценариев`, impact: p,
      short: `кассовый разрыв ${freqText(p)} сценариев`,
      consequence: 'плану может не хватить денег — проверьте кредитную линию и сроки закупок',
      meta, actions: [{ kind: 'href', label: 'Открыть кассу плана →', href: planHref(plan, 'cash') }],
    })
  } else {
    out.push({
      key: 'no-cash', severity: 'missing', title: 'Касса не рассчитана', short: 'касса', impact: 0,
      consequence: 'кассовый разрыв по плану не отслеживается', meta,
      actions: [{ kind: 'href', label: 'Рассчитать кассу →', href: planHref(plan, 'cash') }],
    })
  }
  if (plan.otd !== null && plan.otd < OTD_WARN) out.push({
    key: 'otd', severity: plan.otd < OTD_CRIT ? 'crit' : 'warn', title: `Вовремя только ${pct(plan.otd, 0)} заказов`, impact: 1 - plan.otd,
    short: `вовремя только ${pct(plan.otd, 0)} заказов`,
    consequence: plan.nLate ? `${countText(plan.nLate, ['заказ опоздает', 'заказа опоздают', 'заказов опоздают'])} — пересмотрите приоритеты или мощности` : 'часть заказов опоздает — пересмотрите приоритеты или мощности',
    meta, actions: [{ kind: 'href', label: 'Открыть план →', href: planHref(plan) }],
  })
  if (plan.bottleneck && plan.bottleneck.load >= OVERLOAD) out.push({
    key: 'overload', severity: 'warn', title: `Перегрузка участка «${plan.bottleneck.name}» — ${pct(plan.bottleneck.load, 0)}`, impact: plan.bottleneck.load,
    short: `перегрузка участка — ${pct(plan.bottleneck.load, 0)}`,
    consequence: `выше порога ${pct(OVERLOAD, 0)}: очередь растёт, сроки под риском`, meta,
    actions: [{ kind: 'href', label: 'Загрузка участков →', href: planHref(plan, 'load') }],
  })
  return [...out, ...planState(input)]
}

/* ── Цены: одна карточка на (роль, направление) ───────────────────────────── */

type Dir = 'up' | 'down'
interface GroupSpec { title: string; short: string; consequence: string; base: Severity }
const GROUP: Record<'product' | 'raw', Record<Dir, GroupSpec>> = {
  raw: {
    up: { title: 'Сырьё дорожает', short: 'сырьё дорожает', consequence: 'себестоимость в плане занижена — закупки обойдутся дороже', base: 'warn' },
    down: { title: 'Сырьё дешевеет', short: 'сырьё дешевеет', consequence: 'закупки могут обойтись дешевле плана', base: 'info' },
  },
  product: {
    down: { title: 'Цены сбыта падают', short: 'цены сбыта падают', consequence: 'выручка в плане завышена', base: 'warn' },
    up: { title: 'Цены сбыта растут', short: 'цены сбыта растут', consequence: 'выручка может оказаться выше плана', base: 'info' },
  },
}

interface Move { p: ForecastProduct; d: number; bad: boolean; spans: boolean }

const majority = (g: readonly Move[], f: (m: Move) => boolean) => g.filter(f).length * 2 > g.length

function moveSignal(role: 'product' | 'raw', dir: Dir, g: readonly Move[], by: string): Signal {
  const spec = GROUP[role][dir]
  const weak = majority(g, (m) => m.bad)
  const shaky = !weak && majority(g, (m) => m.spans)
  const worst = g[0].d
  const sev = weak ? downgrade(spec.base) : spec.base
  return {
    key: `move-${role}-${dir}`, severity: sev,
    title: `${spec.title}: ${countText(g.length, POSITIONS)} — на ${pct(MOVE_ALERT, 0)} и больше ${by} (до ${moveText(worst)})`,
    short: `${spec.short} до ${moveText(worst)}`,
    items: g.slice(0, ITEMS_SHOWN).map((m) => ({ name: m.p.name, value: moveText(m.d) })), more: Math.max(0, g.length - ITEMS_SHOWN),
    consequence: spec.consequence,
    meta: [
      role === 'raw' ? 'закупочные цены' : 'цены сбыта', 'медиана прогноза',
      ...(weak ? ['✕ ненадёжно: проверка на истории провалена у большинства позиций'] : shaky ? ['▲ ненадёжно: полоса допускает обратный знак'] : []),
    ],
    impact: Math.abs(worst) * g.length,
    actions: [
      { kind: 'filter', label: 'Показать в таблице ↓', ids: g.map((m) => m.p.id), title: spec.title },
      { kind: 'open', label: 'Открыть веер', id: g[0].p.id },
      ...(spec.base === 'warn' ? [{ kind: 'href' as const, label: 'Пересчитать портфель →', href: '#/optimization' }] : []),
    ],
  }
}

function moveSignals(res: ForecastResult, by: string): Signal[] {
  const moves: Move[] = res.products.flatMap((p) => {
    const d = forecastDelta(p)
    if (!d || Math.abs(d.value) < MOVE_ALERT || (p.role !== 'product' && p.role !== 'raw')) return []
    return [{ p, d: d.value, bad: qualityOf(p).level === 'bad', spans: bandSpansNow(p) }]
  })
  const out: Signal[] = []
  for (const role of ['raw', 'product'] as const) {
    for (const dir of ['up', 'down'] as const) {
      const g = moves.filter((m) => m.p.role === role && (dir === 'up' ? m.d > 0 : m.d < 0)).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      if (g.length > 0) out.push(moveSignal(role, dir, g, by))
    }
  }
  return out
}

function rateSignals(input: SignalInput, res: ForecastResult): Signal[] {
  if (input.rateFailed) return [{
    key: 'no-rate', severity: 'missing', title: 'Ставка ЦБ: генератор не ответил', short: 'ставка ЦБ', impact: 0,
    consequence: 'веер ставки не построен — причина на карточке «Ключевая ставка»', actions: [{ kind: 'retry', label: 'Повторить' }],
  }]
  const open = res.rate ? [{ kind: 'open' as const, label: 'Открыть веер', id: res.rate.id }] : []
  const narrow = input.stress ? null : narrowBand(input.rateHoldout)
  if (narrow !== null) return [{
    key: 'rate-quality', severity: 'warn', impact: 1, dataQuality: true, short: 'веер ставки узковат',
    title: `Веер ставки узковат: факт внутри ${num(Math.round(narrow * 10), 0)} из 10, норма 8`,
    consequence: 'реальный разброс ставки шире показанного — диапазон ставки в главной фразе занижен',
    meta: ['проверка генератора на отложенных данных ЦБ'], actions: open,
  }]
  if (res.rate && qualityOf(res.rate).level === 'bad') return [{
    key: 'rate-quality', severity: 'warn', title: 'Веер ставки ненадёжен', short: 'веер ставки ненадёжен', impact: 1, dataQuality: true,
    consequence: 'на скрытых месяцах проверки факт чаще выходил за полосу — реальный разброс ставки шире показанного', actions: open,
  }]
  return []
}

function forecastSignals(input: SignalInput): Signal[] {
  const { res, hrefs, by } = input
  if (!res) {
    return input.forecastFailed
      ? [{ key: 'no-forecast', severity: 'missing', title: 'Прогноз цен не рассчитан', short: 'прогноз цен', impact: 0, consequence: 'сигналы цен и внешних условий недоступны', actions: [{ kind: 'retry', label: 'Повторить' }] }]
      : []
  }
  const out: Signal[] = [...rateSignals(input, res)]
  const c = reliabilityCounts(res.products)
  const checked = c.total - c.none
  if (c.bad > 0) out.push({
    key: 'calibration', severity: c.bad / Math.max(1, checked) >= CALIBRATION_WARN_SHARE ? 'warn' : 'info',
    title: `Надёжность прогноза цен: ${reliabilityText(res.products)}`,
    short: `прогноз цен ненадёжен для ${num(c.bad, 0)} из ${num(c.total, 0)} ${plural(c.total, ['позиции', 'позиций', 'позиций'])}`,
    consequence: 'по ненадёжным позициям на скрытых месяцах проверки факт чаще выходил за полосу «8 из 10» или прогноз ошибался сильнее «как вчера» — держите запас',
    meta: [`проверка: последние ${num(qualitySummary(res.products).backtestK, 0)}${NBSP}мес скрыты от модели`], impact: c.bad, dataQuality: true,
    actions: [{ kind: 'href', label: 'Открыть проверку прогноза →', href: hrefs.forecast }],
  })
  out.push(...moveSignals(res, by))
  const gap = inflationGap(res.inflation_monthly, input.generatorCpi)
  if (gap) out.push({
    key: 'inflation', severity: 'warn', impact: Math.abs(gap.diff), dataQuality: true, short: 'инфляция в расчёте цен расходится с генератором',
    title: `Цены считаются с инфляцией ${pct(gap.engine, 1)} в год, генератор ждёт ${pct(gap.generator, 1)}`,
    consequence: `медианы цен ${gap.diff > 0 ? 'завышены' : 'занижены'} примерно на ${pp(Math.abs(gap.diff), { digits: 1 })} в год — задайте инфляцию в условиях сценария`,
    meta: ['инфляция в расчёте цен — значение движка по умолчанию, если в сценарии не задана'],
    actions: [{ kind: 'href', label: 'Условия сценария →', href: hrefs.conditions }, { kind: 'whatif', label: 'Проверить в «Что если…»' }],
  })
  return out
}

/** Инфляция движка (в месяц) против генератора (г/г): расхождение ≥ INFLATION_GAP — сигнал. */
export function inflationGap(engineMonthly: number | null | undefined, generatorYoy: number | null): { engine: number; generator: number; diff: number } | null {
  if (typeof engineMonthly !== 'number' || !Number.isFinite(engineMonthly) || generatorYoy === null || !Number.isFinite(generatorYoy)) return null
  const engine = Math.pow(1 + engineMonthly, 12) - 1
  const diff = engine - generatorYoy
  return Math.abs(diff) >= INFLATION_GAP ? { engine, generator: generatorYoy, diff } : null
}

function freshnessSignals({ cbrLast, today }: SignalInput): Signal[] {
  const lag = cbrLast && today ? monthsBetween(cbrLast, today) : Number.NaN
  if (!Number.isFinite(lag) || lag <= CBR_LAG_MONTHS) return []
  return [{
    key: 'cbr-lag', severity: 'info', title: `Последние данные ЦБ — за ${monthName(cbrLast)}`, short: 'данные ЦБ устарели', impact: lag, dataQuality: true,
    consequence: `новых наблюдений нет ${countText(lag, ['месяц', 'месяца', 'месяцев'])} — генератор стартует с устаревшей точки`,
    actions: [],
  }]
}

const RANK = (s: Severity) => SEVERITY[s].rank

/** Все сигналы по важности; внутри важности — сначала о деле (цены, план, касса), затем о качестве данных; дальше — по влиянию. */
export function buildSignals(input: SignalInput): Signal[] {
  return [...planSignals(input), ...forecastSignals(input), ...freshnessSignals(input)]
    .sort((a, b) => RANK(a.severity) - RANK(b.severity) || Number(Boolean(a.dataQuality)) - Number(Boolean(b.dataQuality)) || b.impact - a.impact)
}

/** Сколько сигналов каждой важности — для мета-строки раздела. */
export function severityCounts(signals: readonly Pick<Signal, 'severity'>[]): Record<Severity, number> {
  const c: Record<Severity, number> = { crit: 0, warn: 0, info: 0, missing: 0 }
  for (const s of signals) c[s.severity] += 1
  return c
}

/** «0 требуют решения · 2 требуют внимания · 3 к сведению · 1 не рассчитано»: «решения» — всегда, прочие нули опущены. */
export function severityMeta(signals: readonly Pick<Signal, 'severity'>[]): string {
  const c = severityCounts(signals)
  const parts = [
    `${num(c.crit, 0)} ${plural(c.crit, ['требует', 'требуют', 'требуют'])} решения`,
    c.warn ? `${num(c.warn, 0)} ${plural(c.warn, ['требует', 'требуют', 'требуют'])} внимания` : '',
    c.info ? `${num(c.info, 0)} к сведению` : '',
    c.missing ? `${num(c.missing, 0)} не рассчитано` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}
