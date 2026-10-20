import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { OptCandidate } from '../../lib/api'
import { money, pct } from '../../explain/format'
import { axisMoney, linear, nearestIndex, niceTicks, svgId } from './kit/scale'

const W = 720
const H = 300
const PAD_L = 64
const PAD_R = 20
const PAD_T = 22
const PAD_B = 46
const HIT_R2 = 28 * 28

interface Pt { x: number; y: number; c: OptCandidate }

/**
 * Граница Парето «доходность — риск»: X — σ прибыли (меньше — лучше), Y — E[Π].
 * Недоминируемые — линия с градиентной областью; доминируемые — бледные точки;
 * выбранный робастный портфель — охра ▲, портфель «макс. E» — киноварь ■.
 * Наведение — перекрестие к ближайшей точке и подсказка.
 */
export function ParetoFrontier({ candidates }: { candidates: OptCandidate[] }) {
  const rid = useId()
  const [hover, setHover] = useState<number | null>(null)

  const g = useMemo(() => {
    if (candidates.length < 2) return null
    let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity
    for (const c of candidates) {
      xlo = Math.min(xlo, c.std); xhi = Math.max(xhi, c.std)
      ylo = Math.min(ylo, c.expected); yhi = Math.max(yhi, c.expected)
    }
    const xPad = (xhi - xlo) * 0.06 || Math.abs(xhi) * 0.05 || 1
    const yPad = (yhi - ylo) * 0.08 || Math.abs(yhi) * 0.05 || 1
    const x = linear(xlo - xPad, xhi + xPad, PAD_L, W - PAD_R)
    const y = linear(ylo - yPad, yhi + yPad, H - PAD_B, PAD_T)
    const pts: Pt[] = candidates.map((c) => ({ x: x(c.std), y: y(c.expected), c }))
    const front = pts.filter((p) => p.c.is_pareto).sort((a, b) => a.x - b.x)
    const line = front.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('')
    const area = front.length > 1
      ? `${line}L${front[front.length - 1].x},${H - PAD_B}L${front[0].x},${H - PAD_B}Z`
      : ''
    return {
      x, y, pts, front, line, area,
      xTicks: niceTicks(xlo - xPad, xhi + xPad, 5),
      yTicks: niceTicks(ylo - yPad, yhi + yPad, 4),
      robust: pts.find((p) => p.c.is_robust),
      maxE: pts.find((p) => p.c.is_expected && !p.c.is_robust),
    }
  }, [candidates])

  if (!g) return null
  const fillId = svgId(rid, 'front')
  const hp = hover != null ? g.pts[hover] : null

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const r = svg.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / Math.max(1, r.width)) * W
    const sy = ((e.clientY - r.top) / Math.max(1, r.height)) * H
    const i = nearestIndex(g.pts, sx, sy)
    const p = i >= 0 ? g.pts[i] : null
    setHover(p && (p.x - sx) ** 2 + (p.y - sy) ** 2 <= HIT_R2 ? i : null)
  }

  const kind = (c: OptCandidate) =>
    c.is_robust ? 'выбранный устойчивый' : c.is_expected ? 'максимум ожидания' : c.is_pareto ? 'на границе Парето' : 'доминируемый'
  const nPareto = g.front.length

  return (
    <div className="dk-plot pf" onPointerLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Граница Парето: ${nPareto} недоминируемых портфелей из ${candidates.length}; ось X — риск σ, ось Y — ожидаемая прибыль.`}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="pd-stop-u" stopOpacity="0.28" />
            <stop offset="100%" className="pd-stop-u" stopOpacity="0" />
          </linearGradient>
        </defs>

        {g.yTicks.map((t) => (
          <g key={`y${t}`}>
            <line className="dk-grid" x1={PAD_L} x2={W - PAD_R} y1={g.y(t)} y2={g.y(t)} />
            <text className="dk-axis" x={PAD_L - 10} y={g.y(t) + 3.5} textAnchor="end">{axisMoney(t)}</text>
          </g>
        ))}
        {g.xTicks.map((t) => (
          <g key={`x${t}`}>
            <line className="dk-grid" x1={g.x(t)} x2={g.x(t)} y1={PAD_T} y2={H - PAD_B} />
            <text className="dk-axis" x={g.x(t)} y={H - PAD_B + 18} textAnchor="middle">{axisMoney(t)}</text>
          </g>
        ))}
        <line className="dk-baseline" x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} />
        <text className="dk-axis dk-axis--title" x={W - PAD_R} y={H - 8} textAnchor="end">риск σ прибыли, ₽ →</text>
        <text className="dk-axis dk-axis--title" x={PAD_L - 10} y={PAD_T - 8} textAnchor="end">E[Π], ₽ ↑</text>

        {g.area && <path d={g.area} fill={`url(#${fillId})`} />}
        {g.front.length > 1 && <path className="pf-line" d={g.line} />}

        {g.pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={p.c.is_pareto ? 3.6 : 2.6}
            className={`${p.c.is_pareto ? 'pf-dot pf-dot--front' : 'pf-dot'}${hover === i ? ' is-hot' : ''}`}
          />
        ))}

        {g.maxE && (
          <g>
            <rect className="pf-maxe" x={g.maxE.x - 6} y={g.maxE.y - 6} width={12} height={12} />
            <text className="pd-lbl" x={g.maxE.x + 12} y={g.maxE.y + 16}>макс. E</text>
          </g>
        )}
        {g.robust && (
          <g>
            <path className="pf-pick" d={`M${g.robust.x},${g.robust.y - 10}L${g.robust.x + 9},${g.robust.y + 6}H${g.robust.x - 9}Z`} />
            <text className="pd-lbl pd-lbl--strong" x={g.robust.x + 12} y={g.robust.y - 8}>выбрано</text>
          </g>
        )}

        {hp && (
          <g>
            <line className="dk-cross" x1={hp.x} x2={hp.x} y1={hp.y} y2={H - PAD_B} />
            <line className="dk-cross" x1={PAD_L} x2={hp.x} y1={hp.y} y2={hp.y} />
            <circle className="pf-halo" cx={hp.x} cy={hp.y} r={7} />
          </g>
        )}
        <rect className="dk-plot__hit" x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={H - PAD_T - PAD_B}
              onPointerMove={onMove} />
      </svg>

      {hp && (
        <div
          className="dk-tip"
          style={{
            left: `${(hp.x / W) * 100}%`,
            top: `${(hp.y / H) * 100}%`,
            transform: `translate(${hp.x > W * 0.6 ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
          }}
        >
          <div className="dk-tip__title">
            <span className={hp.c.is_robust ? 'glyph-setup' : hp.c.is_pareto ? 'glyph-info' : 'glyph-idle'} aria-hidden="true" />
            {kind(hp.c)}
          </div>
          <div className="dk-tip__row">E[Π] <b>{money(hp.c.expected)}</b></div>
          <div className="dk-tip__row">σ <b>{money(hp.c.std)}</b></div>
          <div className="dk-tip__row">CVaR <b>{money(hp.c.cvar)}</b></div>
          <div className="dk-tip__row">худший <b>{money(hp.c.worst_case)}</b></div>
          <div className="dk-tip__row">P(убыток) <b>{pct(hp.c.p_loss)}</b></div>
          {hp.c.concentration != null && <div className="dk-tip__row">макс. доля <b>{pct(hp.c.concentration, 0)}</b></div>}
        </div>
      )}
    </div>
  )
}

export function ParetoLegend() {
  return (
    <div className="dk-legend">
      <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--line pd-sw-u" />граница Парето</span>
      <span className="dk-legend__item"><i className="dk-legend__sw pf-sw-dom" />доминируемые</span>
      <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--tri" />выбранный устойчивый</span>
      <span className="dk-legend__item"><i className="dk-legend__sw dk-legend__sw--sq pf-sw-maxe" />максимум ожидания</span>
    </div>
  )
}
