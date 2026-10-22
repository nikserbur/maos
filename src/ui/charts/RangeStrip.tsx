/**
 * Полоса диапазона (из `TailStrip` Плана, X1 §8 «RangeStrip»): одна ось значений, на ней —
 * отметки-глифы состояний (○ детерминированное · ● E · ▲ CVaR · ■ худший) и заштрихованная зона
 * хвоста. Рисуется в пикселях по измеренной ширине (без inline-стилей), подписи — текстовыми
 * токенами; числа у отметок — по желанию (`showValues`), иначе только у выделенных.
 */
import { useId } from 'react'
import { useMeasuredWidth } from './hooks'
import { svgId } from './scale'
import './charts.css'

export type RangeGlyph = 'ring' | 'dot' | 'triangle' | 'square'

export interface RangeMark {
  key: string
  value: number
  label: string
  glyph: RangeGlyph
  /** Тон глифа: нейтральный/главный/предупреждение/опасность. */
  tone?: 'idle' | 'accent' | 'warn' | 'danger'
  /** Показывать число под отметкой. */
  showValue?: boolean
}

interface RangeStripProps {
  marks: ReadonlyArray<RangeMark>
  fmt: (v: number) => string
  /** Заштрихованная зона [от, до] в единицах шкалы (хвост CVaR…худший). */
  zone?: [number, number]
  zoneLabel?: string
  ariaLabel?: string
  className?: string
}

const H = 46
const TRACK_Y = 13
const PAD = 8

function glyphPath(g: RangeGlyph, x: number, y: number, r: number): string {
  switch (g) {
    case 'triangle': return `M${x},${y - r}L${x + r},${y + r * 0.9}H${x - r}Z`
    case 'square': return `M${x - r * 0.85},${y - r * 0.85}H${x + r * 0.85}V${y + r * 0.85}H${x - r * 0.85}Z`
    default: return ''
  }
}

export function RangeStrip({ marks, fmt, zone, zoneLabel = 'хвост', ariaLabel, className }: RangeStripProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(320)
  const rid = useId()
  const hatchId = svgId(rid, 'rhatch')
  const vals = marks.map((m) => m.value).concat(zone ?? [])
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = Math.max(1e-9, hi - lo)
  const x = (v: number) => PAD + ((v - lo) / span) * (width - PAD * 2)
  const label = ariaLabel ?? marks.map((m) => `${m.label} ${fmt(m.value)}`).join(', ')
  return (
    <div ref={ref} className={`ch-range${className ? ` ${className}` : ''}`}>
      <svg className="ch-svg" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label}>
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect className="ch-range__hatch" x="0" y="0" width="2" height="5" />
          </pattern>
        </defs>
        <line className="ch-range__track" x1={PAD} x2={width - PAD} y1={TRACK_Y} y2={TRACK_Y} />
        {zone && zone[1] > zone[0] && (
          <g className="ch-range__zone">
            <rect x={x(zone[0])} y={TRACK_Y - 7} width={Math.max(2, x(zone[1]) - x(zone[0]))} height={14} rx={2} fill={`url(#${hatchId})`} />
            <title>{zoneLabel}</title>
          </g>
        )}
        {marks.map((m) => {
          const mx = x(m.value)
          const cls = `ch-range__mark ch-range__mark--${m.tone ?? 'idle'}`
          const anchor = mx < PAD + 24 ? 'start' : mx > width - PAD - 24 ? 'end' : 'middle'
          return (
            <g key={m.key} className={cls}>
              <title>{`${m.label}: ${fmt(m.value)}`}</title>
              {m.glyph === 'dot' && <circle className="ch-range__dot" cx={mx} cy={TRACK_Y} r={6} />}
              {m.glyph === 'ring' && <circle className="ch-range__ring" cx={mx} cy={TRACK_Y} r={4.5} />}
              {(m.glyph === 'triangle' || m.glyph === 'square') && <path className="ch-range__shape" d={glyphPath(m.glyph, mx, TRACK_Y, 5.5)} />}
              {m.showValue && (
                <text className="ch-range__value" x={mx} y={TRACK_Y + 22} textAnchor={anchor}>{fmt(m.value)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
