/**
 * Список-бары (загрузка оборудования, вклад факторов): подпись в две строки без обрезки,
 * тонкий бар одного цвета ряда (статусный цвет никогда не кодирует величину), значение справа
 * текстом `--text`. Бар — SVG с атрибутом width (без inline-стилей). Двуполярный режим —
 * от нулевой отметки посередине вправо/влево.
 */
import type { ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { DASH } from '../../explain/format'
import './charts.css'

export interface BarRow {
  key: string
  label: ReactNode
  /** Полный текст подписи для таблицы и title (если label — узел). */
  labelText?: string
  value: number
  /** Вторичная строка под подписью (простой, цех и т. п.). */
  secondary?: ReactNode
  /** Подсветка строки глифом/подписью — не цветом бара. */
  marked?: boolean
}

interface BarListProps {
  rows: ReadonlyArray<BarRow>
  fmt: (v: number) => string
  /** Максимум шкалы; по умолчанию — максимум |значений|. */
  max?: number
  /** Двуполярный: отрицательные влево от центра. */
  bipolar?: boolean
  color?: string
  title?: ReactNode
  subtitle?: ReactNode
  ariaLabel?: string
  valueHeader?: string
  compact?: boolean
  className?: string
}

export function BarList({ rows, fmt, max, bipolar = false, color = 'var(--chart-1)', title, subtitle, ariaLabel, valueHeader = 'Значение', compact, className }: BarListProps) {
  const m = max ?? (rows.reduce((a, r) => Math.max(a, Math.abs(r.value)), 0) || 1)
  const table: ChartTable = { columns: ['', valueHeader], rows: rows.map((r) => [r.labelText ?? String(r.label), Number.isFinite(r.value) ? fmt(r.value) : DASH]) }
  const label = ariaLabel ?? `Столбцы: ${rows.length} строк`
  return (
    <ChartFrame title={title} subtitle={subtitle} ariaLabel={label} table={rows.length ? table : null} compact={compact} className={className}
      empty={rows.length === 0 ? 'Нет данных' : undefined}>
      <ul className={`ch-bars${bipolar ? ' ch-bars--bipolar' : ''}`}>
        {rows.map((r) => {
          const share = Math.min(1, Math.abs(r.value) / m)
          const w = bipolar ? share * 50 : share * 100
          const x = bipolar ? (r.value >= 0 ? 50 : 50 - w) : 0
          return (
            <li key={r.key} className={`ch-bar${r.marked ? ' is-marked' : ''}`} title={r.labelText}>
              <span className="ch-bar__label">
                <span className="ch-bar__name">{r.label}</span>
                {r.secondary && <span className="ch-bar__sec">{r.secondary}</span>}
              </span>
              <svg className="ch-bar__track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                {bipolar && <line className="ch-bar__zero" x1="50" x2="50" y1="0" y2="8" />}
                <rect className="ch-bar__fill" x={x} y="0" width={Math.max(0.5, w)} height="8" fill={color} />
              </svg>
              <span className="ch-bar__value num">{Number.isFinite(r.value) ? fmt(r.value) : DASH}</span>
            </li>
          )
        })}
      </ul>
    </ChartFrame>
  )
}
