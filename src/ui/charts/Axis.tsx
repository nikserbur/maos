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
  /** Подпись оси над делениями («ч», «ожидаемая прибыль, ₽ ↑») — от левого края svg вправо, не обрезается. */
  unit?: string
  /** Верх плота, px: подпись оси стоит над ним (графику с подписью нужен отступ сверху ≥ UNIT_PT). */
  top?: number
}

/** Отступ сверху у графика с подписью оси Y: строка подписи над верхним делением, px. */
export const UNIT_PT = 26

/** Подписи оси Y справа-налево у левого края плота; подпись оси — строкой над ними от x = 0. */
export function YAxis({ ticks, yAt, x, fmt, unit, top }: YAxisProps) {
  return (
    <g className="ch-axis ch-axis--y" aria-hidden="true">
      {ticks.map((t) => (
        <text key={t} x={x} y={yAt(t) + 3.5} textAnchor="end" className="ch-tick">{fmt(t)}</text>
      ))}
      {unit && top !== undefined && (
        <text x={0} y={Math.max(11, top - 10)} textAnchor="start" className="ch-tick ch-tick--unit">{unit}</text>
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
  /** @deprecated Повёрнутые подписи не используются (X2: подписи читаются горизонтально — разрежаются по месту). */
  rotate?: boolean
  /** Подписывать только эти индексы (даты: начало месяца/квартала); прочие — без подписи. */
  tickIndices?: ReadonlyArray<number>
  /** Индексы подписей, которые не пропускаются никогда («сейчас» у веера); крайние уступают им место. */
  keep?: ReadonlyArray<number>
}

/** Высота полосы оси X без поворота подписей, px. */
export const X_AXIS_H = 28
/** @deprecated Высота полосы оси X при повёрнутых подписях — подписи больше не поворачиваются. */
export const X_AXIS_ROTATED_H = 52

/**
 * Базовая линия + подписи оси X (категории/даты): по центру деления, у краёв прижаты к плоту,
 * наезжающие — пропускаются, при большом числе пропусков — равномерный шаг (placeXLabels).
 */
export function XAxis({ labels, xAt, y, step = 1, x0, x1, charW = TICK_CHAR_W, gap = TICK_GAP, tickIndices, keep = [] }: XAxisProps) {
  const idx = tickIndices ? tickIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < labels.length) : labels.map((_, i) => i)
  const xs = idx.map((i) => xAt(i))
  const priority = keep.map((k) => idx.indexOf(k)).filter((k) => k >= 0)
  const placed = placeXLabels(idx.map((i) => labels[i]), xs, x0, x1, charW, gap, tickIndices ? 1 : step, priority)
    .map((p) => ({ ...p, i: idx[p.i] }))
  return (
    <g className="ch-axis ch-axis--x" aria-hidden="true">
      <line className="ch-baseline" x1={x0} x2={x1} y1={y} y2={y} />
      {placed.map(({ i, tx }) => <text key={i} x={tx} y={y + 16} textAnchor="middle" className="ch-tick">{labels[i]}</text>)}
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
