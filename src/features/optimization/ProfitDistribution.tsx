import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { OptHistBin, OptMetrics } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { axisMoney, clamp, linear, niceTicks, svgId } from './kit/scale'

interface Props {
  histogram: OptHistBin[]
  /** Метрики робастного портфеля (E, VaR, CVaR, худший). */
  metrics: OptMetrics
  alpha: number
  samples: number
}

const W = 760
const H = 286
const PAD_L = 46
const PAD_R = 18
const TOP = 34
const BASE = 196
const TICK_Y = 214
const LANE_Y = 238
const BRACKET_Y = 258
const MARK_R = 6

/** Путь столбца со скруглённым верхом. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(2.5, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/**
 * D2 «CVaR = среднее худших α» на живых данных (A6 §6): гистограмма прибыли робастного
 * портфеля, закрашенный хвост худших α левее VaR (киноварь), линия VaR, маркеры
 * E (ультрамарин ●) и CVaR (киноварь ●), скобка E − CVaR, контур портфеля «макс E»,
 * подписанные деления осей и перекрестие с подсказкой. Только токены темы.
 */
export function ProfitDistribution({ histogram, metrics, alpha, samples }: Props) {
  const rid = useId()
  const [hover, setHover] = useState<number | null>(null)

  const g = useMemo(() => {
    if (histogram.length === 0) return null
    const lo = Math.min(histogram[0].x0, metrics.worst_case)
    const hi = histogram[histogram.length - 1].x1
    const x = linear(lo, hi, PAD_L, W - PAD_R)
    const total = histogram.reduce((s, b) => s + b.count, 0) || 1
    const totalExp = histogram.reduce((s, b) => s + (b.count_expected ?? 0), 0) || 1
    const hasExp = histogram.some((b) => (b.count_expected ?? 0) > 0)
    let maxShare = 0
    for (const b of histogram) {
      maxShare = Math.max(maxShare, b.count / total, hasExp ? (b.count_expected ?? 0) / totalExp : 0)
    }
    maxShare = maxShare || 1
    const yTicks = niceTicks(0, maxShare, 3).filter((t) => t > 0)
    const yMax = Math.max(maxShare, yTicks[yTicks.length - 1] ?? 0) * 1.04
    const y = linear(0, yMax, BASE, TOP)
    const bars = histogram.map((b) => {
      const x0 = x(b.x0) + 0.75
      const x1 = x(b.x1) - 0.75
      const top = y(b.count / total)
      return { x0, x1, cx: (x0 + x1) / 2, d: barPath(x0, top, x1 - x0, BASE - top) }
    })
    const outline = hasExp
      ? histogram
          .map((b, i) => `${i === 0 ? `M${x(b.x0)},${BASE}` : ''}V${y((b.count_expected ?? 0) / totalExp)}H${x(b.x1)}`)
          .join('') + `V${BASE}`
      : ''
    return { lo, hi, x, y, total, totalExp, hasExp, yTicks, bars, outline, xTicks: niceTicks(lo, hi, 6) }
  }, [histogram, metrics.worst_case])

  if (!g) return null

  const ids = { bar: svgId(rid, 'bar'), tail: svgId(rid, 'tail'), clip: svgId(rid, 'clip') }
  const xVar = clamp(g.x(metrics.var), PAD_L, W - PAD_R)
  const xCvar = clamp(g.x(metrics.cvar), PAD_L, W - PAD_R)
  const xE = clamp(g.x(metrics.expected), PAD_L, W - PAD_R)
  const xWorst = clamp(g.x(metrics.worst_case), PAD_L, W - PAD_R)
  const xZero = g.lo < 0 && g.hi > 0 ? g.x(0) : null
  const tailLabelRight = xVar - PAD_L < 120
  const gap = metrics.expected - metrics.cvar
  const hb = hover != null ? histogram[hover] : null
  const hBar = hover != null ? g.bars[hover] : null

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const r = svg.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / Math.max(1, r.width)) * W
    const i = g.bars.findIndex((b) => sx >= b.x0 - 0.75 && sx <= b.x1 + 0.75)
    setHover(i >= 0 ? i : null)
  }

  const summary =
    `Распределение прибыли робастного портфеля по ${num(samples, 0)} сценариям. ` +
    `Ожидаемая прибыль ${money(metrics.expected)}, VaR ${money(metrics.var)}, CVaR худших ${pct(alpha, 0)} — ${money(metrics.cvar)}, ` +
    `худший сценарий ${money(metrics.worst_case)}.`

  return (
    <div className="dk-plot pd" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary}>
        <defs>
          <linearGradient id={ids.bar} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="pd-stop-u" stopOpacity="0.95" />
            <stop offset="100%" className="pd-stop-u" stopOpacity="0.38" />
          </linearGradient>
          <linearGradient id={ids.tail} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="pd-stop-r" stopOpacity="0.98" />
            <stop offset="100%" className="pd-stop-r" stopOpacity="0.45" />
          </linearGradient>
          <clipPath id={ids.clip}>
            <rect x={PAD_L} y={TOP - 12} width={Math.max(0, xVar - PAD_L)} height={BASE - TOP + 12} />
          </clipPath>
        </defs>

        {/* сетка и ось долей */}
        {g.yTicks.map((t) => (
          <g key={t}>
            <line className="dk-grid" x1={PAD_L} x2={W - PAD_R} y1={g.y(t)} y2={g.y(t)} />
            <text className="dk-axis" x={PAD_L - 8} y={g.y(t) + 3.5} textAnchor="end">{pct(t, 0)}</text>
          </g>
        ))}
        <text className="dk-axis dk-axis--title" x={PAD_L - 8} y={TOP - 18} textAnchor="end">доля</text>
        <text className="dk-axis dk-axis--title" x={W - PAD_R} y={TOP - 18} textAnchor="end">
          {`прибыль за горизонт, ₽ · N = ${num(samples, 0)}`}
        </text>

        {/* хвост худших α: плоскость левее VaR */}
        <rect className="pd-tail" x={PAD_L} y={TOP - 12} width={Math.max(0, xVar - PAD_L)} height={BASE - TOP + 12} />
        <text
          className="pd-tail-label"
          x={tailLabelRight ? xVar + 8 : PAD_L + 8}
          y={TOP + 4}
          textAnchor="start"
        >
          {`худшие α = ${pct(alpha, 0)}`}
        </text>

        {/* столбцы: тело — ультрамарин, часть в хвосте — киноварь */}
        <g>
          {g.bars.map((b, i) => (
            <path key={i} d={b.d} fill={`url(#${ids.bar})`} className={hover === i ? 'pd-bar is-hot' : 'pd-bar'} />
          ))}
        </g>
        <g clipPath={`url(#${ids.clip})`}>
          {g.bars.map((b, i) => (
            <path key={i} d={b.d} fill={`url(#${ids.tail})`} className="pd-bar" />
          ))}
        </g>

        {g.hasExp && <path className="pd-outline" d={g.outline} />}

        <line className="dk-baseline" x1={PAD_L} x2={W - PAD_R} y1={BASE} y2={BASE} />
        {xZero != null && <line className="pd-zero" x1={xZero} x2={xZero} y1={TOP - 12} y2={BASE} />}

        {/* VaR — чернильная линия-порог */}
        <line className="pd-var" x1={xVar} x2={xVar} y1={TOP - 14} y2={BASE + 4} />
        <text className="pd-lbl pd-lbl--strong" x={xVar + (xVar > W - 170 ? -6 : 6)} y={TOP - 18} textAnchor={xVar > W - 170 ? 'end' : 'start'}>
          {`VaR = ${axisMoney(metrics.var)}`}
        </text>

        {/* деления оси прибыли */}
        {g.xTicks.map((t) => (
          <g key={t}>
            <line className="dk-baseline" x1={g.x(t)} x2={g.x(t)} y1={BASE} y2={BASE + 4} />
            <text className="dk-axis" x={g.x(t)} y={TICK_Y} textAnchor="middle">{axisMoney(t)}</text>
          </g>
        ))}

        {/* дорожка маркеров: худший ■, CVaR ●, E ● и скобка E − CVaR */}
        <line className="pd-drop pd-drop--e" x1={xE} x2={xE} y1={TOP - 4} y2={LANE_Y - MARK_R} />
        <line className="pd-drop pd-drop--r" x1={xCvar} x2={xCvar} y1={BASE} y2={LANE_Y - MARK_R} />
        <rect className="pd-worst" x={xWorst - 4} y={LANE_Y - 4} width={8} height={8} />
        <circle className="pd-mark pd-mark--r" cx={xCvar} cy={LANE_Y} r={MARK_R} />
        <circle className="pd-mark pd-mark--u" cx={xE} cy={LANE_Y} r={MARK_R} />
        <text className="pd-lbl" x={xCvar - MARK_R - 6} y={LANE_Y + 4} textAnchor="end">CVaR</text>
        <text className="pd-lbl" x={xE + MARK_R + 6} y={LANE_Y + 4}>E</text>
        {xE - xCvar > 24 && (
          <g>
            <path className="pd-bracket" d={`M${xCvar},${BRACKET_Y - 5}V${BRACKET_Y}H${xE}V${BRACKET_Y - 5}`} />
            <text className="pd-lbl pd-lbl--mono" x={(xCvar + xE) / 2} y={BRACKET_Y + 16} textAnchor="middle">
              {`E − CVaR = ${axisMoney(gap)}`}
            </text>
          </g>
        )}

        {hBar && <line className="dk-cross" x1={hBar.cx} x2={hBar.cx} y1={TOP - 12} y2={BASE} />}
        <rect className="dk-plot__hit" x={PAD_L} y={TOP - 12} width={W - PAD_L - PAD_R} height={BASE - TOP + 12}
              onPointerMove={onMove} />
      </svg>

      {hb && hBar && (
        <div
          className="dk-tip"
          style={{
            left: `${(hBar.cx / W) * 100}%`,
            top: `${(TOP / H) * 100}%`,
            transform: hBar.cx > W * 0.62 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
          }}
        >
          <div className="dk-tip__title">
            <span className={(hb.x0 + hb.x1) / 2 <= metrics.var ? 'glyph-down' : 'glyph-info'} aria-hidden="true" />
            {axisMoney(hb.x0)} … {axisMoney(hb.x1)} ₽
          </div>
          <div className="dk-tip__row">устойчивый <b>{num(hb.count, 0)} · {pct(hb.count / g.total)}</b></div>
          {g.hasExp && (
            <div className="dk-tip__row">макс. E <b>{num(hb.count_expected ?? 0, 0)} · {pct((hb.count_expected ?? 0) / g.totalExp)}</b></div>
          )}
          {(hb.x0 + hb.x1) / 2 <= metrics.var && <div className="dk-tip__row">в хвосте худших α</div>}
        </div>
      )}
    </div>
  )
}

/** Легенда распределения — HTML-чипы под графиком. */
export function ProfitLegend({ hasExpected }: { hasExpected: boolean }) {
  return (
    <div className="dk-legend pd-legend">
      <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--area pd-sw-tail" />хвост худших α</span>
      <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--line pd-sw-ink" />VaR — порог хвоста</span>
      <span className="dk-legend__item"><i className="dk-legend__sw pd-sw-r" />CVaR — среднее хвоста</span>
      <span className="dk-legend__item"><i className="dk-legend__sw pd-sw-u" />E — среднее всех</span>
      <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--sq pd-sw-worst" />худший сценарий</span>
      {hasExpected && (
        <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--dash pd-sw-o" />портфель «макс. E»</span>
      )}
    </div>
  )
}
