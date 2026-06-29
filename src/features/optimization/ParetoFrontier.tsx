import type { OptCandidate } from '../../lib/api'

/** Краткий формат денег: 25.3 млн / 412 тыс. */
function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1) + ' млрд'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + ' млн'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + ' тыс'
  return v.toFixed(0)
}

/**
 * Граница Парето портфелей: ось X — риск (σ прибыли, меньше → лучше), ось Y —
 * ожидаемая прибыль (больше → лучше). Недоминируемые портфели образуют «границу»
 * (линия) — нельзя поднять доходность, не увеличив риск. Устойчивый и наивно-лучший
 * портфели отмечены. Чистый SVG, без зависимостей.
 */
export function ParetoFrontier({ candidates }: { candidates: OptCandidate[] }) {
  const W = 560, H = 240, padL = 52, padR = 14, padT = 16, padB = 34
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
  const frontier = pareto.map((c) => `${px(c.std)},${py(c.expected)}`).join(' ')
  const robust = candidates.find((c) => c.is_robust)
  const expected = candidates.find((c) => c.is_expected)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Граница Парето: доходность против риска">
      {/* Оси */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth="1" />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth="1" />

      {/* Граница Парето (линия по недоминируемым) */}
      {pareto.length > 1 && (
        <polyline points={frontier} fill="none" stroke="var(--accent)" strokeWidth="1.5"
                  strokeDasharray="4 3" opacity="0.7" />
      )}

      {/* Облако портфелей */}
      {candidates.map((c, i) => (
        <circle key={i} cx={px(c.std)} cy={py(c.expected)} r={c.is_pareto ? 3.6 : 2.3}
          fill={c.is_pareto ? 'var(--accent)' : 'var(--text-disabled)'}
          opacity={c.is_pareto ? 0.95 : 0.5} />
      ))}

      {/* Устойчивый портфель */}
      {robust && (
        <g>
          <circle cx={px(robust.std)} cy={py(robust.expected)} r="6.5" fill="none"
                  stroke="var(--intent-success)" strokeWidth="2" />
          <text x={px(robust.std) + 9} y={py(robust.expected) - 6} fontSize="9"
                fill="var(--intent-success)" style={{ fontFamily: 'var(--font-mono)' }}>устойчивый</text>
        </g>
      )}
      {/* Наивно-лучший по матожиданию */}
      {expected && !expected.is_robust && (
        <g>
          <circle cx={px(expected.std)} cy={py(expected.expected)} r="6.5" fill="none"
                  stroke="var(--intent-warning)" strokeWidth="2" />
          <text x={px(expected.std) + 9} y={py(expected.expected) + 13} fontSize="9"
                fill="var(--intent-warning)" style={{ fontFamily: 'var(--font-mono)' }}>макс E (хрупкий)</text>
        </g>
      )}

      {/* Подписи осей */}
      <text x={padL} y={H - 8} fontSize="10" fill="var(--text-muted)"
            style={{ fontFamily: 'var(--font-mono)' }}>риск σ {money(xlo)} →</text>
      <text x={W - padR} y={H - 8} fontSize="10" fill="var(--text-muted)" textAnchor="end"
            style={{ fontFamily: 'var(--font-mono)' }}>{money(xhi)}</text>
      <text x={4} y={padT + 8} fontSize="10" fill="var(--text-muted)"
            style={{ fontFamily: 'var(--font-mono)' }}>E {money(yhi)}</text>
      <text x={4} y={padT + plotH} fontSize="10" fill="var(--text-muted)"
            style={{ fontFamily: 'var(--font-mono)' }}>{money(ylo)}</text>
    </svg>
  )
}
