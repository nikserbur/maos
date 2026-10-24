/**
 * Исход расчёта кассы под план (X2 «честные состояния»): не считалась · считается · есть оптимум ·
 * не рассчитана. Нерешённая ЛП (лимит времени, неразрешимость) — «не рассчитано», а не плитки с
 * нулями. Один селектор для плитки KPI и секции «Касса» — они не могут разойтись. Чистые функции.
 */
import type { CashLpResult } from '../../lib/api'
import { lpStatusLabel } from '../../explain/labels'
import { num } from '../../explain/format'

export type CashOutcome = 'none' | 'running' | 'ok' | 'failed'

export function cashOutcome(cash: CashLpResult | null, running: boolean, error: string | null): CashOutcome {
  if (running) return 'running'
  if (error) return 'failed'
  if (!cash) return 'none'
  return String(cash.status ?? '').toLowerCase() === 'optimal' ? 'ok' : 'failed'
}

/** Заголовок «Касса не рассчитана: …» словами (без сырых id статуса решателя). */
export function cashFailTitle(cash: CashLpResult | null, error: string | null): string {
  if (!cash || error) return 'Касса не рассчитана: расчёт не завершился'
  const st = String(cash.status ?? '').toLowerCase()
  if (st === 'time_limit') return 'Касса не рассчитана: решатель остановился по лимиту времени'
  if (st === 'infeasible') return 'Касса не рассчитана: ограничения кассы несовместны'
  return `Касса не рассчитана: ${lpStatusLabel(st, 'long')}`
}

/** Что сделать — одной фразой. */
export function cashFailHint(cash: CashLpResult | null, error: string | null): string {
  if (!cash || error) return 'Проверьте связь с сервером и повторите.'
  const st = String(cash.status ?? '').toLowerCase()
  if (st === 'infeasible') return 'Снизьте порог ликвидности L_min или поднимите лимит кредитной линии.'
  return 'Уменьшите число сценариев или порог ликвидности L_min и повторите.'
}

/** Сырые подробности для «Подробнее»: статус, причина, время решателя. */
export function cashFailDetail(cash: CashLpResult | null, error: string | null): string {
  if (error) return error
  if (!cash) return ''
  return [`статус: ${cash.status}`, cash.reason ? `причина: ${cash.reason}` : '', `время решателя: ${num(cash.solve_ms, 0)} мс`].filter(Boolean).join(' · ')
}

/** Оценка длительности расчёта кассы (с) по числу сценариев — только для прогресса, не обещание. */
export function cashEtaSeconds(nScenarios: number | null | undefined): number {
  const n = Number.isFinite(nScenarios) && (nScenarios as number) > 0 ? (nScenarios as number) : 500
  return Math.max(3, Math.min(120, 2 + n * 0.02))
}
