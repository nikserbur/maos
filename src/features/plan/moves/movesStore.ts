/**
 * Решения пользователя по структурным ходам агента (UX-V2 §4.7.2): принять / отклонить (с причиной) /
 * заморозить. Чистые функции над иммутабельным состоянием: зависимости `depends_on` принимаются
 * пакетом (принятие зависимого требует родителя, отклонение родителя снимает зависимых),
 * «принять все безопасные» = win_share ≥ 0,75 и ДИ выше нуля без заморозок. Бэкенд
 * `POST /api/runs/:id/moves/decide` ещё не реализован (A1 §7 п. 4) — решения живут в сессии и
 * применяются к дифу на фронтенде (diff/applyMoves.ts).
 */
import type { MoveImpact, MoveStatus, StructuralMove } from '../../../lib/api'

export type Decision = 'accept' | 'reject' | 'freeze'

export interface DecisionState {
  decisions: Readonly<Record<string, Decision>>
  reasons: Readonly<Record<string, string>>
}

export const EMPTY_DECISIONS: DecisionState = { decisions: {}, reasons: {} }

/** Порог «безопасного» хода (§4.7.2 «Принять все безопасные»). */
export const SAFE_WIN_SHARE = 0.75

export const REJECT_REASONS: readonly string[] = ['неприемлемо для заказчика', 'нет поставщика', 'другое']

const DECISION_STATUS: Readonly<Record<Decision, MoveStatus>> = { accept: 'accepted', reject: 'rejected', freeze: 'frozen' }

/** Статус хода с учётом решения пользователя (решение перекрывает статус из ответа). */
export function statusOf(move: StructuralMove, state: DecisionState): MoveStatus {
  const d = state.decisions[move.id]
  return d ? DECISION_STATUS[d] : move.status
}

const byId = (moves: readonly StructuralMove[]) => new Map(moves.map((m) => [m.id, m]))

/** Транзитивные родители (ходы, без которых этот не имеет смысла), ближние первыми, без повторов. */
export function parentsOf(moves: readonly StructuralMove[], id: string): string[] {
  const map = byId(moves)
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [...(map.get(id)?.depends_on ?? [])]
  while (queue.length) {
    const next = queue.shift()!
    if (seen.has(next) || !map.has(next)) continue
    seen.add(next)
    out.push(next)
    queue.push(...(map.get(next)?.depends_on ?? []))
  }
  return out
}

/** Транзитивные зависимые (кому нужен этот ход). */
export function dependantsOf(moves: readonly StructuralMove[], id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const m of moves) {
      if (seen.has(m.id) || !(m.depends_on ?? []).includes(cur)) continue
      seen.add(m.id)
      out.push(m.id)
      queue.push(m.id)
    }
  }
  return out
}

export interface DecideResult {
  state: DecisionState
  /** Родители, которых нужно принять первыми (решение не применено). */
  needs: string[]
  /** Зависимые, отклонённые каскадом. */
  cascaded: string[]
}

const withDecision = (s: DecisionState, id: string, d: Decision, reason?: string): DecisionState => ({
  decisions: { ...s.decisions, [id]: d },
  reasons: reason ? { ...s.reasons, [id]: reason } : s.reasons,
})

/**
 * Принять / отклонить / заморозить ход. `cascade: true` — принять родителей вместе с ходом;
 * иначе при непринятых родителях решение не применяется и возвращается `needs`.
 */
export function decide(
  state: DecisionState, moves: readonly StructuralMove[], id: string, decision: Decision,
  opts: { reason?: string; cascade?: boolean } = {},
): DecideResult {
  const map = byId(moves)
  const move = map.get(id)
  if (!move) return { state, needs: [], cascaded: [] }

  if (decision === 'accept') {
    const needs = parentsOf(moves, id).filter((p) => state.decisions[p] !== 'accept' && map.get(p)!.status !== 'accepted' && map.get(p)!.status !== 'applied')
    if (needs.length && !opts.cascade) return { state, needs, cascaded: [] }
    let next = state
    for (const p of needs) next = withDecision(next, p, 'accept')
    return { state: withDecision(next, id, 'accept'), needs: [], cascaded: [] }
  }

  if (decision === 'reject') {
    const reason = opts.reason ?? REJECT_REASONS[REJECT_REASONS.length - 1]
    let next = withDecision(state, id, 'reject', reason)
    const cascaded = dependantsOf(moves, id).filter((d) => next.decisions[d] !== 'reject')
    for (const d of cascaded) next = withDecision(next, d, 'reject', 'зависит от отклонённого хода')
    return { state: next, needs: [], cascaded }
  }

  return { state: withDecision(state, id, 'freeze', opts.reason), needs: [], cascaded: [] }
}

/** Снять решение (вернуть ход в «предложено»). */
export function clearDecision(state: DecisionState, id: string): DecisionState {
  if (!(id in state.decisions)) return state
  const { [id]: _d, ...decisions } = state.decisions
  const { [id]: _r, ...reasons } = state.reasons
  return { decisions, reasons }
}

/** Безопасный ход: доля выигрышных сценариев ≥ 0,75 и нижняя граница ДИ выигрыша > 0. */
export function isSafe(move: StructuralMove): boolean {
  return move.impact.win_share >= SAFE_WIN_SHARE && move.impact.ci95[0] > 0
}

/** «Принять все безопасные»: предложенные безопасные ходы, чьи родители тоже безопасны; заморозки не трогаются. */
export function acceptSafe(state: DecisionState, moves: readonly StructuralMove[]): { state: DecisionState; accepted: string[] } {
  const map = byId(moves)
  let next = state
  const accepted: string[] = []
  for (const m of moves) {
    if (statusOf(m, next) !== 'proposed' || !isSafe(m)) continue
    const parents = parentsOf(moves, m.id)
    if (parents.some((p) => !isSafe(map.get(p)!) || statusOf(map.get(p)!, next) === 'frozen' || statusOf(map.get(p)!, next) === 'rejected')) continue
    const r = decide(next, moves, m.id, 'accept', { cascade: true })
    next = r.state
    accepted.push(m.id)
  }
  return { state: next, accepted }
}

/** Вклад хода в цель: ΔCVaR прибыли (положительный — улучшение). */
export const cvarGain = (m: StructuralMove): number => m.impact.profit.cvar_after - m.impact.profit.cvar_before

/** Сортировка по вкладу в цель (CVaR) по убыванию (§4.7.2). */
export function sortByGain(moves: readonly StructuralMove[]): StructuralMove[] {
  return [...moves].sort((a, b) => cvarGain(b) - cvarGain(a))
}

export interface MovesSummary {
  proposed: number; accepted: number; rejected: number; frozen: number
  /** Σ ΔCVaR прибыли и Σ ΔCVaR кассы по принятым ходам — сумма вкладов, не совокупный эффект пакета. */
  gainAccepted: number; cashGainAccepted: number
  /** Виды ходов, выключенные полномочиями (нет ни одного предложения этого вида). */
  disabledKinds: number
}

export function summarize(moves: readonly StructuralMove[], state: DecisionState, allowed?: Readonly<Record<string, boolean>>): MovesSummary {
  const s: MovesSummary = { proposed: 0, accepted: 0, rejected: 0, frozen: 0, gainAccepted: 0, cashGainAccepted: 0, disabledKinds: 0 }
  for (const m of moves) {
    const st = statusOf(m, state)
    if (st === 'proposed') s.proposed += 1
    else if (st === 'accepted' || st === 'applied') {
      s.accepted += 1
      s.gainAccepted += cvarGain(m)
      s.cashGainAccepted += m.impact.cash.min_cash_cvar_after - m.impact.cash.min_cash_cvar_before
    } else if (st === 'rejected') s.rejected += 1
    else if (st === 'frozen') s.frozen += 1
  }
  s.disabledKinds = allowed ? Object.values(allowed).filter((v) => !v).length : 0
  return s
}

export interface MoveFilter { kind: string; status: 'all' | MoveStatus }

export function filterMoves(moves: readonly StructuralMove[], state: DecisionState, f: MoveFilter): StructuralMove[] {
  return moves.filter((m) => (f.kind === 'all' || m.kind === f.kind) && (f.status === 'all' || statusOf(m, state) === f.status))
}

/** Пустое воздействие (для заглушек и сумм). */
export const ZERO_IMPACT: MoveImpact = {
  profit: { e_before: 0, e_after: 0, cvar_before: 0, cvar_after: 0 },
  cash: { min_cash_cvar_before: 0, min_cash_cvar_after: 0, p_gap_before: 0, p_gap_after: 0 },
  schedule: { cmax_e_delta_h: 0, cmax_cvar_delta_h: 0, otd_delta: 0, tardiness_delta_h: 0 },
  win_share: 0, ci95: [0, 0],
}
