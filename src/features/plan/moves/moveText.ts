/**
 * Тексты строк ходов (UX-V2 §4.7.2): что затронуто — словами по Ганту прогона (заказ, операция,
 * станок), «до → после» по снимкам `before/after` и знак вклада в цель. Чистые функции; числа —
 * только через src/explain/format.ts.
 */
import type { GanttJob, MoveImpact, StructuralMove } from '../../../lib/api'
import { hours, money, pct, signed } from '../../../explain/format'
import { moveKindMeta } from './moveKinds'

/** Цели хода словами: «заказ #3 · оп. Точение · Станок 2» по полосам Ганта. */
export function targetText(move: StructuralMove, gantt: readonly GanttJob[]): string {
  const t = move.targets
  const parts: string[] = []
  const orders = t.order_idx ?? []
  if (orders.length) {
    const product = gantt.find((g) => g.order_idx === orders[0])?.product_name
    parts.push(`${orders.length > 1 ? 'заказы' : 'заказ'} ${orders.map((o) => `#${o}`).join(', ')}${product ? ` «${product}»` : ''}`)
  }
  for (const op of t.op_ids ?? []) {
    const g = gantt.find((x) => x.op_id === op && (!orders.length || orders.includes(x.order_idx)))
    parts.push(`оп. ${g?.op_name ?? op}`)
  }
  for (const m of t.machine_ids ?? []) parts.push(gantt.find((g) => g.machine_id === m)?.machine_name ?? m)
  if (!parts.length && move.kind === 'finance') parts.push('кредитная линия')
  return parts.join(' · ') || '—'
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** Что меняется «до → после» по снимкам хода (одной строкой). */
export function changeText(move: StructuralMove, gantt: readonly GanttJob[]): string {
  const b = move.before
  const a = move.after
  const rb = num(b.release_hours)
  const ra = num(a.release_hours)
  if (rb !== null && ra !== null) return `запуск ${hours(rb, 0)} → ${hours(ra, 0)} (${signed(ra - rb, 'ч')})`
  if (a.outsourced === true) return `→ закупка${str(a.supplier) ? ` · ${str(a.supplier)}` : ''}${num(a.lead_h) !== null ? `, срок ${hours(num(a.lead_h), 0)}` : ''}`
  const nb = num(b.n_batches)
  const na = num(a.n_batches)
  if (na !== null) return `партий ${nb ?? 1} → ${na}`
  const mb = str(b.machine_id)
  const ma = str(a.machine_id)
  if (ma) {
    const name = (id: string | null) => (id ? gantt.find((g) => g.machine_id === id)?.machine_name ?? id : '—')
    return `${name(mb)} → ${str(a.machine_name) ?? name(ma)}`
  }
  const tb = num(b.tranche_share)
  const ta = num(a.tranche_share)
  if (ta !== null) return `транш ${pct(tb ?? 0, 0)} → ${pct(ta, 0)} лимита${num(a.week) !== null ? `, неделя ${num(a.week)}` : ''}`
  return moveKindMeta(move.kind).what
}

/** Пара «до → после» деньгами. */
export const pair = (before: number, after: number): string => `${money(before)} → ${money(after)}`

/** Вклад в цель: ΔCVaR прибыли (> 0 — улучшение). */
export const profitDelta = (i: MoveImpact): number => i.profit.cvar_after - i.profit.cvar_before
export const cashDelta = (i: MoveImpact): number => i.cash.min_cash_cvar_after - i.cash.min_cash_cvar_before

/** Глиф строки: ▲ улучшение по цели и ДИ выше нуля, ■ — риск (ДИ задевает ноль или хуже). */
export function riskGlyph(i: MoveImpact): 'up' | 'risk' {
  return profitDelta(i) > 0 && i.ci95[0] > 0 ? 'up' : 'risk'
}

export const ciText = (i: MoveImpact): string => `ДИ 95 % [${signed(i.ci95[0], '₽')}; ${signed(i.ci95[1], '₽')}]`
