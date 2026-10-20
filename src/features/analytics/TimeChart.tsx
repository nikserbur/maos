import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { EmptyState } from '../nsi/kit/States'
import type { ChartType } from './dashboardConfig'
import './charts.css'

/** Один ряд графика: значения выровнены с labels по индексу (NaN — разрыв). */
export interface ChartSeries {
  key: string
  name: string
  color: string
  fmtY: (v: number) => string
  points: number[]
}

interface TimeChartProps {
  labels: string[]
  series: ChartSeries[]
  type: ChartType
  height?: number
  /** Подпись для экранного диктора (что изображено). */
  ariaLabel?: string
  emptyText?: string
}

const W = 760
const PL = 56, PR = 14, PT = 14, PB = 28
const GRID = [0, 0.25, 0.5, 0.75, 1]

/** Отрезки ломаной без NaN: [[x,y],…] по непрерывным участкам. */
function segments(points: number[], xAt: (i: number) => number, yAt: (v: number) => number): string[] {
  const out: string[] = []
  let cur: string[] = []
  points.forEach((v, i) => {
    if (Number.isFinite(v)) cur.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
    else if (cur.length) { out.push(cur.join(' ')); cur = [] }
  })
  if (cur.length) out.push(cur.join(' '))
  return out
}

/**
 * График во времени (линия / область / столбцы) на чистом SVG в токенах --chart-*.
 * Пунктирная бледная сетка, оси без рамки, моно-цифры; градиентная область;
 * наведение (или ←/→ с клавиатуры) — перекрестие, маркеры и подсказка.
 */
export function TimeChart({ labels, series, type, height = 240, ariaLabel, emptyText }: TimeChartProps) {
  const uid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const H = height
  const n = labels.length
  const plotW = W - PL - PR, plotH = H - PT - PB

  const all = series.flatMap((s) => s.points).filter((v) => Number.isFinite(v))
  if (n === 0 || series.length === 0 || all.length === 0) {
    return (
      <EmptyState compact variant="chart" title="Нет данных для выбранных метрик"
        text={emptyText ?? 'Постройте план на экране «План» — показатели появятся по каждому построению.'} />
    )
  }

  // Домен Y: столбцы и область включают 0; линия — по данным с полями.
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (type !== 'line') lo = Math.min(0, lo)
  if (hi === lo) hi = lo + (Math.abs(lo) || 1)
  const pad = (hi - lo) * 0.08
  hi += pad
  if (type === 'line') lo -= pad

  const xAt = (i: number) => (n === 1 ? PL + plotW / 2 : PL + (i / (n - 1)) * plotW)
  const yAt = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * plotH
  const yBase = yAt(type === 'line' ? lo : Math.max(lo, 0))
  const fmtY0 = series[0].fmtY
  const xStep = Math.max(1, Math.ceil(n / 8))
  const barGroupW = (plotW / Math.max(1, n)) * 0.66
  const barW = barGroupW / series.length

  const pick = (clientX: number, rect: DOMRect) => {
    const relX = ((clientX - rect.left) / rect.width) * W
    const i = n === 1 ? 0 : Math.round(((relX - PL) / plotW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const onMove = (e: MouseEvent<HTMLDivElement>) => pick(e.clientX, e.currentTarget.getBoundingClientRect())
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setHover((h) => {
      const cur = h ?? (e.key === 'ArrowLeft' ? n : -1)
      return Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)))
    })
  }

  const hx = hover != null ? xAt(hover) : 0
  const hv = hover != null ? series[0].points[hover] : Number.NaN
  const tipRight = hover != null && hx / W > 0.62

  return (
    <div className="tc" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
         tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}
         role="img" aria-label={ariaLabel ?? `График: ${series.map((s) => s.name).join(', ')}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="tc__svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          {series.map((s, si) => (
            <linearGradient key={s.key} id={`${uid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: type === 'bar' ? 0.95 : 0.28 }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: type === 'bar' ? 0.55 : 0 }} />
            </linearGradient>
          ))}
        </defs>

        {GRID.map((f) => {
          const gv = lo + (hi - lo) * f
          return (
            <g key={f}>
              <line className="tc__grid" x1={PL} x2={W - PR} y1={yAt(gv)} y2={yAt(gv)} />
              <text className="tc__axis" x={PL - 8} y={yAt(gv) + 3.5} textAnchor="end">{fmtY0(gv)}</text>
            </g>
          )
        })}
        <line className="tc__base" x1={PL} x2={W - PR} y1={yBase} y2={yBase} />
        {labels.map((lb, i) => (i % xStep === 0 || i === n - 1) && (
          <text key={i} className="tc__axis" x={xAt(i)} y={H - 8} textAnchor="middle">{lb}</text>
        ))}

        {series.map((s, si) => {
          if (type === 'bar') {
            return (
              <g key={s.key}>
                {s.points.map((v, i) => {
                  if (!Number.isFinite(v)) return null
                  const x = xAt(i) - barGroupW / 2 + si * barW
                  const y = yAt(v)
                  return <rect key={i} x={x} y={Math.min(y, yBase)} width={Math.max(1.5, barW - 2)}
                               height={Math.max(0.5, Math.abs(yBase - y))} rx={2}
                               fill={`url(#${uid}-g${si})`} opacity={hover == null || hover === i ? 1 : 0.55} />
                })}
              </g>
            )
          }
          const segs = segments(s.points, xAt, yAt)
          return (
            <g key={s.key}>
              {type === 'area' && segs.map((pts, k) => {
                const xs = pts.split(' ')
                const first = xs[0].split(',')[0], last = xs[xs.length - 1].split(',')[0]
                return <polygon key={k} points={`${first},${yBase} ${pts} ${last},${yBase}`} fill={`url(#${uid}-g${si})`} />
              })}
              {segs.map((pts, k) => <polyline key={k} className="tc__line" points={pts} stroke={s.color} />)}
              {n <= 24 && s.points.map((v, i) => Number.isFinite(v) && (
                <circle key={i} className="tc__dot" cx={xAt(i)} cy={yAt(v)} r={2.6} stroke={s.color} />
              ))}
            </g>
          )
        })}

        {hover != null && (
          <g className="tc__cross" aria-hidden="true">
            <line x1={hx} x2={hx} y1={PT} y2={PT + plotH} />
            {Number.isFinite(hv) && <line x1={PL} x2={W - PR} y1={yAt(hv)} y2={yAt(hv)} />}
            {series.map((s) => Number.isFinite(s.points[hover]) && (
              <circle key={s.key} className="tc__marker" cx={hx} cy={yAt(s.points[hover])} r={4.2} fill={s.color} />
            ))}
          </g>
        )}
      </svg>

      {hover != null && (
        <div className={`tc__tip${tipRight ? ' tc__tip--left' : ''}`} style={{ left: `${(hx / W) * 100}%` }}>
          <div className="tc__tip-x">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="tc__tip-row">
              <span className="tc__dotkey" style={{ background: s.color }} />
              <span className="tc__tip-n">{s.name}</span>
              <span className="tc__tip-v num">{Number.isFinite(s.points[hover]) ? s.fmtY(s.points[hover]) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
