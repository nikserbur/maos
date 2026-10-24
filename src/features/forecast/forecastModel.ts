/**
 * Модель прогноза — общая для «Сценарии › Прогноз цен» и «Мониторинга» (X2 «честная
 * неопределённость»): один `qualityOf` на весь код, качество словами с частотами («попадание 5 из 6
 * мес · лучше «как вчера» на 39 %»), Δ медианы — от «сейчас» (последней точки истории), а не от базы
 * справочника; индекс «сейчас = 100» для сравнимых малых кратных; отбор «требуют внимания».
 * Чистые функции — vitest. Числа — только через src/explain/format.ts.
 */
import type { ForecastFit, ForecastProduct } from '../../lib/api'
import { DASH, NBSP, money, num, pct, plural, pp } from '../../explain/format'
import { fitLabel } from '../../explain/labels'
import type { FanRefLine, FanSeries } from '../../ui/charts'

/** Номинальное покрытие полосы P10–P90. */
export const COVERAGE_NOMINAL = 0.8
const COVERAGE_BAD = 0.5
const COVERAGE_WARN = 0.7
const SKILL_BAD = -0.5
/** Разница «база справочника ↔ сейчас», выше которой база рисуется пунктиром. */
const BASE_LINE_GAP = 0.02
/** Сколько вееров в «Требуют внимания». */
export const ATTENTION_N = 6

export type QualityLevel = 'ok' | 'warn' | 'bad' | 'none'

export interface SeriesQuality {
  level: QualityLevel
  /** Доля ошибки, снятой относительно наивного «как вчера»: 1 − ratio; < 0 — хуже наивного. */
  skill: number | null
  /** Ошибка модели к ошибке «как вчера» (×): < 1 — точнее наивного. */
  ratio: number | null
  coverage80: number | null
  /** Окно проверки (последние k месяцев скрыты от модели). */
  backtestK: number
  /** Прокси CRPS — среднее пинбол-потерь P10/P90 (в «i»). */
  crps: number | null
  /** Фраза качества без глифа (глиф рисует компонент). */
  sentence: string
}

/** «в 3 раза», «в 1,4 раза», «в 5 раз». */
export function timesText(ratio: number): string {
  const digits = ratio >= 2 ? 0 : 1
  const r = Math.round(ratio * 10 ** digits) / 10 ** digits
  return `в ${num(r, digits)} ${plural(r, ['раз', 'раза', 'раз'])}`
}

/** «5 из 6 мес» — сколько фактов окна проверки попало в полосу. */
export function hitsText(coverage: number, k: number): string {
  return `${num(Math.round(coverage * k), 0)} из ${num(k, 0)} мес`
}

export function qualitySentence(level: QualityLevel, ratio: number | null, coverage: number | null, k: number): string {
  if (level === 'none' || ratio === null || coverage === null) return 'качество не проверено'
  // Одна строка ≤ 60 знаков (карточка малых кратных): попадание и сторона «как вчера»; во сколько раз — в «i».
  const vsNaive = ratio > 1 ? 'хуже «как вчера»' : 'точнее «как вчера»'
  if (coverage < COVERAGE_WARN) return `факт в полосе ${hitsText(coverage, k)} (норма ${num(Math.round(COVERAGE_NOMINAL * k), 0)}) · ${vsNaive}`
  return `факт в полосе ${hitsText(coverage, k)} · ${vsNaive}`
}

/** Качество ряда по бэктесту: bad — skill < −0,5 или покрытие < 50 %; warn — skill < 0 или покрытие < 70 %. */
export function qualityOf(p: Pick<ForecastProduct, 'backtest'>): SeriesQuality {
  const b = p.backtest
  if (!b) return { level: 'none', skill: null, ratio: null, coverage80: null, backtestK: 0, crps: null, sentence: qualitySentence('none', null, null, 0) }
  const ratio = b.skill
  const skill = 1 - ratio
  const cov = b.coverage80
  const level: QualityLevel = skill < SKILL_BAD || cov < COVERAGE_BAD ? 'bad' : skill < 0 || cov < COVERAGE_WARN ? 'warn' : 'ok'
  return { level, skill, ratio, coverage80: cov, backtestK: b.k, crps: (b.pinball10 + b.pinball90) / 2, sentence: qualitySentence(level, ratio, cov, b.k) }
}

/**
 * Один словарь надёжности веера (таблица, карточки, «Внешние условия», сводки): ✕ ненадёжен ·
 * ▲ осторожно · ● надёжен · ○ не проверен. Цвет — только у отклонения, на глифе.
 */
export const QUALITY_MARK: Readonly<Record<QualityLevel, { glyph: '✕' | '▲' | '●' | '○'; word: string }>> = {
  bad: { glyph: '✕', word: 'ненадёжен' },
  warn: { glyph: '▲', word: 'осторожно' },
  ok: { glyph: '●', word: 'надёжен' },
  none: { glyph: '○', word: 'не проверен' },
}

export function qualityMark(level: QualityLevel): { glyph: string; word: string } {
  return QUALITY_MARK[level]
}

/** Подпись подобранного распределения — из общего словаря. */
export function fitText(fit: ForecastFit | undefined): string {
  if (!fit?.data_driven) return DASH
  return fitLabel(fit.dist, 'short', { nu: fit.nu ?? null, alpha: fit.alpha ?? null })
}

/** AIC по распределениям, для которых он посчитан (подсказка «i»/title). */
export function aicTitle(fit: ForecastFit): string | undefined {
  const parts = ([['normal', fit.aic_normal], ['laplace', fit.aic_laplace], ['t', fit.aic_t], ['stable', fit.aic_stable]] as const)
    .filter((x): x is readonly [typeof x[0], number] => typeof x[1] === 'number' && Number.isFinite(x[1]))
  return parts.length ? `AIC: ${parts.map(([id, v]) => `${fitLabel(id)} ${num(v, 1)}`).join(' · ')}` : undefined
}

/** Ставка — проценты (значения ряда уже в %), цены — рубли. */
export const fmtFor = (p: Pick<ForecastProduct, 'role'>) => (p.role === 'rate' ? (v: number) => pct(v / 100, 1) : (v: number) => money(v))

export const monthLabel = (o: number): string => (o === 0 ? 'сейчас' : o > 0 ? `+${o}${NBSP}мес` : `−${-o}${NBSP}мес`)

/** «Сейчас» — последняя конечная точка истории, иначе стартовая медиана. */
export function nowValue(p: Pick<ForecastProduct, 'history' | 'p50'>): number {
  const h = p.history ?? []
  for (let i = h.length - 1; i >= 0; i--) if (Number.isFinite(h[i])) return h[i]
  return p.p50[0]
}

/** «+25 %» (0 знаков при |Δ| ≥ 10 %), «+4,3 %», «0 %» — без знака у нуля. */
export function signedPct(v: number, digits: number): string {
  const t = pct(v, digits)
  return v > 0 && !/^0[\s ]/.test(t) ? `+${t}` : t
}

export interface ForecastDelta {
  /** Доля (цены) или процентные пункты/100 (ставка). */
  value: number
  text: string
  /** «к горизонту +25 % от текущей». */
  label: string
  horizon: number
}

/** Δ медианы к горизонту от «сейчас»; ставка — в п. п. */
export function forecastDelta(p: Pick<ForecastProduct, 'role' | 'history' | 'p50'>): ForecastDelta | null {
  const last = p.p50.length - 1
  if (last < 0) return null
  const now = nowValue(p)
  const end = p.p50[last]
  if (!Number.isFinite(now) || !Number.isFinite(end)) return null
  if (p.role === 'rate') {
    const value = (end - now) / 100
    const text = pp(value, { signed: true, digits: 1 })
    return { value, text, label: `к горизонту ${text} от текущей`, horizon: last }
  }
  if (now <= 0) return null
  const value = end / now - 1
  const text = signedPct(value, Math.abs(value) >= 0.1 ? 0 : 1)
  return { value, text, label: `к горизонту ${text} от текущей`, horizon: last }
}

/** Пунктир «база НСИ 108 тыс. ₽», если база справочника заметно отличается от «сейчас». */
export function baseRefLine(p: Pick<ForecastProduct, 'role' | 'base' | 'history' | 'p50'>): FanRefLine | null {
  if (p.role === 'rate' || !(p.base > 0)) return null
  const now = nowValue(p)
  if (now > 0 && Math.abs(p.base / now - 1) < BASE_LINE_GAP) return null
  return { key: 'base', value: p.base, label: `база НСИ ${money(p.base)}` }
}

/** Веер в индексе «сейчас = 100» — малые кратные сравнимы на общей шкале. */
export function indexTo100(p: ForecastProduct): FanSeries {
  const now = nowValue(p)
  const k = now !== 0 && Number.isFinite(now) ? 100 / now : 1
  const sc = (a: ReadonlyArray<number> | undefined) => a?.map((v) => v * k)
  return { p10: sc(p.p10) ?? [], p50: sc(p.p50) ?? [], p90: sc(p.p90) ?? [], history: sc(p.history), trend: sc(p.trend) }
}

/** Границы общей шкалы индекса «сейчас = 100»: низ — не выше 80, верх — от 120 до 200. */
export const SHARED_LO_MAX = 80
export const SHARED_HI_MIN = 120
export const SHARED_HI_MAX = 200
/** Доля карточек, чей верх целиком помещается в шкалу (верх — их 75-й перцентиль). */
const SHARED_HI_Q = 0.75

const finiteOf = (s: FanSeries): number[] => [...s.p10, ...s.p90, ...(s.history ?? []), ...(s.trend ?? [])].filter(Number.isFinite)

/**
 * Общая шкала Y малых кратных (индекс «сейчас = 100»), устойчивая к выбросу: низ — min(80, min P10 и
 * истории), верх — 75-й перцентиль верхов карточек в пределах 120…200 (поле 4 %). Один ряд с полосой
 * до 480 больше не сжимает остальные веера в плоские линии внизу: его полоса обрезается рамкой, а
 * «↑ до 480» подписывает рисунок (Fan).
 */
export function sharedDomain(series: readonly FanSeries[]): readonly [number, number] {
  const per = series.map(finiteOf).filter((v) => v.length > 0)
  if (per.length === 0) return [0, 1]
  const lo = Math.min(SHARED_LO_MAX, ...per.map((v) => Math.min(...v)))
  const tops = per.map((v) => Math.max(...v)).sort((a, b) => a - b)
  const q = tops[Math.min(tops.length - 1, Math.ceil(SHARED_HI_Q * tops.length) - 1)]
  const hi = Math.min(SHARED_HI_MAX, Math.max(SHARED_HI_MIN, q))
  const pad = (hi - lo) * 0.04
  return [lo - pad, hi + pad]
}

/** Относительная ширина P10–P90 к горизонту. */
export function bandWidth(p: Pick<ForecastProduct, 'p10' | 'p50' | 'p90'>): number {
  const last = p.p50.length - 1
  const mid = p.p50[last]
  return mid > 0 ? (p.p90[last] - p.p10[last]) / mid : 0
}

const LEVEL_RANK: Record<QualityLevel, number> = { bad: 0, warn: 1, none: 2, ok: 3 }

/** «Требуют внимания»: худшие по качеству (до половины), остальное — самые широкие полосы. */
export function attentionSet(products: readonly ForecastProduct[], n = ATTENTION_N): ForecastProduct[] {
  const scored = products.map((p) => ({ p, q: qualityOf(p), w: bandWidth(p) }))
  const worst = scored.filter((x) => x.q.level === 'bad' || x.q.level === 'warn')
    .sort((a, b) => LEVEL_RANK[a.q.level] - LEVEL_RANK[b.q.level] || (b.q.ratio ?? 0) - (a.q.ratio ?? 0))
    .slice(0, Math.ceil(n / 2))
  const taken = new Set(worst.map((x) => x.p.id))
  const wide = scored.filter((x) => !taken.has(x.p.id)).sort((a, b) => b.w - a.w).slice(0, n - worst.length)
  return [...worst, ...wide].map((x) => x.p)
}

export interface QualitySummary {
  total: number
  /** Хуже наивного (ratio > 1). */
  worse: number
  covAvg: number | null
  covMin: number | null
  covMax: number | null
  /** Ряды с ненадёжным веером (bad). */
  bad: number
  /** Факт бэктеста чаще вне P10–P90, чем внутри (покрытие < 50 %). */
  outside: number
  backtestK: number
}

export function qualitySummary(products: readonly ForecastProduct[]): QualitySummary {
  const qs = products.map(qualityOf).filter((q) => q.level !== 'none')
  const covs = qs.map((q) => q.coverage80 ?? 0)
  return {
    total: qs.length,
    worse: qs.filter((q) => (q.ratio ?? 0) > 1).length,
    covAvg: covs.length ? covs.reduce((a, v) => a + v, 0) / covs.length : null,
    covMin: covs.length ? Math.min(...covs) : null,
    covMax: covs.length ? Math.max(...covs) : null,
    bad: qs.filter((q) => q.level === 'bad').length,
    outside: covs.filter((c) => c < COVERAGE_BAD).length,
    backtestK: qs[0]?.backtestK ?? 0,
  }
}

export interface ReliabilityCounts { ok: number; warn: number; bad: number; none: number; total: number }

/** Сколько рядов в каждой ступени надёжности (`qualityOf`) — одна сводка на весь код. */
export function reliabilityCounts(products: readonly Pick<ForecastProduct, 'backtest'>[]): ReliabilityCounts {
  const c: ReliabilityCounts = { ok: 0, warn: 0, bad: 0, none: 0, total: products.length }
  for (const p of products) c[qualityOf(p).level] += 1
  return c
}

/**
 * Надёжность одной формулировкой везде (главная фраза, сигнал, карта, «Сценарии»):
 * «надёжен 25 · осторожно 39 · ненадёжен 12 из 76»; «не проверен N» — только если такие есть.
 */
export function reliabilityText(products: readonly Pick<ForecastProduct, 'backtest'>[]): string {
  const c = reliabilityCounts(products)
  const parts = (['ok', 'warn', 'bad'] as const).map((l) => `${QUALITY_MARK[l].word} ${num(c[l], 0)}`)
  if (c.none > 0) parts.push(`${QUALITY_MARK.none.word} ${num(c.none, 0)}`)
  return `${parts.join(' · ')} из ${num(c.total, 0)}`
}

/** Медиана набора чисел (пусто → null). */
export function median(xs: readonly number[]): number | null {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length === 0) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export const FORECAST_ETA_S = 6
export const FORECAST_RUNS = 3000
export const FORECAST_BACKTEST = 6

/** Фазы расчёта прогноза — для RunProgress. */
export const FORECAST_PHASES = [
  { id: 'fit', title: 'Подбор тренда и распределений по истории', weight: 0.25, mapNode: 'mon.forecast' },
  { id: 'mc', title: `Монте-Карло: ${num(FORECAST_RUNS, 0)} путей цен`, weight: 0.5, mapNode: 'mon.forecast' },
  { id: 'backtest', title: 'Проверка на скрытых месяцах', weight: 0.25, mapNode: 'mon.quality' },
] as const
