/**
 * Вероятностный вердикт инвестпроекта (волна A3, блок `crn` ответа POST /api/analytics/investment):
 * выбор оцениваемого кандидата, строки таблицы «все кандидаты + ничего не делать», тексты вердикта,
 * «проиграет, если…» и причины, почему оценки нет. Частоты — «в 7 из 100 сценариев», интервалы —
 * названные (95 %-ДИ, N). Ничего не применяется: экран только показывает вердикт движка.
 * Без DOM — vitest.
 */
import type { InvestCrn, InvestCrnCandidate } from '../../lib/api'
import { DASH, NBSP, freqText, money, num, pct, rangeText } from '../../explain/format'

export interface InvestRow {
  key: string
  label: string
  /** Кто предложил: выбран вами · теория ограничений · двойственные цены · загрузка. */
  source: string
  chosen: boolean
  baseline: boolean
  capex: number
  npvMean: number
  npvLo: number
  npvHi: number
  pNpvNeg: number
  pGap: number
  cashMinCvar: number
  paybackMonths: number | null
  /** null — у базы вердикта нет. */
  apply: boolean | null
  reason: string | null
}

const SOURCE: Readonly<Record<string, string>> = {
  user: 'выбран вами', toc: 'теория ограничений', dual: 'двойственные цены LP', load: 'по загрузке',
}

export function sourceLabel(source: string): string {
  return SOURCE[source] ?? 'предложен моделью'
}

/** «станок «Резьбонарезной»» · «модернизация «Фрезерный»». */
export function candidateLabel(c: InvestCrnCandidate, nameOfType: (id: string) => string): string {
  const name = nameOfType(c.cand.wc_type)
  return c.cand.kind === 'modernize' ? `модернизация «${name}»` : `станок «${name}»`
}

/** Оцениваемый кандидат: тип, выбранный в форме (сначала «выбран вами»), иначе лучший по E[ЧДД]. */
export function chosenCandidate(crn: InvestCrn | null | undefined, wcTypeId: string): InvestCrnCandidate | null {
  const list = crn?.candidates ?? []
  if (list.length === 0) return null
  const sameType = list.filter((c) => c.cand.kind === 'machine' && c.cand.wc_type === wcTypeId)
  const user = sameType.find((c) => c.cand.source === 'user')
  if (user) return user
  if (sameType.length) return sameType[0]
  return [...list].sort((a, b) => b.npv_mean - a.npv_mean)[0]
}

/** Все кандидаты (по убыванию E[ЧДД]) и строка «ничего не делать» внизу. */
export function investRows(crn: InvestCrn, chosen: InvestCrnCandidate | null, nameOfType: (id: string) => string): InvestRow[] {
  const list = [...(crn.candidates ?? [])].sort((a, b) => b.npv_mean - a.npv_mean)
  const rows: InvestRow[] = list.map((c) => ({
    key: c.cand.id, label: candidateLabel(c, nameOfType), source: sourceLabel(c.cand.source),
    chosen: c === chosen, baseline: false, capex: c.cand.capex,
    npvMean: c.npv_mean, npvLo: c.npv_ci95[0], npvHi: c.npv_ci95[1], pNpvNeg: c.p_npv_neg,
    pGap: c.p_cash_gap, cashMinCvar: c.cash_min_cvar, paybackMonths: c.payback_months,
    apply: c.apply, reason: c.reasons[0] ?? null,
  }))
  const ref = chosen ?? list[0]
  if (ref) {
    rows.push({
      key: 'none', label: 'ничего не делать', source: 'база сравнения', chosen: false, baseline: true, capex: 0,
      npvMean: 0, npvLo: Number.NaN, npvHi: Number.NaN, pNpvNeg: Number.NaN,
      pGap: ref.p_cash_gap_base, cashMinCvar: ref.cash_min_cvar_base, paybackMonths: null, apply: null, reason: null,
    })
  }
  return rows
}

/** «в 7 из 100 сценариев». */
export function freqScenarios(p: number): string {
  return Number.isFinite(p) ? `${freqText(p)} сценариев` : DASH
}

/** «7 из 100» — для таблицы. */
export function freqShort(p: number): string {
  if (!Number.isFinite(p)) return DASH
  return `${num(Math.round(Math.min(1, Math.max(0, p)) * 100), 0)} из 100`
}

/** «3 → 5 из 100 к базе» · «5 из 100, как без проекта». */
export function gapShiftText(c: InvestCrnCandidate): string {
  const k0 = Math.round(c.p_cash_gap_base * 100)
  const k1 = Math.round(c.p_cash_gap * 100)
  if (!Number.isFinite(k0) || !Number.isFinite(k1)) return DASH
  return k0 === k1 ? `${num(k1, 0)} из 100, как без проекта` : `${num(k0, 0)} → ${num(k1, 0)} из 100 к базе`
}

/** «95 %-ДИ 0,4–5,9 млн ₽ · N = 48». */
export function ciText(c: InvestCrnCandidate): string {
  return `95${NBSP}%-ДИ ${rangeText(c.npv_ci95[0], c.npv_ci95[1], '₽')} · N${NBSP}=${NBSP}${num(c.n, 0)}`
}

/** Вердикт словом + первая причина. */
export function verdictLine(c: InvestCrnCandidate): { word: string; reason: string } {
  if (c.apply) return { word: 'применять', reason: 'E[ЧДД] > 0, весь 95 %-ДИ выше нуля, касса в хвосте не хуже базы' }
  return { word: 'не применять', reason: c.reasons[0] ?? 'условия применения не выполнены' }
}

/** «Проиграет, если…» / «Выиграет, только если…» — что должно случиться, чтобы вердикт был ошибкой. */
export function loseIfText(c: InvestCrnCandidate, alpha: number | undefined): string {
  const tail = Number.isFinite(alpha) && alpha ? pct(alpha, 0) : '5 %'
  const neg = freqScenarios(c.p_npv_neg)
  if (c.apply) {
    return `Проиграет «ничего не делать», если сбудется худший хвост: в худших ${tail} сценариев E[ЧДД] = ${money(c.npv_cvar)}; ЧДД < 0 — ${neg}.`
  }
  return `Выиграет у «ничего не делать», только если ЧДД окажется у верхней границы 95 %-ДИ (${money(c.npv_ci95[1])}); сейчас ЧДД < 0 — ${neg}.`
}

export interface CrnNotice {
  title: string
  text: string
  /** Сырой текст движка — под «Подробнее». */
  detail?: string
}

/** Почему вероятностной оценки нет — простыми словами; null — оценка есть. */
export function crnNotice(crn: InvestCrn | null | undefined): CrnNotice | null {
  if (crn === undefined || crn === null) {
    return { title: 'Вероятностная оценка не запрашивалась', text: 'Показана только детерминированная оценка: один прогон «до» и «после» без сценариев.' }
  }
  if (crn.status === 'ok') {
    return (crn.candidates?.length ?? 0) === 0
      ? { title: 'Движку некого оценивать', text: 'Кандидатов на докупку или модернизацию не нашлось — проверьте, что у типа есть станки и заказы.' }
      : null
  }
  if (crn.status === 'no_orders') {
    return {
      title: 'Нет открытых заказов — оценивать нечего',
      text: 'Вероятностная оценка считает прирост прибыли на заказах. Задайте программу заказов («План» → «Новый план» → «Программа») и повторите.',
      detail: crn.reason,
    }
  }
  return { title: 'Вероятностная оценка не удалась', text: 'Детерминированная оценка ниже посчитана; повторите расчёт позже.', detail: crn.reason }
}
