/**
 * Легенда статусов — ряд чипов в полосе режимов (X2 P-28, P-33): только состояния, которые есть
 * на уровне, со счётчиками станков: «● В работе 118 · ▲ ТО / ремонт 2». Глиф + слово, цвет —
 * только у отклонений; «Наладка» с нулём объектов не появляется.
 */
import { num } from '../../explain/format'
import { STATUS_META, type StageStatus } from './types'

const ORDER: ReadonlyArray<StageStatus> = ['running', 'setup', 'down', 'idle']

/** Счётчики станков по статусам (только ненулевые, в порядке словаря). */
export function legendCounts(statuses: ReadonlyArray<StageStatus>): Array<{ status: StageStatus; n: number }> {
  const counts = new Map<StageStatus, number>()
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1)
  return ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({ status: s, n: counts.get(s) ?? 0 }))
}

export function SceneLegend({ statuses }: { statuses: ReadonlyArray<StageStatus> }) {
  const items = legendCounts(statuses)
  if (items.length === 0) return null
  return (
    <ul className="scene-legend" aria-label="Станки по статусам">
      {items.map(({ status, n }) => (
        <li key={status} className={`scene-legend__item is-${status}`}>
          <span className={STATUS_META[status].glyphClass}>{STATUS_META[status].label}</span>
          <b className="num">{num(n, 0)}</b>
        </li>
      ))}
    </ul>
  )
}
