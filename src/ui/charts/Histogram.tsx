/**
 * Гистограмма (база — D2-гистограмма «Портфеля»): корзины-столбцы с 2 px зазором поверхности,
 * выделенный хвост (`highlight`) цветом второго ряда, вертикальные маркеры с подписью
 * (VaR, E, CVaR) — текст `--text`, не цветом ряда; подсказка по корзине.
 */
import { useCallback, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Grid, XAxis, YAxis } from './Axis'
import { ChartTooltip } from './Tooltip'
import { useHoverIndex, useMeasuredWidth } from './hooks'
import { columnPath } from './Cartesian'
import type { LegendItem } from './palette'
import { axisNum, niceTicks, yTicks } from './scale'
import { pct } from '../../explain/format'

export interface Bin { x0: number; x1: number; count: number }

export interface HistMarker {
  key: string
  x: number
  label: string
  /** Глиф состояния перед подписью (○ ● ▲ ■). */
  glyph?: string
}

interface HistogramProps {
  bins: ReadonlyArray<Bin>
  /** Корзины, попадающие в выделение (хвост α) — вторым цветом. */
  highlight?: (b: Bin) => boolean
  highlightLabel?: string
  markers?: ReadonlyArray<HistMarker>
  fmtX?: (v: number) => string
  height?: number
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  ariaLabel?: string
  seriesLabel?: string
  className?: string
}

const PT = 14, PB = 28, PR = 14, PL = 44, GAP = 2

export function Histogram({
  bins, highlight, highlightLabel = 'хвост', markers = [], fmtX = axisNum, height = 220, title, subtitle, badges, actions, ariaLabel,
  seriesLabel = 'доля прогонов', className,
}: HistogramProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const n = bins.length
  const total = bins.reduce((a, b) => a + b.count, 0) || 1
  const x0 = n ? bins[0].x0 : 0
  const x1 = n ? bins[n - 1].x1 : 1
  const plotW = Math.max(40, width - PL - PR)
  const plotH = Math.max(40, height - PT - PB)
  const xAt = useCallback((v: number) => PL + ((v - x0) / (x1 - x0 || 1)) * plotW, [x0, x1, plotW])
  const shares = bins.map((b) => b.count / total)
  const maxShare = Math.max(0.01, ...shares)
  const yTk = yTicks(0, maxShare * 1.08, 3)
  const yMax = Math.max(maxShare * 1.08, yTk[yTk.length - 1])
  const yAt = (s: number) => PT + (1 - s / yMax) * plotH
  const yBase = yAt(0)
  const xTicks = niceTicks(x0, x1, 5)
  const centerX = useCallback((i: number) => xAt((bins[i].x0 + bins[i].x1) / 2), [bins, xAt])
  const hoverApi = useHoverIndex(n, centerX)
  const hover = hoverApi.hover

  const hasHi = Boolean(highlight && bins.some(highlight))
  const legend: LegendItem[] = [
    { key: 'main', label: seriesLabel, color: 'var(--chart-1)', shape: 'rect' },
    ...(hasHi ? [{ key: 'hi', label: highlightLabel, color: 'var(--chart-4)', shape: 'rect' as const }] : []),
  ]
  const table: ChartTable = {
    columns: ['Интервал', seriesLabel, 'Прогонов'],
    rows: bins.map((b, i) => [`${fmtX(b.x0)} – ${fmtX(b.x1)}`, pct(shares[i], 1), String(b.count)]),
  }

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={badges} actions={actions} legend={legend} table={n ? table : null}
      ariaLabel={ariaLabel ?? `Гистограмма: ${n} корзин`} empty={n === 0 ? 'Нет распределения' : undefined} className={className}>
      <div ref={ref} className="ch-plot" tabIndex={0} onPointerMove={hoverApi.onPointerMove} onPointerLeave={hoverApi.onPointerLeave}
        onKeyDown={hoverApi.onKeyDown} onBlur={hoverApi.onBlur}>
        <svg className="ch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Grid ticks={yTk} yAt={yAt} x0={PL} x1={width - PR} />
          <YAxis ticks={yTk} yAt={yAt} x={PL - 8} fmt={(v) => pct(v, 0)} />
          <XAxis labels={xTicks.map(fmtX)} xAt={(i) => xAt(xTicks[i])} y={yBase} x0={PL} x1={width - PR} />
          {bins.map((b, i) => {
            const bx = xAt(b.x0) + GAP / 2
            const bw = Math.max(1, xAt(b.x1) - xAt(b.x0) - GAP)
            const y = yAt(shares[i])
            const hi = highlight?.(b)
            const dim = hover != null && hover !== i
            return <path key={i} className={`ch-col${dim ? ' is-dim' : ''}`} fill={hi ? 'var(--chart-4)' : 'var(--chart-1)'}
              d={columnPath(bx, y, bw, Math.max(0.5, yBase - y))} />
          })}
          {markers.map((m) => {
            const mx = xAt(m.x)
            const right = mx > width * 0.7
            return (
              <g key={m.key} className="ch-vmark">
                <line x1={mx} x2={mx} y1={PT} y2={yBase} />
                <text x={mx + (right ? -6 : 6)} y={PT + 10} textAnchor={right ? 'end' : 'start'} className="ch-vmark__label">
                  {m.glyph ? `${m.glyph} ` : ''}{m.label}
                </text>
              </g>
            )
          })}
          {hover != null && (
            <ChartTooltip x={centerX(hover)} y={PT} width={width} height={plotH} title={`${fmtX(bins[hover].x0)} – ${fmtX(bins[hover].x1)}`}
              rows={[{ key: 's', label: seriesLabel, value: pct(shares[hover], 1), color: 'var(--chart-1)' }, { key: 'n', label: 'прогонов', value: String(bins[hover].count) }]} />
          )}
        </svg>
      </div>
    </ChartFrame>
  )
}
