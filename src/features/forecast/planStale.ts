/**
 * Устарел ли план — те же признаки, что у полосы методологии (X2 «устарело ▲»): узел «План» карты
 * устарел, портфель, по которому строили, устарел, справочники или сценарий изменены после построения.
 * Чистая функция — vitest.
 */
import { isStale } from '../../shell/context'
import { liveOf } from '../method-map/deriveState'
import type { MethodMapState } from '../method-map/types'

export interface StaleInput {
  state: MethodMapState
  builtAt: number | null
  /** План строили по портфелю (есть прогон «Оптимизации»). */
  fromPortfolio: boolean
  portfolioAt: number | null
  changed: { scenario?: number; nsi?: number }
}

/** Почему план устарел — словами; null — актуален (или плана в хранилище нет). */
export function planStaleReason({ state, builtAt, fromPortfolio, portfolioAt, changed }: StaleInput): string | null {
  if (!builtAt) return null
  const plan = liveOf(state, 'dec.schedule')
  if (plan.state === 'stale') return plan.reason ?? 'вход изменился после построения плана'
  const pf = liveOf(state, 'dec.portfolio')
  if (fromPortfolio && pf.state === 'stale') return pf.reason ?? 'портфель устарел'
  if (isStale(builtAt, changed.nsi)) return 'справочники изменились после построения плана'
  if (isStale(builtAt, changed.scenario) || (fromPortfolio && isStale(portfolioAt, changed.scenario))) return 'сценарий изменён после построения плана'
  return null
}
