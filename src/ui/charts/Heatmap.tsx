/**
 * Тепловая карта «строка × интервал» (из `LoadTimeline` Плана): последовательная шкала одного
 * тона (`--chart-1`, 11 ступеней через color-mix в charts.css) — магнитуда никогда не статусным
 * цветом; подписи строк в 2 строки без обрезки; ось X — подписи интервалов; шкала-легенда;
 * подсказка по ячейке через `<title>` + таблица-двойник с каждым значением.
 */
import type { ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { pct } from '../../explain/format'
import './charts.css'

export interface HeatRow {
  key: string
  label: string
  /** Значения 0…1 по интервалам (доля занятости). */
  values: ReadonlyArray<number>
}

interface HeatmapProps {
  rows: ReadonlyArray<HeatRow>
  /** Подписи интервалов (столько же, сколько значений в строке) — для таблицы и подсказок. */
  columns: ReadonlyArray<string>
  /** Подписи оси X (начало · середина · конец), если не хочется выводить все `columns`. */
  axis?: ReadonlyArray<string>
  fmt?: (v: number) => string
  title?: ReactNode
  subtitle?: ReactNode
  ariaLabel?: string
  legendLow?: string
  legendHigh?: string
  compact?: boolean
  className?: string
}

/** Число ступеней шкалы (классы ch-heat__c--0…10). */
const STEPS = 10

export function heatStep(v: number): number {
  if (!Number.isFinite(v) || v < 0.02) return 0
  return Math.max(1, Math.min(STEPS, Math.ceil(Math.min(1, v) * STEPS)))
}

export function Heatmap({ rows, columns, axis, fmt = (v) => pct(v, 0), title, subtitle, ariaLabel, legendLow = 'простой', legendHigh = 'загрузка 100 %', compact, className }: HeatmapProps) {
  const table: ChartTable = { columns: ['', ...columns], rows: rows.map((r) => [r.label, ...r.values.map((v) => fmt(v))]) }
  const ticks = axis ?? (columns.length > 2 ? [columns[0], columns[Math.floor(columns.length / 2)], columns[columns.length - 1]] : columns)
  return (
    <ChartFrame title={title} subtitle={subtitle} ariaLabel={ariaLabel ?? `Тепловая карта: ${rows.length} строк × ${columns.length} интервалов`}
      table={rows.length ? table : null} compact={compact} className={className} empty={rows.length === 0 ? 'Нет данных' : undefined}>
      <div className="ch-heat">
        {rows.map((r) => (
          <div key={r.key} className="ch-heat__row">
            <span className="ch-heat__name" title={r.label}>{r.label}</span>
            <span className="ch-heat__cells">
              {r.values.map((v, i) => (
                <span key={i} className={`ch-heat__c ch-heat__c--${heatStep(v)}`} title={`${columns[i] ?? ''}: ${fmt(v)}`} />
              ))}
            </span>
          </div>
        ))}
        <div className="ch-heat__row ch-heat__row--axis" aria-hidden="true">
          <span className="ch-heat__name" />
          <span className="ch-heat__axis">{ticks.map((t, i) => <span key={i}>{t}</span>)}</span>
        </div>
        <div className="ch-heat__scale" aria-hidden="true">
          <span>{legendLow}</span>
          {[1, 3, 5, 7, 9, 10].map((s) => <span key={s} className={`ch-heat__c ch-heat__c--${s}`} />)}
          <span>{legendHigh}</span>
        </div>
      </div>
    </ChartFrame>
  )
}
