/**
 * Сессионное хранилище решений по ходам и выбранного хода — общее для панели «Структурные ходы»
 * и дифа Ганта/маршрута (клавиши a/x/f на дифе и кнопки в панели меняют одно состояние).
 * Ключ — прогон (plan_id или «demo» для примера); смена прогона — чистое состояние.
 * Отклонение с причиной и заморозка настоящих ходов дополнительно пишутся в полномочия агента
 * (персональные маски, UX-V2 §4.10), потому что `POST /api/runs/:id/moves/decide` бэкенд ещё не
 * реализовал (A1 §7 п. 4); решения по примеру остаются только в сессии.
 */
import { useSyncExternalStore } from 'react'
import type { StructuralMove } from '../../../lib/api'
import { addFrozen, addRejectedMask } from '../../agents/guardrails'
import { getGuardrails, saveGuardrails } from '../../agents/guardrailsStore'
import { moveLabel } from './moveKinds'
import { EMPTY_DECISIONS, clearDecision, decide, type DecideResult, type Decision, type DecisionState } from './movesStore'

export interface MovesSession {
  runKey: string
  decisions: DecisionState
  selectedId: string | null
  /** Последнее сообщение для живого региона («принят пакетом с …»). */
  notice: string | null
}

/** Префикс ключа сессии примера (movesSource: `demo:<прогон>`). */
export const DEMO_PREFIX = 'demo:'

let state: MovesSession = { runKey: '', decisions: EMPTY_DECISIONS, selectedId: null, notice: null }
const listeners = new Set<() => void>()

function commit(next: MovesSession): void {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): MovesSession => state

/** Сессия для прогона; другой прогон — новое чистое состояние. */
export function useMovesSession(runKey: string): MovesSession {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  return s.runKey === runKey ? s : { runKey, decisions: EMPTY_DECISIONS, selectedId: null, notice: null }
}

function ensureRun(runKey: string): MovesSession {
  return state.runKey === runKey ? state : { runKey, decisions: EMPTY_DECISIONS, selectedId: null, notice: null }
}

const label = (moves: readonly StructuralMove[], ids: readonly string[]) =>
  ids.map((id) => { const m = moves.find((x) => x.id === id); return `«${m ? moveLabel(m.kind) : id}»` }).join(', ')

export const movesActions = {
  select(runKey: string, id: string | null): void {
    const cur = ensureRun(runKey)
    if (cur.selectedId === id && cur === state) return
    commit({ ...cur, selectedId: id })
  },

  /**
   * Решение по ходу. Принятие с непринятыми родителями применяет пакет (родители + ход) —
   * в notice это сказано явно; отклонение каскадом снимает зависимых.
   */
  decide(runKey: string, moves: readonly StructuralMove[], id: string, decision: Decision, reason?: string): DecideResult {
    const cur = ensureRun(runKey)
    const r = decide(cur.decisions, moves, id, decision, { reason, cascade: true })
    const parents = decision === 'accept' ? Object.keys(r.state.decisions).filter((k) => !(k in cur.decisions) && k !== id) : []
    const notice = parents.length ? `Принят пакетом вместе с ${label(moves, parents)}`
      : r.cascaded.length ? `Отклонены зависимые: ${label(moves, r.cascaded)}` : null
    commit({ ...cur, decisions: r.state, notice })
    // Пример на фикстурах не пишет в полномочия проекта: маски — только от настоящих ходов агента.
    const move = runKey.startsWith(DEMO_PREFIX) ? undefined : moves.find((m) => m.id === id)
    if (move && decision === 'reject') void saveGuardrails(addRejectedMask(getGuardrails(), move, reason ?? 'другое'))
    if (move && decision === 'freeze') void saveGuardrails(addFrozen(getGuardrails(), move, reason))
    return r
  },

  /** Набор решений целиком (например, «принять все безопасные»). */
  setDecisions(runKey: string, decisions: DecisionState, notice: string | null = null): void {
    commit({ ...ensureRun(runKey), decisions, notice })
  },

  clear(runKey: string, id: string): void {
    const cur = ensureRun(runKey)
    commit({ ...cur, decisions: clearDecision(cur.decisions, id), notice: null })
  },

  /** Только для тестов. */
  reset(): void {
    commit({ runKey: '', decisions: EMPTY_DECISIONS, selectedId: null, notice: null })
  },
}
