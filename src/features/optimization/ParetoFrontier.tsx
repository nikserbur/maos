import { useState } from 'react'
import type { OptCandidate } from '../../lib/api'

function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1) + ' млрд'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + ' млн'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + ' тыс'
  return v.toFixed(0)
}

interface Hover { left: number; top: number; c: OptCandidate }

/**
 * Граница Парето портфелей: X — риск (σ прибыли, меньше → лучше), Y — ожидаемая прибыль.
 * Недоминируемые образуют «границу» (нельзя поднять доходность, не увеличив риск).
 * Интерактивно: наведение на точку показывает метрики портфеля.
 */
export function ParetoFrontier({ candidates }: { candidates: OptCandidate[] }) {
  const W = 600, H = 250, padL = 54, padR = 16, padT = 18, padB = 36
  const [hover, setHover] = useState<Hover | null>(null)
  if (candidates.length < 2) return null

  const xs = candidates.map((c) => c.std)
  const ys = candidates.map((c) => c.expected)
  const xlo = Math.min(...xs), xhi = Math.max(...xs)
  const ylo = Math.min(...ys), yhi = Math.max(...ys)
  const xspan = Math.max(1, xhi - xlo), yspan = Math.max(1, yhi - ylo)
  const plotW = W - padL - padR, plotH = H - padT - padB
  const px = (v: number) => padL + ((v - xlo) / xspan) * plotW
  const py = (v: number) => padT + (1 - (v - ylo) / yspan) * plotH

  const pareto = candidates.filter((c) => c.is_pareto).sort((a, b) => a.std - b.std)
  const line = pareto.map((c) => `${px(c.std)},${py(c.expected)}`).join(' ')
  const area = pareto.length > 1
    ? `${px(pareto[0].std)},${padT + plotH} ${line} ${px(pareto[pareto.length - 1].std)},${padT + plotH}` : ''
  const robust = candidates.find((c) => c.is_robust)
  const expected = candidates.find((c) => c.is_expected)

  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Граница Парето: доходность против риска">
        <defs>
          <linearGradient id="pareto-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={padL} y1={padT + plotH * f} x2={W - padR} y2={padT + plotH * f}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" opacity="0.4" />
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth="1" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth="1" />

        {area && <polygon points={area} fill="url(#pareto-fill)" />}
        {pareto.length > 1 && <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2"
                                        strokeLinejoin="round" opacity="0.85" />}

        {candidates.map((c, i) => {
          const isH = hover?.c === c
          return (
            <circle key={i} cx={px(c.std)} cy={py(c.expected)} r={isH ? 5.5 : c.is_pareto ? 3.6 : 2.4}
              fill={c.is_pareto ? 'var(--accent)' : 'var(--text-disabled)'}
              opacity={c.is_pareto ? 0.95 : 0.5} style={{ cursor: 'pointer', transition: 'r .1s' }}
              onMouseEnter={() => setHover({ left: px(c.std) / W * 100, top: py(c.expected) / H * 100, c })} />
          )
        })}

        {robust && (
          <g>
            <circle cx={px(robust.std)} cy={py(robust.expected)} r="7" fill="none" stroke="var(--intent-success)" strokeWidth="2.2" />
            <text x={px(robust.std) + 10} y={py(robust.expected) - 7} fontSize="9.5" fill="var(--intent-success)"
                  style={{ fontFamily: 'var(--font-mono)' }}>устойчивый</text>
          </g>
        )}
        {expected && !expected.is_robust && (
          <g>
            <circle cx={px(expected.std)} cy={py(expected.expected)} r="7" fill="none" stroke="var(--intent-warning)" strokeWidth="2.2" />
            <text x={px(expected.std) + 10} y={py(expected.expected) + 14} fontSize="9.5" fill="var(--intent-warning)"
                  style={{ fontFamily: 'var(--font-mono)' }}>макс E (хрупкий)</text>
          </g>
        )}

        <text x={padL} y={H - 10} fontSize="9.5" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>риск σ {money(xlo)} →</text>
        <text x={W - padR} y={H - 10} fontSize="9.5" fill="var(--text-muted)" textAnchor="end" style={{ fontFamily: 'var(--font-mono)' }}>{money(xhi)}</text>
        <text x={6} y={padT + 6} fontSize="9.5" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>E {money(yhi)}</text>
        <text x={6} y={padT + plotH} fontSize="9.5" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>{money(ylo)}</text>
      </svg>

      {hover && (
        <div style={{
          position: 'absolute', left: `min(${hover.left}%, calc(100% - 160px))`, top: `${hover.top}%`,
          transform: 'translate(10px, -50%)', pointerEvents: 'none', zIndex: 5,
          background: 'var(--surface, #161a20)', border: '1px solid var(--accent)', borderRadius: 8,
          padding: '7px 10px', fontSize: 11.5, boxShadow: '0 6px 22px rgba(0,0,0,.45)', minWidth: 140,
        }}>
          <b style={{ color: hover.c.is_robust ? 'var(--intent-success)' : hover.c.is_pareto ? 'var(--accent)' : 'var(--text-muted)' }}>
            {hover.c.is_robust ? 'устойчивый' : hover.c.is_expected ? 'макс E' : hover.c.is_pareto ? 'на границе Парето' : 'доминируемый'}
          </b>
          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
            E[прибыль] {money(hover.c.expected)}<br />
            σ (риск) {money(hover.c.std)}<br />
            CVaR {money(hover.c.cvar)} · худший {money(hover.c.worst_case)}<br />
            P(убыток) {(hover.c.p_loss * 100).toFixed(1)}%{hover.c.concentration != null ? ` · конц. ${Math.round(hover.c.concentration * 100)}%` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
