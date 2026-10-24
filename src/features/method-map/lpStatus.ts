/**
 * Статус CVaR-LP с кассой (POST /api/optimize/cash, HiGHS) → живое состояние узла карты (X2 P-120).
 * Одна причина — один блок: лимит времени — это «не решено» (▲, пересчитать с большим лимитом), а не
 * две жёсткие ошибки; неразрешимость — ✕ с действием; сырой текст решателя — только в «Подробнее».
 * Чистые функции — проверяются тестом.
 */
import { NBSP, num } from '../../explain/format'
import { lpStatusLabel } from '../../explain/labels'
import type { NodeLive } from './types'

/** Лимит времени решателя по умолчанию (ExactCvar.h `timeLimitSec`). */
export const DEFAULT_LP_LIMIT_S = 30

/** Решение есть (оптимум или допустимое) — касса рассчитана. */
export function lpSolved(status: string | null | undefined): boolean {
  return status === 'optimal' || status === 'feasible'
}

/**
 * Нерешённая LP кассы → узел `dec.cash`. `reason` — сырой текст решателя (англ.), уходит в `raw`.
 * Лимит берётся из фактического времени решения, если оно известно (иначе 30 с).
 */
export function lpStatusLive(status: string, reason?: string, limitS: number = DEFAULT_LP_LIMIT_S, updatedAt?: string): NodeLive {
  const raw = reason?.trim() || undefined
  const base = { raw, updatedAt }
  switch (status) {
    case 'time_limit':
      return { ...base, state: 'stale', badge: `касса: не решено за ${num(limitS, 0)}${NBSP}с`,
        reason: 'решатель остановлен по лимиту времени — повторите с большим лимитом' }
    case 'infeasible':
      return { ...base, state: 'error', badge: 'касса: нет решения',
        reason: 'ограничение ликвидности неразрешимо — снизьте L_min' }
    default:
      return { ...base, state: 'error', badge: 'касса: расчёт не выполнен',
        reason: `расчёт кассы не выполнен: ${lpStatusLabel(status, 'long')}` }
  }
}

/** Критерий кассы [5], когда решение кассы [4] не получено: одна причина — один блок. */
export function cashCriterionWaiting(): NodeLive {
  return { state: 'unconfigured', badge: 'ждёт решения кассы [4]', reason: 'CFaR и P(разрыва) считаются на решении кассы — сначала решите кассу' }
}

/** Секунды решения из ответа (мс) или лимит по умолчанию. */
export function lpLimitSeconds(solveMs: number | null | undefined): number {
  return typeof solveMs === 'number' && Number.isFinite(solveMs) && solveMs > 1000 ? Math.round(solveMs / 1000) : DEFAULT_LP_LIMIT_S
}
