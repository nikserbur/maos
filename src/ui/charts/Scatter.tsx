/**
 * Диаграмма рассеяния (база — Парето «Портфеля»): точки ≥ 8 px с кольцом поверхности,
 * невидимая зона попадания 24 px, приглушённые доминируемые точки, прямые подписи выбранных
 * точек с лидер-линией и отступом от правого края (`text-anchor=end`), подсказка по точке.
 */
import { useState, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Grid, XAxis, YAxis } from './Axis'
import { ChartTooltip } from './Tooltip'
import { useMeasuredWidth } from './hooks'
import type { LegendItem } from './palette'
import { axisNum, extent, linear, niceTicks, yDomain, yTicks } from './scale'

export type Emphasis = 'primary' | 'muted' | 'selected'

export interface ScatterPoint {
  key: string
  x: number
  y: number
  label?: string
  emphasis?: Emphasis
  /** Соединить с предыдущей точкой фронта (линия Парето). */
  onFront?: boolean
}

interface ScatterProps {
  points: ReadonlyArray<ScatterPoint>
  fmtX?: (v: number) => string
  fmtY?: (v: number) => string
  xLabel?: string
  yLabel?: string
  height?: number
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  ariaLabel?: string
  legend?: ReadonlyArray<LegendItem>
  className?: string
}

const PT = 14, PB = 30, PR = 16, PL = 52, HIT = 12

export function Scatter({ points, fmtX = axisNum, fmtY = axisNum, xLabel, yLabel, height = 260, title, subtitle, badges, actions, ariaLabel, legend, className }: ScatterProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const n = points.length
  const [xl0, xh0] = extent(points.map((p) => p.x))
  const [yl0, yh0] = extent(points.map((p) => p.y))
  const [xl, xh] = yDomain(xl0, xh0, false, 0.06)
  const [yl, yh] = yDomain(yl0, yh0, false, 0.08)
  const plotW = Math.max(40, width - PL - PR)
  const plotH = Math.max(40, height - PT - PB)
  const xAt = linear(xl, xh, PL, PL + plotW)
  const yAt = linear(yl, yh, PT + plotH, PT)
  const xT = niceTicks(xl, xh, 5)
  const yT = yTicks(yl, yh, 4)
  const front = points.filter((p) => p.onFront).sort((a, b) => a.x - b.x)
  const table: ChartTable = { columns: ['', xLabel ?? 'X', yLabel ?? 'Y'], rows: points.map((p) => [p.label ?? p.key, fmtX(p.x), fmtY(p.y)]) }
  const hp = points.find((p) => p.key === hover) ?? null

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={badges} actions={actions} legend={legend} table={n ? table : null}
      ariaLabel={ariaLabel ?? `Рассеяние: ${n} точек`} empty={n === 0 ? 'Нет точек' : undefined} className={className}>
      <div ref={ref} className="ch-plot" onPointerLeave={() => setHover(null)}>
        <svg className="ch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Grid ticks={yT} yAt={yAt} x0={PL} x1={width - PR} />
          <YAxis ticks={yT} yAt={yAt} x={PL - 8} fmt={fmtY} unit={yLabel} top={PT} />
          <XAxis labels={xT.map(fmtX)} xAt={(i) => xAt(xT[i])} y={PT + plotH} x0={PL} x1={width - PR} />
          {xLabel && <text className="ch-tick ch-tick--unit" x={width - PR} y={height - 4} textAnchor="end">{xLabel}</text>}
          {front.length > 1 && (
            <path className="ch-front" d={front.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.x).toFixed(1)},${yAt(p.y).toFixed(1)}`).join('')} />
          )}
          {points.map((p) => {
            const cx = xAt(p.x)
            const cy = yAt(p.y)
            const em = p.emphasis ?? 'primary'
            const r = em === 'selected' ? 6 : em === 'muted' ? 3 : 4.5
            return (
              <g key={p.key} className={`ch-dot ch-dot--${em}${hover === p.key ? ' is-hot' : ''}`}
                tabIndex={0} onPointerEnter={() => setHover(p.key)} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)}>
                <circle className="ch-dot__hit" cx={cx} cy={cy} r={HIT} />
                <circle className="ch-marker" cx={cx} cy={cy} r={r} />
              </g>
            )
          })}
          {points.filter((p) => p.label && (p.emphasis ?? 'primary') !== 'muted').map((p) => {
            const cx = xAt(p.x)
            const cy = yAt(p.y)
            const right = cx > PL + plotW * 0.72
            const tx = right ? cx - 14 : cx + 14
            return (
              <g key={`l-${p.key}`} className="ch-leader">
                <line x1={cx + (right ? -7 : 7)} y1={cy} x2={tx - (right ? -3 : 3)} y2={cy} />
                <text x={tx} y={cy + 4} textAnchor={right ? 'end' : 'start'} className="ch-endlabel">{p.label}</text>
              </g>
            )
          })}
          {hp && (
            <ChartTooltip x={xAt(hp.x)} y={PT} width={width} height={plotH} title={hp.label ?? hp.key}
              rows={[{ key: 'x', label: xLabel ?? 'X', value: fmtX(hp.x) }, { key: 'y', label: yLabel ?? 'Y', value: fmtY(hp.y) }]} />
          )}
        </svg>
      </div>
    </ChartFrame>
  )
}
