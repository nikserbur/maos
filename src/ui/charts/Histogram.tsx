/**
 * Гистограмма (база — D2-гистограмма «Портфеля»): корзины-столбцы с 2 px зазором поверхности,
 * выделенный хвост (`highlight`) цветом ряда 4 плюс штриховка (второй признак, не зависящий от
 * цвета), вертикальные маркеры с подписью (VaR, E, CVaR) — текст `--text`, не цветом ряда;
 * контур второго распределения пунктиром (`outline` — «портфель макс. E»), квадратный маркер
 * «худший», скобка между двумя маркерами (E − CVaR); подсказка по корзине с доп. строками.
 * `domain` — жёсткая область оси X (окно вокруг основного распределения): корзины и контур вне
 * окна обрезаются, у края ставится отметка «→ до …», чтобы широкое сравнение не сжимало главное.
 * Подписи марок на дорожке раскладываются без наездов: справа · слева · строкой ниже.
 */
import { useCallback, useId, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Grid, XAxis, YAxis } from './Axis'
import { ChartTooltip, type TipRow } from './Tooltip'
import { useHoverIndex, useMeasuredWidth } from './hooks'
import { columnPath } from './Cartesian'
import type { LegendItem } from './palette'
import { axisNum, niceTicks, svgId, yTicks } from './scale'
import { TICK_CHAR_W } from './axisLayout'
import { joinRange, pct } from '../../explain/format'

export interface Bin { x0: number; x1: number; count: number }

export interface HistMarker {
  key: string
  x: number
  label: string
  /** Глиф состояния перед подписью (○ ● ▲ ■). */
  glyph?: string
  /** line — вертикальная линия на всю высоту (порог); dot/square — марка на дорожке под осью. */
  kind?: 'line' | 'dot' | 'square'
  /** Цвет марки dot/square (токен ряда). */
  color?: string
  /** Сторона подписи марки на дорожке; по умолчанию — автоматически без наездов. */
  side?: 'left' | 'right' | 'below'
}

interface HistogramProps {
  bins: ReadonlyArray<Bin>
  /** Корзины, попадающие в выделение (хвост α) — вторым цветом и штриховкой. */
  highlight?: (b: Bin) => boolean
  highlightLabel?: string
  markers?: ReadonlyArray<HistMarker>
  /** Второе распределение (доли по тем же корзинам) — пунктирный контур с подписью. */
  outline?: { shares: ReadonlyArray<number>; label: string }
  /** Скобка между двумя значениями X с подписью (E − CVaR). */
  bracket?: { from: number; to: number; label: string }
  /** Дополнительные строки подсказки по корзине. */
  tipRows?: (i: number) => ReadonlyArray<TipRow>
  fmtX?: (v: number) => string
  /** Расширить ось X за пределы корзин (например, до худшего сценария). */
  xExtent?: [number, number]
  /** Жёсткое окно оси X: корзины/контур вне окна обрезаются с отметкой у края. */
  domain?: [number, number]
  height?: number
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  ariaLabel?: string
  seriesLabel?: string
  legend?: ReadonlyArray<LegendItem>
  className?: string
}

const PT = 18, PR = 14, PL = 44, GAP = 2
const LANE = 22, ROW = 14, BRACKET = 22, PB_BASE = 28
const LABEL_PAD = 10, GLYPH_R = 8

type LaneSide = 'left' | 'right' | 'below'
interface LanePlaced { m: HistMarker; x: number; side: LaneSide; row: number }

/** Раскладка подписей на дорожке: справа, если влезает до соседней марки; иначе слева; иначе строкой ниже. */
function layoutLane(marks: ReadonlyArray<{ m: HistMarker; x: number }>, left: number, right: number): LanePlaced[] {
  const sorted = [...marks].sort((a, b) => a.x - b.x)
  const out: LanePlaced[] = []
  const rows: number[] = [] // правый край занятого места в каждой нижней строке
  let laneRight = left // правый край занятого места на самой дорожке
  sorted.forEach((it, i) => {
    const w = (it.m.label.length + (it.m.glyph ? 2 : 0)) * TICK_CHAR_W + 4
    const nextX = i + 1 < sorted.length ? sorted[i + 1].x - GLYPH_R : right
    const forced = it.m.side
    const fitsRight = it.x + LABEL_PAD + w <= nextX
    const fitsLeft = it.x - LABEL_PAD - w >= Math.max(left, laneRight)
    let side: LaneSide = forced ?? (fitsRight ? 'right' : fitsLeft ? 'left' : 'below')
    let row = 0
    if (side === 'right') laneRight = it.x + LABEL_PAD + w
    else if (side === 'left') laneRight = it.x + GLYPH_R
    else {
      row = rows.findIndex((r) => it.x - w / 2 >= r + 6)
      if (row < 0) row = rows.length
      rows[row] = it.x + w / 2
      laneRight = Math.max(laneRight, it.x + GLYPH_R)
      side = 'below'
    }
    out.push({ m: it.m, x: it.x, side, row })
  })
  return out
}

export function Histogram({
  bins, highlight, highlightLabel = 'хвост', markers = [], outline, bracket, tipRows, fmtX = axisNum, xExtent, domain, height = 220, title, subtitle, badges, actions, ariaLabel,
  seriesLabel = 'доля прогонов', legend: legendOverride, className,
}: HistogramProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const rid = useId()
  const hatchId = svgId(rid, 'hhatch')
  const n = bins.length
  const total = bins.reduce((a, b) => a + b.count, 0) || 1
  const x0 = domain ? domain[0] : Math.min(n ? bins[0].x0 : 0, xExtent?.[0] ?? Infinity)
  const x1 = domain ? domain[1] : Math.max(n ? bins[n - 1].x1 : 1, xExtent?.[1] ?? -Infinity)
  const plotW = Math.max(40, width - PL - PR)
  const xAt = useCallback((v: number) => PL + Math.max(0, Math.min(1, (v - x0) / (x1 - x0 || 1))) * plotW, [x0, x1, plotW])
  const inside = (b: Bin) => b.x1 > x0 && b.x0 < x1
  const visible = bins.map((b, i) => ({ b, i })).filter(({ b }) => inside(b))

  // Дорожка марок: раскладка подписей до вертикальной геометрии (зависит только от X).
  const laneMarks = markers.filter((m) => m.kind === 'dot' || m.kind === 'square').map((m) => ({ m, x: xAt(m.x) }))
  const lane = layoutLane(laneMarks, PL, width - PR)
  const belowRows = lane.reduce((a, p) => (p.side === 'below' ? Math.max(a, p.row + 1) : a), 0)
  const hasLane = lane.length > 0
  const PB = PB_BASE + (hasLane ? LANE + belowRows * ROW : 0) + (bracket ? BRACKET : 0)
  const plotH = Math.max(40, height - PT - PB)
  const shares = bins.map((b) => b.count / total)
  const maxShare = Math.max(0.01, ...visible.map(({ i }) => shares[i]), ...visible.map(({ i }) => outline?.shares[i] ?? 0))
  const yTk = yTicks(0, maxShare * 1.08, 3)
  const yMax = Math.max(maxShare * 1.08, yTk[yTk.length - 1])
  const yAt = (s: number) => PT + (1 - s / yMax) * plotH
  const yBase = yAt(0)
  const laneY = yBase + PB_BASE + LANE / 2
  const bracketY = laneY + 11 + belowRows * ROW
  const xTicks = niceTicks(x0, x1, 5)
  const centerX = useCallback((k: number) => { const b = visible[k].b; return xAt((Math.max(b.x0, x0) + Math.min(b.x1, x1)) / 2) }, [visible, xAt, x0, x1])
  const hoverApi = useHoverIndex(visible.length, centerX)
  const hover = hoverApi.hover != null ? visible[hoverApi.hover]?.i ?? null : null

  const hasHi = Boolean(highlight && bins.some(highlight))
  const legend: ReadonlyArray<LegendItem> = legendOverride ?? [
    { key: 'main', label: seriesLabel, color: 'var(--chart-1)', shape: 'rect' },
    ...(hasHi ? [{ key: 'hi', label: highlightLabel, color: 'var(--chart-4)', shape: 'rect' as const }] : []),
    ...(outline ? [{ key: 'outline', label: outline.label, color: 'var(--chart-2)', shape: 'line' as const, dashed: true }] : []),
  ]
  // Таблица-двойник — все корзины, включая обрезанные окном: каждое число графика доступно.
  const table: ChartTable = {
    columns: ['Интервал', seriesLabel, 'Прогонов', ...(outline ? [outline.label] : [])],
    rows: bins.map((b, i) => [`${fmtX(b.x0)} – ${fmtX(b.x1)}`, pct(shares[i], 1), String(b.count), ...(outline ? [pct(outline.shares[i] ?? 0, 1)] : [])]),
  }
  const outlinePath = outline && visible.length
    ? visible.map(({ b, i }, k) => `${k === 0 ? `M${xAt(b.x0)},${yBase}` : ''}V${yAt(outline.shares[i] ?? 0)}H${xAt(b.x1)}`).join('') + `V${yBase}`
    : ''
  // Масса контура за окном — отметка у края с пределом оси.
  const beyondRight = outline ? bins.some((b, i) => b.x0 >= x1 && (outline.shares[i] ?? 0) > 0) : false
  const beyondLeft = outline ? bins.some((b, i) => b.x1 <= x0 && (outline.shares[i] ?? 0) > 0) : false

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={badges} actions={actions} legend={legend} table={n ? table : null}
      ariaLabel={ariaLabel ?? `Гистограмма: ${n} корзин`} empty={n === 0 ? 'Нет распределения' : undefined} className={className}>
      <div ref={ref} className="ch-plot" tabIndex={0} onPointerMove={hoverApi.onPointerMove} onPointerLeave={hoverApi.onPointerLeave}
        onKeyDown={hoverApi.onKeyDown} onBlur={hoverApi.onBlur}>
        <svg className="ch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect className="ch-hist__hatch" x="0" y="0" width="2" height="6" />
            </pattern>
          </defs>
          <Grid ticks={yTk} yAt={yAt} x0={PL} x1={width - PR} />
          <YAxis ticks={yTk} yAt={yAt} x={PL - 8} fmt={(v) => pct(v, 0)} />
          <XAxis labels={xTicks.map(fmtX)} xAt={(i) => xAt(xTicks[i])} y={yBase} x0={PL} x1={width - PR} />
          {visible.map(({ b, i }) => {
            const bx = xAt(b.x0) + GAP / 2
            const bw = Math.max(1, xAt(b.x1) - xAt(b.x0) - GAP)
            const y = yAt(shares[i])
            const hi = highlight?.(b)
            const dim = hover != null && hover !== i
            const d = columnPath(bx, y, bw, Math.max(0.5, yBase - y))
            return (
              <g key={i} className={`ch-col${dim ? ' is-dim' : ''}`}>
                <path fill={hi ? 'var(--chart-4)' : 'var(--chart-1)'} d={d} />
                {hi && <path fill={`url(#${hatchId})`} d={d} />}
              </g>
            )
          })}
          {outline && <path className="ch-hist__outline" d={outlinePath} />}
          {beyondRight && <text className="ch-tick ch-hist__beyond" x={width - PR} y={PT + 18} textAnchor="end">{outline?.label} → до {fmtX(bins[n - 1].x1)}</text>}
          {beyondLeft && <text className="ch-tick ch-hist__beyond" x={PL} y={PT + 30} textAnchor="start">← от {fmtX(bins[0].x0)} {outline?.label}</text>}
          {markers.filter((m) => (m.kind ?? 'line') === 'line' && m.x >= x0 && m.x <= x1).map((m) => {
            const mx = xAt(m.x)
            const right = mx > width * 0.7
            return (
              <g key={m.key} className="ch-vmark">
                <line x1={mx} x2={mx} y1={PT - 4} y2={yBase} />
                <text x={mx + (right ? -6 : 6)} y={PT + 6} textAnchor={right ? 'end' : 'start'} className="ch-vmark__label">
                  {m.glyph ? `${m.glyph} ` : ''}{m.label}
                </text>
              </g>
            )
          })}
          {lane.map(({ m, x: mx, side, row }) => {
            const tx = side === 'left' ? mx - LABEL_PAD : side === 'right' ? mx + LABEL_PAD : mx
            const ty = side === 'below' ? laneY + 18 + row * ROW : laneY + 4
            return (
              <g key={m.key} className="ch-hist__lanemark">
                <line className="ch-hist__drop" x1={mx} x2={mx} y1={yBase} y2={laneY - 7} />
                {m.kind === 'dot'
                  ? <circle className="ch-marker" cx={mx} cy={laneY} r={6} fill={m.color ?? 'var(--chart-1)'} />
                  : <rect className="ch-marker" x={mx - 5} y={laneY - 5} width={10} height={10} fill={m.color ?? 'var(--chart-4)'} />}
                <text x={tx} y={ty} textAnchor={side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle'} className="ch-endlabel">
                  {m.glyph ? `${m.glyph} ` : ''}{m.label}
                </text>
              </g>
            )
          })}
          {bracket && xAt(bracket.to) - xAt(bracket.from) > 24 && (
            <g className="ch-hist__bracket">
              <path d={`M${xAt(bracket.from)},${bracketY}V${bracketY + 5}H${xAt(bracket.to)}V${bracketY}`} />
              <text x={(xAt(bracket.from) + xAt(bracket.to)) / 2} y={bracketY + 19} textAnchor="middle" className="ch-tick">{bracket.label}</text>
            </g>
          )}
          {hover != null && (
            <ChartTooltip x={centerX(hoverApi.hover ?? 0)} y={PT} width={width} height={plotH} title={joinRange(fmtX(bins[hover].x0), fmtX(bins[hover].x1))}
              rows={[
                { key: 's', label: seriesLabel, value: pct(shares[hover], 1), color: highlight?.(bins[hover]) ? 'var(--chart-4)' : 'var(--chart-1)' },
                { key: 'n', label: 'прогонов', value: String(bins[hover].count) },
                ...(outline ? [{ key: 'o', label: outline.label, value: pct(outline.shares[hover] ?? 0, 1), color: 'var(--chart-2)' }] : []),
                ...(tipRows ? tipRows(hover) : []),
              ]} />
          )}
        </svg>
      </div>
    </ChartFrame>
  )
}
