/**
 * Плотность 150×46 (UX-V2 §6.2 `DensityMini`, из `DistPreview`): форма хвостов по типу
 * распределения и относительной σ; центр — пунктир. Только токены темы; aria — текстом.
 */
import type { DistType } from '../lib/api'
import { pct } from '../explain/format'
import './fields.css'

interface DensityMiniProps {
  type: DistType
  /** σ / центр (относительный разброс). */
  rel: number
  width?: number
  height?: number
  label?: string
}

export function densityPoints(type: DistType, rel: number, w: number, h: number): string {
  const s = Math.max(0.05, Math.min(0.6, rel || 0.12))
  const pdf = (x: number): number => {
    switch (type) {
      case 't': return Math.pow(1 + (x * x) / (5 * s * s), -3)
      case 'pareto': return Math.exp(-Math.abs(x) / (s * 2.2))
      case 'uniform': return Math.abs(x) < 1.7 * s ? 1 : 0.02
      case 'triangular': return Math.max(0.02, 1 - Math.abs(x) / (2 * s))
      case 'lognormal': { const y = x + 2.2 * s; return y > 0 ? Math.exp(-Math.pow(Math.log(y / (2.2 * s)), 2) / (2 * s * s)) / y : 0 }
      default: return Math.exp(-(x * x) / (2 * s * s))
    }
  }
  const xs = Array.from({ length: 61 }, (_, i) => (i / 60 - 0.5) * 2.4)
  const ys = xs.map(pdf)
  const my = Math.max(...ys) || 1
  return xs.map((x, i) => `${r1((x / 2.4 + 0.5) * w)},${r1(h - 3 - (ys[i] / my) * (h - 8))}`).join(' ')
}

/** Координата SVG с одним знаком после точки (точка — синтаксис SVG, не локаль). */
const r1 = (v: number): number => Math.round(v * 10) / 10

const TYPE_LABEL: Record<DistType, string> = {
  normal: 'нормальное', lognormal: 'логнормальное', triangular: 'треугольное', uniform: 'равномерное',
  t: 'Стьюдента (тяжёлые хвосты)', pareto: 'Парето (скачки)',
}

export function DensityMini({ type, rel, width = 150, height = 46, label }: DensityMiniProps) {
  const pts = densityPoints(type, rel, width, height)
  return (
    <svg className="pf-density" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
         aria-label={label ?? `Плотность: ${TYPE_LABEL[type]}, σ ${pct(rel, 0)} от центра`}>
      <polygon className="pf-density__area" points={`0,${height} ${pts} ${width},${height}`} />
      <polyline className="pf-density__line" points={pts} />
      <line className="pf-density__center" x1={width / 2} y1={2} x2={width / 2} y2={height - 3} />
    </svg>
  )
}

export { TYPE_LABEL as DIST_TYPE_LABEL }
