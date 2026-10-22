/**
 * Оси и сетка (dataviz «marks-and-anatomy»): сетка — сплошные волосяные линии `--chart-grid`
 * (никогда пунктир), ≤ 4–5 линий; ось — `--chart-axis`; подписи — `--text-muted` 11 px
 * `tabular-nums`, компактные значения через форматтеры chart-системы.
 */
import { TICK_CHAR_W, TICK_GAP, placeXLabels } from './axisLayout'

interface GridProps {
  ticks: ReadonlyArray<number>
  yAt: (v: number) => number
  x0: number
  x1: number
}

/** Горизонтальные линии сетки по делениям оси Y. */
export function Grid({ ticks, yAt, x0, x1 }: GridProps) {
  return (
    <g className="ch-grid" aria-hidden="true">
      {ticks.map((t) => {
        const y = yAt(t)
        return <line key={t} x1={x0} x2={x1} y1={y} y2={y} />
      })}
    </g>
  )
}

interface YAxisProps {
  ticks: ReadonlyArray<number>
  yAt: (v: number) => number
  /** Правый край подписей (ось рисуется у plot-левого края). */
  x: number
  fmt: (v: number) => string
  /** Подпись единицы над осью («ч», «₽») — одно слово в углу. */
  unit?: string
  top?: number
}

/** Подписи оси Y справа-налево у левого края плота; без рамки. */
export function YAxis({ ticks, yAt, x, fmt, unit, top }: YAxisProps) {
  return (
    <g className="ch-axis ch-axis--y" aria-hidden="true">
      {ticks.map((t) => (
        <text key={t} x={x} y={yAt(t) + 3.5} textAnchor="end" className="ch-tick">{fmt(t)}</text>
      ))}
      {unit && top !== undefined && (
        <text x={x} y={top - 4} textAnchor="end" className="ch-tick ch-tick--unit">{unit}</text>
      )}
    </g>
  )
}

interface XAxisProps {
  labels: ReadonlyArray<string>
  xAt: (i: number) => number
  y: number
  /** Показывать каждую `step`-ю подпись (и последнюю всегда). */
  step?: number
  x0: number
  x1: number
  /** Ширина символа подписи, px (моно 11 px ≈ 6,7). */
  charW?: number
  /** Зазор между соседними подписями, px. */
  gap?: number
  /** Повернуть подписи на −30° (якорь — конец строки); нужна полоса оси `X_AXIS_ROTATED_H`. */
  rotate?: boolean
}

/** Высота полосы оси X без поворота подписей, px. */
export const X_AXIS_H = 28
/** Высота полосы оси X при повёрнутых подписях (длина подписи ≈ 11 символов), px. */
export const X_AXIS_ROTATED_H = 52

/**
 * Базовая линия + подписи оси X (категории/даты): по центру деления, у краёв прижаты к плоту,
 * наезжающие — пропускаются, при большом числе пропусков — равномерный шаг (placeXLabels).
 */
export function XAxis({ labels, xAt, y, step = 1, x0, x1, charW = TICK_CHAR_W, gap = TICK_GAP, rotate = false }: XAxisProps) {
  const xs = labels.map((_, i) => xAt(i))
  // При повороте ширина проекции подписи на ось ≈ cos 30° от исходной — берём её для зазоров.
  const placed = placeXLabels(labels, xs, x0, x1, rotate ? charW * 0.87 : charW, gap, step)
  return (
    <g className="ch-axis ch-axis--x" aria-hidden="true">
      <line className="ch-baseline" x1={x0} x2={x1} y1={y} y2={y} />
      {placed.map(({ i, tx }) => rotate
        ? <text key={i} x={tx} y={y + 14} textAnchor="end" transform={`rotate(-30 ${tx} ${y + 14})`} className="ch-tick">{labels[i]}</text>
        : <text key={i} x={tx} y={y + 16} textAnchor="middle" className="ch-tick">{labels[i]}</text>)}
    </g>
  )
}

/** Вертикальное перекрестие наведения — сплошная волосяная линия цвета оси. */
export function Crosshair({ x, y0, y1 }: { x: number; y0: number; y1: number }) {
  return <line className="ch-cross" x1={x} x2={x} y1={y0} y2={y1} aria-hidden="true" />
}

/** Маркер ряда: ≥ 8 px с 2 px кольцом поверхности, чтобы читался поверх линии. */
export function Marker({ x, y, color, r = 4 }: { x: number; y: number; color: string; r?: number }) {
  return <circle className="ch-marker" cx={x} cy={y} r={r} fill={color} />
}
