/**
 * Вердикт результата плана одной строкой (X2 «ответ сначала»): срок, хвост риска словами с
 * названным уровнем α, горизонт Стадии 2, заказы в срок, узкое место. Отклонения помечаются,
 * нормальное состояние — нейтрально. Числа — только через src/explain/format.ts. Чистые функции.
 */
import type { ScheduleResult } from '../../lib/api'
import { hours, num, pct, plural } from '../../explain/format'

/** Порог перегрузки узкого места: доля фонда, выше которой — ▲ «перегрузка» (единое определение экрана). */
export const OVERLOAD = 0.85

export interface VerdictPart {
  key: string
  text: string
  /** Отклонение (▲ + слово рядом), иначе нейтрально. */
  warn?: boolean
}

const SUB: Readonly<Record<string, string>> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' }

/** «CVaR₉₀» для α = 0,1: подпись уровня — доля сценариев, которые хвост НЕ включает. */
export function cvarName(alpha: number): string {
  const level = Math.round((1 - (Number.isFinite(alpha) && alpha > 0 && alpha < 1 ? alpha : 0.1)) * 100)
  return `CVaR${String(level).split('').map((d) => SUB[d] ?? d).join('')}`
}

/** «10 % худших» по α. */
export const tailShare = (alpha: number): string => pct(Number.isFinite(alpha) && alpha > 0 ? alpha : 0.1, 0)

export function planVerdict(r: ScheduleResult): VerdictPart[] {
  const k = r.kpi
  const mean = k.makespan_mean
  const parts: VerdictPart[] = [
    { key: 'cmax', text: `План ${hours(mean)} (≈ ${num(mean / 24, 0)}${' '}сут)` },
  ]
  const horizon = r.portfolio_horizon_hours ?? 0
  const tail = `в ${tailShare(r.alpha)} худших сценариев — в среднем ${hours(k.makespan_cvar, 0)}`
  if (horizon > 0 && k.makespan_cvar > horizon) {
    parts.push({ key: 'tail', text: `${tail}, за горизонтом Стадии 2 (${hours(horizon, 0)})`, warn: true })
  } else {
    parts.push({ key: 'tail', text: horizon > 0 ? `${tail}, в горизонте Стадии 2` : tail })
  }
  const n = r.n_orders
  const late = Math.max(0, k.n_late)
  parts.push(late === 0
    ? { key: 'otd', text: `${n === 1 ? 'заказ' : `все ${num(n, 0)} ${plural(n, 'заказ', 'заказа', 'заказов')}`} в срок` }
    : { key: 'otd', text: `${num(late, 0)} из ${num(n, 0)} ${plural(n, 'заказа', 'заказов', 'заказов')} с опозданием`, warn: true })
  const bn = r.bottleneck
  if (bn?.wc_name) {
    const over = bn.utilization >= OVERLOAD
    parts.push({ key: 'bn', text: `узкое место — ${bn.wc_name} (${pct(bn.utilization, 0)}${over ? ', перегрузка' : ''})`, warn: over })
  }
  return parts
}

export function verdictText(parts: readonly VerdictPart[]): string {
  return parts.map((p) => p.text).join('; ')
}
