/**
 * Спарклайн: линия 1,5 px одного цвета ряда, заливка 10 %, точка-маркер ≥ 8 px с кольцом
 * поверхности на выбранной (текущей) или последней точке. Нет ряда — ничего. `aria-hidden`:
 * число рядом несёт смысл, спарклайн — тренд. Один компонент для Плана и Аналитики.
 */
import { areaPath, linePath, type XY } from './scale'
import './charts.css'

interface SparklineProps {
  points: ReadonlyArray<number>
  color?: string
  height?: number
  width?: number
  /** Индекс подсвеченной точки (текущий план); по умолчанию — последняя конечная. */
  mark?: number
  /** Без заливки под линией. */
  bare?: boolean
}

export function Sparkline({ points, color = 'var(--chart-1)', height = 34, width = 120, mark, bare = false }: SparklineProps) {
  const pts = points.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v))
  if (pts.length < 2) return null
  const lo = Math.min(...pts.map((p) => p.v))
  const hi = Math.max(...pts.map((p) => p.v))
  const span = hi - lo || 1
  const n = points.length
  const x = (i: number) => (n === 1 ? width / 2 : 4 + (i / (n - 1)) * (width - 8))
  const y = (v: number) => 5 + (1 - (v - lo) / span) * (height - 10)
  const xy: XY[] = pts.map((p) => ({ x: x(p.i), y: y(p.v) }))
  const markAt = pts.find((p) => p.i === (mark ?? pts[pts.length - 1].i)) ?? pts[pts.length - 1]
  return (
    <svg className="ch-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {!bare && <path className="ch-spark__area" d={areaPath(xy, height)} fill={color} />}
      <path className="ch-spark__line" d={linePath(xy)} stroke={color} />
      <circle className="ch-marker" cx={x(markAt.i)} cy={y(markAt.v)} r={3.5} fill={color} />
    </svg>
  )
}
