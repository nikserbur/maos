import { useId } from 'react'
import './charts.css'

interface SparklineProps {
  points: number[]
  color?: string
  height?: number
  /** Индекс подсвеченной точки (текущий план); по умолчанию — последняя. */
  mark?: number
}

const VW = 120

/** Мини-спарклайн: линия 1.5 px со скруглёнными концами + градиент к прозрачному. Нет ряда — ничего. */
export function Sparkline({ points, color = 'var(--chart-1)', height = 34, mark }: SparklineProps) {
  const uid = useId().replace(/:/g, '')
  const pts = points.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v))
  if (pts.length < 2) return null
  const lo = Math.min(...pts.map((p) => p.v))
  const hi = Math.max(...pts.map((p) => p.v))
  const span = hi - lo || 1
  const n = points.length
  const x = (i: number) => (n === 1 ? VW / 2 : (i / (n - 1)) * (VW - 4) + 2)
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (height - 6)
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${x(pts[0].i).toFixed(1)},${height} ${line} ${x(pts[pts.length - 1].i).toFixed(1)},${height}`
  const markAt = pts.find((p) => p.i === (mark ?? pts[pts.length - 1].i)) ?? pts[pts.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${VW} ${height}`} preserveAspectRatio="none" height={height} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.3 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${uid}-s)`} />
      <polyline className="spark__line" points={line} stroke={color} />
      {/* Точка — штрих нулевой длины с круглым концом: остаётся кругом при preserveAspectRatio="none". */}
      <path className="spark__dot" d={`M ${x(markAt.i).toFixed(1)} ${y(markAt.v).toFixed(1)} h 0.01`} stroke={color} />
    </svg>
  )
}
