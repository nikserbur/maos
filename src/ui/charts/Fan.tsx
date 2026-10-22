/**
 * Веер прогноза (UX-V2 §5.3, X1 §3 п. 5): история → «сейчас» → полоса P10–P90 (+ P25–P75),
 * медиана, тренд, ромбы факта бэктеста. Высота ≥ 200 px, ось Y — 3–4 компактных деления,
 * ось дат — «−12 мес · сейчас · +6 мес». Перекрестие + одна подсказка (P10/P50/P90/факт).
 * Качество (CRPS · skill · покрытие) — НЕ внутри svg: его выводит обёртка в заголовке.
 */
import { useCallback, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Crosshair, Grid, Marker, YAxis } from './Axis'
import { ChartTooltip } from './Tooltip'
import { useHoverIndex, useMeasuredWidth } from './hooks'
import type { LegendItem } from './palette'
import { axisNum, bandPath, extent, linePath, yDomain, yTicks, type XY } from './scale'
import { DASH } from '../../explain/format'

export interface FanSeries {
  p10: ReadonlyArray<number>
  p50: ReadonlyArray<number>
  p90: ReadonlyArray<number>
  p25?: ReadonlyArray<number>
  p75?: ReadonlyArray<number>
  trend?: ReadonlyArray<number>
  history?: ReadonlyArray<number>
}

export interface FanProps {
  a: FanSeries
  /** Второй веер (сравнение сценариев) — вторым цветом. */
  b?: FanSeries | null
  fmt?: (v: number) => string
  /** Подпись смещения в месяцах: −12 → «−12 мес», 0 → «сейчас». */
  monthLabel?: (offset: number) => string
  /** Скрытые от модели последние точки истории (бэктест) — ромбы факта и полоса. */
  backtestK?: number
  height?: number
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  ariaLabel?: string
  /** Имена вееров в легенде. */
  nameA?: string
  nameB?: string
  className?: string
  compact?: boolean
  /** Скрыть легенду (малые кратные: одна общая легенда над сеткой). */
  showLegend?: boolean
}

const PT = 14, PB = 26, PR = 12

function minmax(s: FanSeries): [number, number] {
  return extent([...(s.history ?? []), ...s.p10, ...s.p90, ...(s.trend ?? [])])
}

const defaultLabel = (o: number) => (o === 0 ? 'сейчас' : o > 0 ? `+${o} мес` : `−${-o} мес`)

export function Fan({ a, b, fmt = axisNum, monthLabel = defaultLabel, backtestK = 0, height = 200, title, subtitle, badges, actions, ariaLabel, nameA = 'прогноз', nameB = 'сценарий B', className, compact, showLegend = true }: FanProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const hist = a.history ?? []
  const H = hist.length
  const N = a.p50.length - 1
  const fcStart = H > 0 ? H - 1 : 0
  const total = fcStart + N + 1
  const [loA, hiA] = minmax(a)
  const [loB, hiB] = b ? minmax(b) : [loA, hiA]
  const [lo, hi] = yDomain(Math.min(loA, loB), Math.max(hiA, hiB), false, 0.06)
  const ticks = yTicks(lo, hi, 3)
  const PL = Math.min(72, Math.max(34, 10 + ticks.reduce((m, t) => Math.max(m, fmt(t).length), 2) * 6.6))
  const plotW = Math.max(40, width - PL - PR)
  const plotH = Math.max(40, height - PT - PB)
  const X = useCallback((i: number) => PL + (i / Math.max(1, total - 1)) * plotW, [PL, total, plotW])
  const Y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * plotH
  const fc = (arr: ReadonlyArray<number>): XY[] => arr.map((v, f) => ({ x: X(fcStart + f), y: Y(v) }))
  const nowX = X(fcStart)
  const hoverApi = useHoverIndex(total, X)
  const hover = hoverApi.hover
  const k = backtestK

  const legend: LegendItem[] = fanLegend({ hasHistory: H > 0, hasTrend: Boolean(a.trend), hasB: Boolean(b), nameA, nameB })
  const rowLabel = (i: number) => monthLabel(i - fcStart)
  const atF = (arr: ReadonlyArray<number> | undefined, i: number) => (arr && i >= fcStart && i - fcStart < arr.length ? arr[i - fcStart] : NaN)
  const table: ChartTable = {
    columns: ['Месяц', 'Факт', 'P10', 'P50', 'P90', ...(a.trend ? ['Тренд'] : [])],
    rows: Array.from({ length: total }, (_, i) => [
      rowLabel(i), i < H ? fmt(hist[i]) : DASH, f(atF(a.p10, i), fmt), f(atF(a.p50, i), fmt), f(atF(a.p90, i), fmt), ...(a.trend ? [f(atF(a.trend, i), fmt)] : []),
    ]),
  }
  const isEmpty = a.p50.length === 0
  const label = ariaLabel ?? `Веер: медиана через ${N} мес ${fmt(a.p50[N] ?? 0)}, интервал ${fmt(a.p10[N] ?? 0)}–${fmt(a.p90[N] ?? 0)}`

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={badges} actions={actions} legend={showLegend ? legend : undefined} ariaLabel={label}
      table={isEmpty ? null : table} empty={isEmpty ? 'Нет прогноза' : undefined} className={className} compact={compact}>
      <div ref={ref} className="ch-plot" tabIndex={0} onPointerMove={hoverApi.onPointerMove} onPointerLeave={hoverApi.onPointerLeave}
        onKeyDown={hoverApi.onKeyDown} onBlur={hoverApi.onBlur}>
        <svg className="ch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Grid ticks={ticks} yAt={Y} x0={PL} x1={width - PR} />
          <YAxis ticks={ticks} yAt={Y} x={PL - 8} fmt={fmt} />
          <rect className="ch-fan__future" x={nowX} y={PT} width={Math.max(0, width - PR - nowX)} height={plotH} />
          {k > 0 && H > k && <rect className="ch-fan__bt" x={X(H - 1 - k)} y={PT} width={X(H - 1) - X(H - 1 - k)} height={plotH} />}
          <line className="ch-fan__now" x1={nowX} x2={nowX} y1={PT} y2={PT + plotH} />
          <line className="ch-baseline" x1={PL} x2={width - PR} y1={PT + plotH} y2={PT + plotH} />
          {b && <path className="ch-fan__band" fill="var(--chart-2)" d={bandPath(fc(b.p90), fc(b.p10))} />}
          <path className="ch-fan__band" fill="var(--chart-1)" d={bandPath(fc(a.p90), fc(a.p10))} />
          {a.p25 && a.p75 && <path className="ch-fan__band ch-fan__band--inner" fill="var(--chart-1)" d={bandPath(fc(a.p75), fc(a.p25))} />}
          {H > 0 && <path className="ch-fan__hist" d={linePath(hist.map((v, i) => ({ x: X(i), y: Y(v) })))} />}
          {k > 0 && H > k && hist.slice(H - k).map((v, i) => (
            <path key={i} className="ch-fan__fact" d={`M ${X(H - k + i)} ${Y(v) - 4} l 4 4 l -4 4 l -4 -4 z`} />
          ))}
          {b && <path className="ch-line" stroke="var(--chart-2)" d={linePath(fc(b.p50))} />}
          <path className="ch-line" stroke="var(--chart-1)" d={linePath(fc(a.p50))} />
          {a.trend && <path className="ch-line ch-line--dashed" stroke="var(--chart-2)" d={linePath(fc(a.trend))} />}
          <g className="ch-axis" aria-hidden="true">
            {H > 1 && <text className="ch-tick" x={PL} y={height - 8}>{monthLabel(-(H - 1))}</text>}
            <text className="ch-tick" x={nowX} y={height - 8} textAnchor={H > 1 ? 'middle' : 'start'}>{monthLabel(0)}</text>
            <text className="ch-tick" x={width - PR} y={height - 8} textAnchor="end">{monthLabel(N)}</text>
          </g>
          {hover != null && (
            <g>
              <Crosshair x={X(hover)} y0={PT} y1={PT + plotH} />
              {hover < H && <Marker x={X(hover)} y={Y(hist[hover])} color="var(--text)" />}
              {Number.isFinite(atF(a.p50, hover)) && <Marker x={X(hover)} y={Y(atF(a.p50, hover))} color="var(--chart-1)" />}
              <ChartTooltip x={X(hover)} y={PT} width={width} height={plotH} title={rowLabel(hover)} rows={[
                ...(hover < H ? [{ key: 'f', label: 'факт', value: fmt(hist[hover]), color: 'var(--text)' }] : []),
                ...(Number.isFinite(atF(a.p50, hover)) ? [
                  { key: '90', label: 'P90', value: fmt(atF(a.p90, hover)), color: 'var(--chart-1)' },
                  { key: '50', label: 'медиана', value: fmt(atF(a.p50, hover)), color: 'var(--chart-1)' },
                  { key: '10', label: 'P10', value: fmt(atF(a.p10, hover)), color: 'var(--chart-1)' },
                ] : []),
                ...(a.trend && Number.isFinite(atF(a.trend, hover)) ? [{ key: 't', label: 'тренд', value: fmt(atF(a.trend, hover)), color: 'var(--chart-2)' }] : []),
                ...(b && Number.isFinite(atF(b.p50, hover)) ? [{ key: 'b', label: `${nameB} · медиана`, value: fmt(atF(b.p50, hover)), color: 'var(--chart-2)' }] : []),
              ]} />
            </g>
          )}
        </svg>
      </div>
    </ChartFrame>
  )
}

/** Легенда веера — общая для карточки и для сетки малых кратных (одна над всеми). */
export function fanLegend({ hasHistory = true, hasTrend = false, hasB = false, nameA = 'прогноз', nameB = 'сценарий B' }: {
  hasHistory?: boolean; hasTrend?: boolean; hasB?: boolean; nameA?: string; nameB?: string
}): LegendItem[] {
  return [
    ...(hasHistory ? [{ key: 'hist', label: 'история (факт)', color: 'var(--text)', shape: 'line' as const }] : []),
    { key: 'band', label: `${nameA} · P10–P90`, color: 'var(--chart-1)', shape: 'band' },
    { key: 'p50', label: `${nameA} · медиана`, color: 'var(--chart-1)', shape: 'line' },
    ...(hasTrend ? [{ key: 'trend', label: 'тренд', color: 'var(--chart-2)', shape: 'line' as const, dashed: true }] : []),
    ...(hasB ? [{ key: 'b', label: `${nameB} · P10–P90`, color: 'var(--chart-2)', shape: 'band' as const }] : []),
  ]
}

function f(v: number, fmt: (v: number) => string): string {
  return Number.isFinite(v) ? fmt(v) : DASH
}
