/**
 * Тепловая карта «строка × интервал» (из `LoadTimeline` Плана): последовательная шкала одного
 * тона (`--chart-1`, 11 ступеней через color-mix в charts.css) — магнитуда никогда не статусным
 * цветом; подписи строк в 2 строки без обрезки; ось X — подписи интервалов; шкала-легенда;
 * подсказка по ячейке через `<title>` + таблица-двойник с каждым значением.
 * Много подписанных столбцов (матрица «откуда × куда»): столбцы нумеруются 1…N, под картой —
 * ключ «номер — полное имя», у строк с тем же именем — тот же номер (обе оси читаются).
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
  /** Заголовок колонки строк в таблице-двойнике: «Станок», «Тип оборудования». */
  rowHeader?: string
  compact?: boolean
  className?: string
}

/** Число ступеней шкалы (классы ch-heat__c--0…10). */
const STEPS = 10
/** С какого числа подписанных столбцов имена уходят в нумерованный ключ. */
const NUMBERED_FROM = 7
/** С какого числа столбцов подписывается каждый второй номер (узкие ячейки). */
const SPARSE_FROM = 21

export function heatStep(v: number): number {
  if (!Number.isFinite(v) || v < 0.02) return 0
  return Math.max(1, Math.min(STEPS, Math.ceil(Math.min(1, v) * STEPS)))
}

export function Heatmap({ rows, columns, axis, fmt = (v) => pct(v, 0), title, subtitle, ariaLabel, legendLow = 'простой', legendHigh = 'загрузка 100 %', rowHeader = 'Строка', compact, className }: HeatmapProps) {
  const table: ChartTable = { columns: [rowHeader, ...columns], rows: rows.map((r) => [r.label, ...r.values.map((v) => fmt(v))]) }
  const ticks = axis ?? (columns.length > 2 ? [columns[0], columns[Math.floor(columns.length / 2)], columns[columns.length - 1]] : columns)
  // Все столбцы подписаны, а их много → номера на оси и ключ с полными именами.
  const numbered = Boolean(axis) && ticks.length === columns.length && columns.length >= NUMBERED_FROM
  const colNo = new Map(columns.map((c, i) => [c, i + 1]))
  const axisCls = `ch-heat__axis${numbered ? ' ch-heat__axis--numbered' : ''}${numbered && columns.length >= SPARSE_FROM ? ' ch-heat__axis--sparse' : ''}`
  return (
    <ChartFrame title={title} subtitle={subtitle} ariaLabel={ariaLabel ?? `Тепловая карта: ${rows.length} строк × ${columns.length} интервалов`}
      table={rows.length ? table : null} compact={compact} className={className} empty={rows.length === 0 ? 'Нет данных' : undefined}>
      <div className="ch-heat">
        {rows.map((r) => (
          <div key={r.key} className="ch-heat__row">
            <span className="ch-heat__name" title={r.label}>
              {numbered && colNo.has(r.label) && <span className="ch-heat__no">{colNo.get(r.label)}</span>}
              {r.label}
            </span>
            <span className="ch-heat__cells">
              {r.values.map((v, i) => (
                <span key={i} className={`ch-heat__c ch-heat__c--${heatStep(v)}`} title={`${columns[i] ?? ''}: ${fmt(v)}`} />
              ))}
            </span>
          </div>
        ))}
        <div className="ch-heat__row ch-heat__row--axis" aria-hidden="true">
          <span className="ch-heat__name" />
          <span className={axisCls}>{numbered ? columns.map((_, i) => <span key={i}>{i + 1}</span>) : ticks.map((t, i) => <span key={i}>{t}</span>)}</span>
        </div>
        {numbered && (
          <ol className="ch-heat__key" aria-label="Номера столбцов">
            {columns.map((c, i) => <li key={i}><span className="ch-heat__no">{i + 1}</span>{c}</li>)}
          </ol>
        )}
        <div className="ch-heat__scale" aria-hidden="true">
          <span>{legendLow}</span>
          {[1, 3, 5, 7, 9, 10].map((s) => <span key={s} className={`ch-heat__c ch-heat__c--${s}`} />)}
          <span>{legendHigh}</span>
        </div>
      </div>
    </ChartFrame>
  )
}
