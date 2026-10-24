/**
 * Слова экрана «Портфель» (X2 «ответ сначала», «честная неопределённость»): вердикт, критерий,
 * родословная прогона, сводка параметров, «устарело», проверка вне выборки, разрыв с LP и
 * заголовки-утверждения графиков. Чистые функции над готовым результатом — числа и логика
 * оптимизатора не меняются, только форматирование через src/explain/format.ts.
 */
import type { OptCandidate, OptResourceLoad } from '../../lib/api'
import { countText, dateTime, freqText, money, num, pct, signed } from '../../explain/format'
import { objectiveLabel, type OptResultExt } from './optTypes'
import type { OptForm } from './optStore'

/** Порог проверки вне выборки: хуже на 5 % — «▲ вне выборки хуже». */
export const OOS_GAP = 0.05
/** Загрузка типа оборудования «близко к пределу». */
export const HOT_LOAD = 0.8
/** Значения по умолчанию формы — те же, что подставляет запуск (поведение не меняется). */
export const DEFAULT_SAMPLES = 3000
const DEFAULT_ALPHA = 0.1
const DEFAULT_SHARE = 0.35
const DEFAULT_MONTHS = 12
const HOURS_PER_MONTH = 720
/** Сервер берёт не меньше 200 сценариев и долю в [0,1; 1] — сравнение формы с результатом учитывает то же. */
const MIN_SAMPLES = 200
const EPS = 1e-9

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const SCENARIOS = ['сценарий', 'сценария', 'сценариев'] as const
const PRODUCTS = ['изделие', 'изделия', 'изделий'] as const

/** Частота убытка: «в 35 из 100 сценариев», «ни в одном из 100 сценариев». */
export function lossFreqText(p: number): string {
  return `${freqText(p)} сценариев`
}

/** Критерий словами: «CVaR · α = 10 %», «E − λ·σ · λ = 0,5», «худший случай» (α — только у CVaR). */
export function criterionText(objective: string, alpha: number, lambda?: number | null): string {
  if (objective === 'cvar') return `${objectiveLabel('cvar')} · α = ${pct(alpha, 0)}`
  if (objective === 'meanvariance') {
    return typeof lambda === 'number' && Number.isFinite(lambda) ? `${objectiveLabel(objective)} · λ = ${num(lambda, 2)}` : objectiveLabel(objective)
  }
  return objectiveLabel(objective)
}

/** Вердикт одной строкой из готовых чисел результата. */
export function verdictText(r: OptResultExt): string {
  const m = r.robust.metrics
  const e = r.expected.metrics
  const loss = m.p_loss > 0 ? `убыток — ${lossFreqText(m.p_loss)}` : `убытка нет ${lossFreqText(0)}`
  const vs = Math.abs(e.cvar - m.cvar) > EPS ? ` против ${money(e.cvar)} у «макс. E»` : ''
  return `Выпускать ${countText(r.robust.diversification.n_products, PRODUCTS)}: в среднем ${signed(m.expected, '₽')}, ${loss}; ` +
    `в худших ${pct(r.alpha, 0)} в среднем ${money(m.cvar)}${vs}`
}

/** Родословная прогона: «#a1b2c3 · «Базовый» · E − λ·σ · N = 3 000 · 24.10.2026, 14:32». */
export function lineageText(r: OptResultExt, ranAt: number | null): string {
  return [
    r.run_id ? `#${r.run_id.slice(0, 6)}` : '',
    r.scenario_name ? `«${r.scenario_name}»` : '',
    objectiveLabel(r.objective),
    `N = ${num(r.samples, 0)}`,
    ranAt ? dateTime(ranAt) : '',
  ].filter(Boolean).join(' · ')
}

/** Сводка параметров формы для свёрнутой карточки: «Базовый · CVaR · α 10 % · 3 000 сценариев · доля ≤ 35 % · 12 мес». */
export function paramsSummary(form: OptForm, scenarioName: string | undefined): string {
  return [
    scenarioName || 'базовые цены НСИ',
    objectiveLabel(form.objective),
    form.objective === 'cvar' ? `α ${pct(Number(form.alpha) || DEFAULT_ALPHA, 0)}` : '',
    countText(Number(form.samples) || DEFAULT_SAMPLES, SCENARIOS),
    `доля ≤ ${pct(Number(form.maxShare) || DEFAULT_SHARE, 0)}`,
    `${num(Number(form.horizonMonths) || DEFAULT_MONTHS, 0)} мес`,
  ].filter(Boolean).join(' · ')
}

/** Параметры прогона, которыми сервер посчитал результат (так же, как их собирает запуск). */
function effective(form: OptForm) {
  return {
    scenario: form.scenarioId || '',
    objective: form.objective,
    alpha: Number(form.alpha) || DEFAULT_ALPHA,
    samples: Math.max(MIN_SAMPLES, Number(form.samples) || DEFAULT_SAMPLES),
    share: Math.min(1, Math.max(0.1, Number(form.maxShare) || DEFAULT_SHARE)),
    hours: (Number(form.horizonMonths) || DEFAULT_MONTHS) * HOURS_PER_MONTH,
  }
}

/** Что в форме отличается от параметров результата (пусто — результат свежий). */
export function staleFields(form: OptForm, r: OptResultExt): string[] {
  const f = effective(form)
  const out: string[] = []
  if (f.scenario !== (r.scenario_id || '')) out.push('сценарий')
  if (f.objective !== r.objective) out.push('критерий')
  if (Math.abs(f.alpha - r.alpha) > EPS) out.push('α')
  if (f.samples !== r.samples) out.push('число сценариев')
  if (Math.abs(f.share - r.max_share) > EPS) out.push('макс. доля')
  if (Math.abs(f.hours - r.horizon_hours) > EPS) out.push('горизонт')
  return out
}

/** Форма по параметрам результата — F5 восстанавливает тот же вид без ложного «устарело». */
export function formFromResult(r: OptResultExt): Partial<OptForm> {
  const objective = ['cvar', 'worstcase', 'meanvariance', 'minregret'].includes(r.objective) ? r.objective as OptForm['objective'] : 'cvar'
  return {
    scenarioId: r.scenario_id || '',
    objective,
    alpha: String(r.alpha),
    samples: String(r.samples),
    maxShare: String(r.max_share),
    horizonMonths: String(r.horizon_hours / HOURS_PER_MONTH),
  }
}

/* ── Проверка вне выборки: разрыв = (в выборке − вне) / |в выборке| ─────────── */

/** Вне выборки хуже больше чем на 5 % хотя бы по одной метрике. */
export function oosWorse(o: { gap_expected: number; gap_cvar: number }): boolean {
  return o.gap_expected > OOS_GAP || o.gap_cvar > OOS_GAP
}

/** E вне выборки: «на 8,8 % выше, чем в выборке». */
export function oosExpectedText(gap: number): string {
  const a = Math.abs(gap)
  if (a < 0.0005) return 'как в выборке'
  return gap < 0 ? `на ${pct(a, 1)} выше, чем в выборке` : `на ${pct(a, 1)} ниже, чем в выборке`
}

/** CVaR вне выборки: «на 1,6 % лучше» (у отрицательных чисел «выше» путает — говорим «лучше/хуже»). */
export function oosCvarText(gap: number): string {
  const a = Math.abs(gap)
  if (a < 0.0005) return 'как в выборке'
  return gap < 0 ? `на ${pct(a, 1)} лучше` : `на ${pct(a, 1)} хуже`
}

/* ── Разрыв LP ↔ эвристика (в процентах: 100·(LP − эвр.)/|эвр.|) ──────────── */

export interface GapView { glyph: '▲' | '▼' | '=' | ''; text: string; tone: 'up' | 'down' | 'zero' | 'none' }

export function exactGapView(v: number | null | undefined): GapView {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { glyph: '', text: '—', tone: 'none' }
  const a = Math.abs(v) / 100
  if (a < 0.0005) return { glyph: '=', text: 'совпадает', tone: 'zero' }
  return v > 0
    ? { glyph: '▲', text: `LP лучше на ${pct(a, 1)}`, tone: 'up' }
    : { glyph: '▼', text: `эвристика лучше на ${pct(a, 1)}`, tone: 'down' }
}

/** Значение разрыва для «i»: «+2,1 %» / «−0,4 %». */
export function exactGapValue(v: number | null | undefined): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return signed(v / 100, '%')
}

/* ── Заголовки-утверждения графиков ───────────────────────────────────────── */

/** «В 1 из 10 сценариев прибыль ниже −47 млн ₽». */
export function histogramTitle(alpha: number, varValue: number): string {
  const of = Number.isInteger(Math.round(alpha * 1e6) / 1e5) ? 10 : Number.isInteger(Math.round(alpha * 1e6) / 1e4) ? 100 : 1000
  return `${sentence(freqText(alpha, of))} сценариев прибыль ниже ${money(varValue)}`
}

/** Парето: на границе ли устойчивый портфель и сколько недоминируемых. */
export function paretoTitle(cands: ReadonlyArray<OptCandidate>): { title: string; meta: string } {
  const onFront = cands.some((c) => c.is_robust && c.is_pareto)
  const nPareto = cands.filter((c) => c.is_pareto).length
  return {
    title: onFront
      ? 'Устойчивый портфель — на границе: меньше риска ценой доходности'
      : 'Устойчивый портфель — внутри границы: его критерий — хвост, а не σ',
    meta: `${num(nPareto, 0)} недоминируемых из ${num(cands.length, 0)}`,
  }
}

/** Загрузка: «Мощности не ограничивают портфель: максимум 18 % — Резьбонарезной станок». */
export function loadTitle(rows: ReadonlyArray<OptResourceLoad>, nameOf: (id: string) => string): string {
  const top = [...rows].sort((a, b) => b.utilization - a.utilization)[0]
  if (!top) return 'Портфель не загружает оборудование'
  const name = nameOf(top.wc_type_id)
  if (top.utilization >= 1) return `Мощность — узкое место: ${name} загружен на ${pct(top.utilization, 0)}`
  if (top.utilization >= HOT_LOAD) return `Мощности близки к пределу: максимум ${pct(top.utilization, 0)} — ${name}`
  return `Мощности не ограничивают портфель: максимум ${pct(top.utilization, 0)} — ${name}`
}

/** Отметка времени журнала прогонов: сервер отдаёт «ГГГГ-ММ-ДД ЧЧ:ММ:СС» без зоны — это UTC. */
export function serverTime(s: string | null | undefined): number | null {
  const v = (s ?? '').trim()
  if (!v) return null
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}
