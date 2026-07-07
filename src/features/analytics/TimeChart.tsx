import { useState } from 'react'
import type { ChartType } from './dashboardConfig'

/** Один ряд графика: значения выровнены с labels по индексу. */
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
}

const W = 760
const PL = 62, PR = 14, PT = 16, PB = 30

/**
 * Интерактивный график во времени (линия/область/столбики) на чистом SVG.
 * Общая ось X по индексу labels; несколько рядов делят вертикальную шкалу.
 * Наведение — вертикальный визир + точки + всплывающая подсказка со значениями.
 */
export function TimeChart({ labels, series, type, height = 240 }: TimeChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const H = height
  const n = labels.length
  const plotW = W - PL - PR, plotH = H - PT - PB

  if (n === 0 || series.length === 0) {
    return <div className="an__chart-empty">Нет данных для выбранных метрик. Постройте план на экране «План».</div>
  }

  // Домен Y: столбики/область включают базовую линию 0; линия — по данным с полями.
  const all = series.flatMap((s) => s.points).filter((v) => Number.isFinite(v))
  let lo = all.length ? Math.min(...all) : 0
  let hi = all.length ? Math.max(...all) : 1
  if (type !== 'line') lo = Math.min(0, lo)
  if (hi === lo) hi = lo + 1
  const pad = (hi - lo) * 0.08
  hi += pad; if (type === 'line') lo -= pad

  const xAt = (i: number) => (n === 1 ? PL + plotW / 2 : PL + (i / (n - 1)) * plotW)
  const yAt = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * plotH
  const yBase = yAt(type === 'line' ? lo : Math.max(lo, 0))

  // Горизонтальная сетка + подписи Y (форматируем через первый ряд).
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f)
  const fmtY0 = series[0].fmtY

  // Прореживание подписей X, чтобы не наезжали.
  const xStep = Math.max(1, Math.ceil(n / 10))

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * W
    const frac = (relX - PL) / plotW
    const i = Math.round(frac * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const barGroupW = (plotW / n) * 0.72
  const barW = barGroupW / series.length

  return (
    <div className="an__chart" style={{ position: 'relative' }}
         onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }}>
        {/* Сетка + подписи Y */}
        {grid.map((gv, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={yAt(gv)} y2={yAt(gv)} stroke="var(--border)" strokeWidth={1} strokeOpacity={0.5} />
            <text x={PL - 6} y={yAt(gv) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">{fmtY0(gv)}</text>
          </g>
        ))}
        {/* Подписи X */}
        {labels.map((lb, i) => (i % xStep === 0 || i === n - 1) && (
          <text key={i} x={xAt(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--text-muted)">{lb}</text>
        ))}

        {/* Ряды */}
        {series.map((s) => {
          const pts = s.points.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')
          if (type === 'bar') {
            return (
              <g key={s.key}>
                {s.points.map((v, i) => {
                  const gi = series.indexOf(s)
                  const x = xAt(i) - barGroupW / 2 + gi * barW
                  const y = yAt(v), h = Math.max(0, yBase - y)
                  return <rect key={i} x={x} y={Math.min(y, yBase)} width={Math.max(1, barW - 1)} height={Math.abs(h)}
                               fill={s.color} opacity={0.85} rx={1} />
                })}
              </g>
            )
          }
          return (
            <g key={s.key}>
              {type === 'area' && n > 1 && (
                <polygon points={`${xAt(0)},${yBase} ${pts} ${xAt(n - 1)},${yBase}`} fill={s.color} opacity={0.14} />
              )}
              {n > 1 && <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />}
              {s.points.map((v, i) => <circle key={i} cx={xAt(i)} cy={yAt(v)} r={n > 40 ? 0 : 2.4} fill={s.color} />)}
            </g>
          )
        })}

        {/* Визир при наведении */}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={PT} y2={PT + plotH} stroke="var(--text-muted)" strokeDasharray="3 3" strokeOpacity={0.7} />
            {series.map((s) => <circle key={s.key} cx={xAt(hover)} cy={yAt(s.points[hover])} r={3.5} fill={s.color} stroke="var(--bg-panel)" strokeWidth={1.5} />)}
          </g>
        )}
      </svg>

      {/* Подсказка */}
      {hover != null && (
        <div className="an__chart-tip" style={{ left: `${(xAt(hover) / W) * 100}%` }}>
          <div className="an__chart-tip-x">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="an__chart-tip-row">
              <span className="an__chart-dot" style={{ background: s.color }} />
              <span className="an__chart-tip-n">{s.name}</span>
              <span className="an__chart-tip-v">{s.fmtY(s.points[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
