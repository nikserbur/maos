/**
 * Декартов график по категориям X (даты/планы): линия · область · столбцы.
 * Общий движок для LineChart/AreaChart/ColumnChart: пиксельная отрисовка по измеренной ширине,
 * сетка ≤ 4 линий, перекрестие + одна подсказка на все ряды, маркеры только на hover и на конце,
 * столбцы ≤ 24 px со скруглённым верхом и 2 px зазором, площадь — 10 % заливка.
 */
import { useCallback, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Crosshair, Grid, Marker, XAxis, YAxis } from './Axis'
import { ChartTooltip } from './Tooltip'
import { useHoverIndex, useMeasuredWidth } from './hooks'
import { colorOf, type LegendItem } from './palette'
import { areaPath, axisNum, extent, labelStep, linePath, segments, yDomain, yTicks } from './scale'
import { DASH } from '../../explain/format'

/** Ряд: значения выровнены с `labels` по индексу; NaN — разрыв линии. */
export interface Series {
  key: string
  name: string
  values: ReadonlyArray<number>
  /** Цвет — только при миграции; по умолчанию слот палитры по индексу ряда. */
  color?: string
  /** Форматтер значений ряда (подсказка, таблица). */
  fmt?: (v: number) => string
}

export type CartesianKind = 'line' | 'area' | 'column'

export interface CartesianProps {
  labels: ReadonlyArray<string>
  series: ReadonlyArray<Series>
  /** Высота в пикселях, включая полосу оси X. */
  height?: number
  /** Форматтер делений оси Y (по умолчанию компактные числа). */
  fmtY?: (v: number) => string
  unit?: string
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  ariaLabel?: string
  emptyTitle?: ReactNode
  emptyText?: ReactNode
  loading?: boolean
  /** Подписывать последнее значение каждого ряда прямо у марки (≤ 4 рядов). */
  endLabels?: boolean
  className?: string
}

const PT = 12
const PB = 28
const PR = 14
const MAX_COL = 24
const GAP = 2

function leftPad(ticks: ReadonlyArray<number>, fmt: (v: number) => string): number {
  const chars = ticks.reduce((m, t) => Math.max(m, fmt(t).length), 2)
  return Math.min(84, Math.max(36, 10 + chars * 6.6))
}

export function Cartesian({
  kind, labels, series, height = 240, fmtY = axisNum, unit, title, subtitle, badges, actions, ariaLabel,
  emptyTitle = 'Нет данных', emptyText, loading, endLabels = false, className,
}: CartesianProps & { kind: CartesianKind }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const n = labels.length
  const all = series.flatMap((s) => s.values).filter(Number.isFinite)
  const isEmpty = n === 0 || series.length === 0 || all.length === 0

  const [lo0, hi0] = extent(all)
  const [lo, hi] = yDomain(lo0, hi0, kind !== 'line')
  const ticks = yTicks(lo, hi, 4)
  const PL = leftPad(ticks, fmtY)
  const plotW = Math.max(40, width - PL - PR)
  const plotH = Math.max(40, height - PT - PB)
  const yAt = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * plotH
  const band = n > 0 ? plotW / n : plotW
  const xAt = useCallback((i: number) => {
    if (kind === 'column') return PL + (i + 0.5) * band
    return n <= 1 ? PL + plotW / 2 : PL + (i / (n - 1)) * plotW
  }, [kind, PL, band, n, plotW])
  const hoverApi = useHoverIndex(n, xAt)
  const hover = hoverApi.hover
  const yBase = yAt(Math.max(lo, 0))
  const step = labelStep(labels, kind === 'column' ? plotW - band : plotW)

  const legend: LegendItem[] = series.map((s, i) => ({ key: s.key, label: s.name, color: colorOf(i, s.color), shape: kind === 'line' ? 'line' : 'rect' }))
  const fmtOf = (s: Series) => s.fmt ?? fmtY
  const table: ChartTable = {
    columns: ['', ...series.map((s) => s.name)],
    rows: labels.map((l, i) => [l, ...series.map((s) => (Number.isFinite(s.values[i]) ? fmtOf(s)(s.values[i]) : DASH))]),
  }
  const label = ariaLabel ?? `График: ${series.map((s) => s.name).join(', ')}`

  const groupW = Math.min(band * 0.72, series.length * MAX_COL + (series.length - 1) * GAP)
  const colW = Math.max(2, (groupW - (series.length - 1) * GAP) / Math.max(1, series.length))

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={badges} actions={actions} legend={legend} ariaLabel={label}
      table={isEmpty ? null : table} loading={loading} empty={isEmpty ? emptyTitle : undefined} emptyText={emptyText} className={className}>
      <div
        ref={ref}
        className="ch-plot"
        tabIndex={0}
        onPointerMove={hoverApi.onPointerMove}
        onPointerLeave={hoverApi.onPointerLeave}
        onKeyDown={hoverApi.onKeyDown}
        onBlur={hoverApi.onBlur}
      >
        <svg className="ch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Grid ticks={ticks} yAt={yAt} x0={PL} x1={width - PR} />
          <YAxis ticks={ticks} yAt={yAt} x={PL - 8} fmt={fmtY} unit={unit} top={PT} />
          <XAxis labels={labels} xAt={xAt} y={yBase} step={step} x0={PL} x1={width - PR} />

          {series.map((s, si) => {
            const color = colorOf(si, s.color)
            if (kind === 'column') {
              return (
                <g key={s.key} className="ch-cols">
                  {s.values.map((v, i) => {
                    if (!Number.isFinite(v)) return null
                    const x = xAt(i) - groupW / 2 + si * (colW + GAP)
                    const y = yAt(v)
                    const h = Math.abs(yBase - y)
                    const dim = hover != null && hover !== i
                    return (
                      <path key={i} className={`ch-col${dim ? ' is-dim' : ''}`} fill={color}
                        d={columnPath(x, Math.min(y, yBase), colW, Math.max(0.5, h), v >= 0)} />
                    )
                  })}
                </g>
              )
            }
            const segs = segments(s.values, xAt, yAt)
            const lastIdx = lastFinite(s.values)
            return (
              <g key={s.key}>
                {kind === 'area' && segs.map((pts, k) => <path key={k} className="ch-area" fill={color} d={areaPath(pts, yBase)} />)}
                {segs.map((pts, k) => <path key={k} className="ch-line" stroke={color} d={linePath(pts)} />)}
                {lastIdx >= 0 && hover == null && <Marker x={xAt(lastIdx)} y={yAt(s.values[lastIdx])} color={color} r={3.5} />}
                {endLabels && lastIdx >= 0 && series.length <= 4 && (
                  <text className="ch-endlabel" x={xAt(lastIdx) + 8} y={yAt(s.values[lastIdx]) + 4}>{fmtOf(s)(s.values[lastIdx])}</text>
                )}
              </g>
            )
          })}

          {hover != null && (
            <g>
              {kind !== 'column' && <Crosshair x={xAt(hover)} y0={PT} y1={PT + plotH} />}
              {kind !== 'column' && series.map((s, si) => Number.isFinite(s.values[hover]) && (
                <Marker key={s.key} x={xAt(hover)} y={yAt(s.values[hover])} color={colorOf(si, s.color)} />
              ))}
              <ChartTooltip x={xAt(hover)} y={PT} width={width} height={plotH} title={labels[hover]}
                rows={series.map((s, si) => ({
                  key: s.key, label: s.name, color: colorOf(si, s.color),
                  value: Number.isFinite(s.values[hover]) ? fmtOf(s)(s.values[hover]) : DASH,
                }))} />
            </g>
          )}
        </svg>
      </div>
    </ChartFrame>
  )
}

function lastFinite(values: ReadonlyArray<number>): number {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return i
  return -1
}

/** Столбец: скруглён только край данных (4 px), у базовой линии — прямой. */
export function columnPath(x: number, y: number, w: number, h: number, up = true): string {
  const r = Math.min(4, w / 2, h)
  if (up) {
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
  }
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`
}

export const LineChart = (p: CartesianProps) => <Cartesian kind="line" {...p} />
export const AreaChart = (p: CartesianProps) => <Cartesian kind="area" {...p} />
export const ColumnChart = (p: CartesianProps) => <Cartesian kind="column" {...p} />
