/**
 * Откуда панель берёт ходы (UX-V2 §4.7.2, честная граница A1 §5–6):
 * · `result.moves` с ходами — настоящий пакет агента L2 (правило «RL»);
 * · `result.moves` без ходов — «агент не нашёл ходов лучше правила/ГА» (пустое состояние);
 * · `moves` нет (правило не «RL» или политика не опубликована) — пример на фикстурах,
 *   подписанный «пример», с причиной недоступности RL.
 */
import type { MovesResult, ScheduleResult } from '../../../lib/api'
import { DEMO_PREFIX } from './decisionsStore'
import { demoMoves } from './fixtures'

export type MovesSourceKind = 'agent' | 'agent-empty' | 'demo' | 'none'

export interface MovesSource {
  kind: MovesSourceKind
  moves: MovesResult | null
  /** Ключ сессии решений: прогон или «demo:<прогон>». */
  runKey: string
}

export function movesSource(result: ScheduleResult): MovesSource {
  const runKey = result.plan_id || `local-${result.n_jobs}-${result.rule}`
  const m = result.moves
  if (m && m.moves.length > 0) return { kind: 'agent', moves: m, runKey }
  if (m) return { kind: 'agent-empty', moves: m, runKey }
  const demo = demoMoves(result)
  return demo ? { kind: 'demo', moves: demo, runKey: `${DEMO_PREFIX}${runKey}` } : { kind: 'none', moves: null, runKey }
}
