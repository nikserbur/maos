/**
 * Прогресс расчёта по фазам (UX-V2 §4.6): бэкенд пока не отдаёт `GET /api/runs/:id/progress`,
 * поэтому фазы оцениваются на фронте по N прогонов и числу операций; при появлении
 * эндпоинта компонент получает `{ phase, progress, eta }` теми же пропсами.
 */
import { useEffect, useState } from 'react'
import { num, pct } from '../explain/format'
import './fields.css'

export interface RunPhase {
  id: string
  title: string
  /** Доля времени фазы в общей оценке. */
  weight: number
  /** Узел карты, который подсвечивается на этой фазе (§3.8). */
  mapNode?: string
}

export const SCHEDULE_PHASES: readonly RunPhase[] = [
  { id: 'expand', title: 'Развёртка программы в операции', weight: 0.08, mapNode: 'int.routes' },
  { id: 'rules', title: 'Базовые правила (7) на N сценариях', weight: 0.3, mapNode: 'dec.schedule' },
  { id: 'ga', title: 'Генетический алгоритм (поколения)', weight: 0.34, mapNode: 'dec.schedule' },
  { id: 'mc', title: 'Монте-Карло: хвост длины расписания', weight: 0.2, mapNode: 'crit.schedule' },
  { id: 'report', title: 'Отчёт: KPI, Гант, очереди', weight: 0.08, mapNode: 'crit.schedule' },
]

export const CASH_PHASES: readonly RunPhase[] = [
  { id: 'scenarios', title: 'Сценарии цен и макро-пути (CRN)', weight: 0.15, mapNode: 'ext.generator' },
  { id: 'lp', title: 'CVaR-LP с кассой (HiGHS)', weight: 0.45, mapNode: 'dec.cash' },
  { id: 'waterfall', title: 'Водопад кассы на решении', weight: 0.25, mapNode: 'crit.cash' },
  { id: 'pol', title: 'Цена ликвидности и бутстреп-ДИ', weight: 0.15, mapNode: 'crit.cash' },
]

/** Оценка времени Стадии 1 по N и размеру задачи (секунды) — только для прогресса, не обещание. */
export function estimateScheduleSeconds(samples: number, operations: number, ga: boolean): number {
  const base = 1.5 + operations * 0.004 + samples * 0.004
  return Math.max(2, base * (ga ? 2.2 : 1))
}

interface RunProgressProps {
  phases: readonly RunPhase[]
  running: boolean
  /** Ожидаемая длительность, с (фронтовая оценка). */
  etaSeconds: number
  /** Если бэкенд прислал прогресс — он главнее оценки. */
  progress?: number
  phase?: string
  title?: string
}

export function RunProgress({ phases, running, etaSeconds, progress, phase, title = 'Расчёт' }: RunProgressProps) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) { setElapsed(0); return undefined }
    const t0 = Date.now()
    const id = window.setInterval(() => setElapsed((Date.now() - t0) / 1000), 250)
    return () => window.clearInterval(id)
  }, [running])
  if (!running) return null
  // Оценка: асимптотически к 95 % — честно показываем, что окончание неизвестно точно.
  const est = progress ?? Math.min(0.95, 1 - Math.exp(-elapsed / Math.max(1, etaSeconds)) * 1)
  let acc = 0
  const current = phase ?? phases.find((p) => { acc += p.weight; return est < acc })?.id ?? phases[phases.length - 1].id
  const eta = Math.max(0, etaSeconds - elapsed)
  return (
    <div className="pf-progress" role="status" aria-live="polite" aria-label={`${title}: ${pct(est, 0)}`}>
      <div className="pf-progress__head">
        <span className="pf-progress__title">{title}</span>
        <span className="pf-progress__eta mono">{pct(est, 0)} · прошло {num(elapsed, 0)} с{progress === undefined && ` · ≈ ещё ${num(eta, 0)} с (оценка)`}</span>
      </div>
      <div className="pf-progress__bar" aria-hidden="true"><span style={{ transform: `scaleX(${est})` }} /></div>
      <ol className="pf-progress__phases">
        {phases.map((p) => {
          const i = phases.findIndex((x) => x.id === p.id)
          const ci = phases.findIndex((x) => x.id === current)
          const st = i < ci ? 'done' : i === ci ? 'active' : 'todo'
          return (
            <li key={p.id} className={`pf-progress__phase is-${st}`} data-map-node={p.mapNode}>
              <span className="pf-progress__dot" aria-hidden="true" />
              {p.title}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
