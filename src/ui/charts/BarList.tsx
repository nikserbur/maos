/**
 * Список-бары (загрузка оборудования, вклад факторов): подпись целиком, без многоточия (колонка
 * подписи — не уже 280 px или половины ширины), переход «откуда → куда» — двумя строками
 * («откуда» / «→ куда»); тонкий бар одного цвета ряда (статусный цвет никогда не кодирует величину), значение справа
 * текстом `--text`. Бар — SVG с атрибутом width (без inline-стилей). Двуполярный режим —
 * от нулевой отметки посередине вправо/влево.
 */
import { useState, type ReactNode } from 'react'
import { ChartFrame, type ChartTable, type FrameVariant } from './ChartFrame'
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
  /** Заголовок колонки подписей в таблице-двойнике: «Тип оборудования», «Фактор». */
  labelHeader?: string
  compact?: boolean
  /** nested — список внутри другого графика/плитки (без меню «⋯»: двойник — у родителя). */
  variant?: FrameVariant
  className?: string
  /** Отметка на каждой дорожке (цель, норматив): волосяная линия + подпись в легенде под списком. */
  mark?: { value: number; label: string }
  /** Показать первые N строк и кнопку «Все N». */
  limit?: number
}

/** Строка «откуда → куда» рисуется двумя короткими строками; прочие подписи — как есть. */
function BarLabel({ label }: { label: ReactNode }) {
  if (typeof label !== 'string') return <>{label}</>
  const at = label.indexOf(' → ')
  if (at <= 0) return <>{label}</>
  return (
    <>
      <span className="ch-bar__from">{label.slice(0, at)}</span>
      <span className="ch-bar__to">→ {label.slice(at + 3)}</span>
    </>
  )
}

export function BarList({ rows, fmt, max, bipolar = false, color = 'var(--chart-1)', title, subtitle, ariaLabel, valueHeader = 'Значение', labelHeader = 'Показатель', compact, variant, className, mark, limit }: BarListProps) {
  const [all, setAll] = useState(false)
  const m = max ?? (Math.max(rows.reduce((a, r) => Math.max(a, Math.abs(r.value)), 0), mark ? Math.abs(mark.value) : 0) || 1)
  const shown = limit && !all && rows.length > limit ? rows.slice(0, limit) : rows
  const markX = mark && Number.isFinite(mark.value) ? (bipolar ? 50 + Math.max(-50, Math.min(50, (mark.value / m) * 50)) : Math.min(100, Math.max(0, (Math.abs(mark.value) / m) * 100))) : null
  const table: ChartTable = { columns: [labelHeader, valueHeader], rows: rows.map((r) => [r.labelText ?? String(r.label), Number.isFinite(r.value) ? fmt(r.value) : DASH]) }
  const label = ariaLabel ?? `Столбцы: ${rows.length} строк`
  return (
    <ChartFrame title={title} subtitle={subtitle} ariaLabel={label} table={rows.length ? table : null} compact={compact} variant={variant} className={className}
      empty={rows.length === 0 ? 'Нет данных' : undefined}>
      <ul className={`ch-bars${bipolar ? ' ch-bars--bipolar' : ''}${compact ? ' ch-bars--compact' : ''}`}>
        {shown.map((r) => {
          const share = Math.min(1, Math.abs(r.value) / m)
          const w = bipolar ? share * 50 : share * 100
          const x = bipolar ? (r.value >= 0 ? 50 : 50 - w) : 0
          return (
            <li key={r.key} className={`ch-bar${r.marked ? ' is-marked' : ''}`} title={r.labelText}>
              <span className="ch-bar__label">
                <span className="ch-bar__name"><BarLabel label={r.label} /></span>
                {r.secondary && <span className="ch-bar__sec">{r.secondary}</span>}
              </span>
              <svg className="ch-bar__track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                {bipolar && <line className="ch-bar__zero" x1="50" x2="50" y1="0" y2="8" />}
                <rect className="ch-bar__fill" x={x} y="0" width={Math.max(0.5, w)} height="8" fill={color} />
                {markX !== null && <line className="ch-bar__mark" x1={markX} x2={markX} y1="0" y2="8" vectorEffect="non-scaling-stroke" />}
              </svg>
              <span className="ch-bar__value num">{Number.isFinite(r.value) ? fmt(r.value) : DASH}</span>
            </li>
          )
        })}
      </ul>
      {mark && markX !== null && (
        <p className="ch-bars__marklegend"><span className="ch-bars__markkey" aria-hidden="true" />{mark.label}: {fmt(mark.value)}</p>
      )}
      {limit !== undefined && rows.length > limit && (
        <button type="button" className="btn btn--ghost btn--sm ch-bars__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `Свернуть до ${limit}` : `Все ${rows.length}`}
        </button>
      )}
    </ChartFrame>
  )
}
