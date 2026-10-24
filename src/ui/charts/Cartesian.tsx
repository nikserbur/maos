/**
 * Декартов график по категориям X (даты/планы): линия · область · столбцы.
 * Общий движок для LineChart/AreaChart/ColumnChart: пиксельная отрисовка по измеренной ширине,
 * сетка ≤ 4 линий, перекрестие + одна подсказка на все ряды, маркеры только на hover и на конце,
 * столбцы ≤ 24 px со скруглённым верхом и 2 px зазором, площадь — 10 % заливка.
 * Расширения G3c: полоса доверительного интервала ряда (`band`), пунктирный ряд-порог
 * (`dashed` — только «проекция/порог», никогда данные), аннотации (пик с лидер-линией,
 * вертикальная отметка), дополнительные строки подсказки (`tipRows`).
 */
import { useCallback, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Crosshair, Grid, Marker, XAxis, YAxis } from './Axis'
import { ChartTooltip, type TipRow } from './Tooltip'
import { useHoverIndex, useMeasuredWidth } from './hooks'
import { colorOf, type LegendItem } from './palette'
import { areaPath, axisNum, bandPath, extent, labelStep, linePath, segments, yDomain, yTicks, type XY } from './scale'
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
  /** Доверительный интервал: нижняя/верхняя кривая той же длины (полоса 14 % цвета ряда). */
  band?: { lo: ReadonlyArray<number>; hi: ReadonlyArray<number>; label?: string }
  /** Пунктир — порог/базовая линия/проекция (dataviz: никогда для данных и сетки). */
  dashed?: boolean
}

/** Аннотация: точка ряда с подписью (лидер-линия) или вертикальная отметка по индексу X. */
export interface Annotation {
  key: string
  index: number
  label: string
  kind?: 'point' | 'line'
  seriesKey?: string
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
  annotations?: ReadonlyArray<Annotation>
  /** Дополнительные строки подсказки для индекса X (например, «узко: РЦ (n)»). */
  tipRows?: (i: number) => ReadonlyArray<TipRow>
  /** Компактная рамка (вложенный в плитку график). */
  compact?: boolean
  /** Подпись таблицы-двойника для колонки X. */
  xHeader?: string
  /** Подписывать на оси X только эти индексы (даты: начало месяца/квартала). */
  tickIndices?: ReadonlyArray<number>
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
  emptyTitle = 'Нет данных', emptyText, loading, endLabels = false, annotations = [], tipRows, compact, xHeader = '', tickIndices, className,
}: CartesianProps & { kind: CartesianKind }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const n = labels.length
  const all = series.flatMap((s) => [...s.values, ...(s.band?.lo ?? []), ...(s.band?.hi ?? [])]).filter(Number.isFinite)
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

  const legend: LegendItem[] = series.flatMap((s, i) => {
    const color = colorOf(i, s.color)
    const items: LegendItem[] = [{ key: s.key, label: s.name, color, shape: kind === 'line' ? 'line' : 'rect', dashed: s.dashed }]
    if (s.band) items.push({ key: `${s.key}-band`, label: s.band.label ?? `${s.name} · интервал`, color, shape: 'band' })
    return items
  })
  const fmtOf = (s: Series) => s.fmt ?? fmtY
  const table: ChartTable = {
    columns: [xHeader, ...series.map((s) => s.name)],
    rows: labels.map((l, i) => [l, ...series.map((s) => (Number.isFinite(s.values[i]) ? fmtOf(s)(s.values[i]) : DASH))]),
  }
  const label = ariaLabel ?? `График: ${series.map((s) => s.name).join(', ')}`

  const groupW = Math.min(band * 0.72, series.length * MAX_COL + (series.length - 1) * GAP)
  const colW = Math.max(2, (groupW - (series.length - 1) * GAP) / Math.max(1, series.length))
  const seriesByKey = (k?: string) => (k ? series.find((s) => s.key === k) : series[0])

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={badges} actions={actions} legend={legend} ariaLabel={label}
      table={isEmpty ? null : table} loading={loading} empty={isEmpty ? emptyTitle : undefined} emptyText={emptyText} className={className} compact={compact}
      skeletonHeight={height}>
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
          <XAxis labels={labels} xAt={xAt} y={yBase} step={step} x0={PL} x1={width - PR} tickIndices={tickIndices} />

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
            const bands = s.band ? bandSegments(s.band.lo, s.band.hi, xAt, yAt) : []
            return (
              <g key={s.key}>
                {bands.map(([up, low], k) => <path key={`b${k}`} className="ch-band" fill={color} d={bandPath(up, low)} />)}
                {kind === 'area' && segs.map((pts, k) => <path key={k} className="ch-area" fill={color} d={areaPath(pts, yBase)} />)}
                {segs.map((pts, k) => <path key={k} className={`ch-line${s.dashed ? ' ch-line--dashed' : ''}`} stroke={color} d={linePath(pts)} />)}
                {lastIdx >= 0 && hover == null && !s.dashed && <Marker x={xAt(lastIdx)} y={yAt(s.values[lastIdx])} color={color} r={3.5} />}
                {endLabels && lastIdx >= 0 && series.length <= 4 && (
                  <text className="ch-endlabel" x={xAt(lastIdx) + 8} y={yAt(s.values[lastIdx]) + 4}>{fmtOf(s)(s.values[lastIdx])}</text>
                )}
              </g>
            )
          })}

          {annotations.map((a) => {
            if (a.index < 0 || a.index >= n) return null
            const ax = xAt(a.index)
            if (a.kind === 'line') {
              return (
                <g key={a.key} className="ch-vmark">
                  <line x1={ax} x2={ax} y1={PT} y2={yBase} />
                  <text x={ax + 6} y={PT + 10} className="ch-vmark__label">{a.label}</text>
                </g>
              )
            }
            const s = seriesByKey(a.seriesKey)
            const v = s?.values[a.index]
            if (!s || v === undefined || !Number.isFinite(v)) return null
            const ay = yAt(v)
            const right = ax > PL + plotW * 0.66
            const tx = right ? ax - 14 : ax + 14
            return (
              <g key={a.key} className="ch-leader">
                <Marker x={ax} y={ay} color={colorOf(series.indexOf(s), s.color)} r={5} />
                <line x1={ax + (right ? -7 : 7)} y1={ay} x2={tx - (right ? -3 : 3)} y2={ay} />
                <text x={tx} y={ay + 4} textAnchor={right ? 'end' : 'start'} className="ch-endlabel">{a.label}</text>
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
                rows={[
                  ...series.map((s, si) => ({
                    key: s.key, label: s.name, color: colorOf(si, s.color),
                    value: Number.isFinite(s.values[hover]) ? fmtOf(s)(s.values[hover]) : DASH,
                  })),
                  ...(tipRows ? tipRows(hover) : []),
                ]} />
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

/** Непрерывные участки полосы (обе кривые конечны) → пары [верх, низ]. */
function bandSegments(lo: ReadonlyArray<number>, hi: ReadonlyArray<number>, xAt: (i: number) => number, yAt: (v: number) => number): Array<[XY[], XY[]]> {
  const out: Array<[XY[], XY[]]> = []
  let up: XY[] = []
  let low: XY[] = []
  const flush = () => { if (up.length > 1) out.push([up, low]); up = []; low = [] }
  const n = Math.min(lo.length, hi.length)
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(lo[i]) && Number.isFinite(hi[i])) {
      up.push({ x: xAt(i), y: yAt(hi[i]) })
      low.push({ x: xAt(i), y: yAt(lo[i]) })
    } else flush()
  }
  flush()
  return out
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
