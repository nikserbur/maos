import type { OptHistBin, OptMetrics } from '../../lib/api'

interface Props {
  histogram: OptHistBin[]
  metrics: OptMetrics
}

/** Краткий формат денег: 25.3 млн / 412 тыс. */
function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1) + ' млрд'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + ' млн'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + ' тыс'
  return v.toFixed(0)
}

/**
 * Гистограмма распределения прибыли робастного портфеля с маркерами риска
 * (худший случай, CVaR, VaR, матожидание, ноль). Чистый SVG — без зависимостей.
 */
export function ProfitDistribution({ histogram, metrics }: Props) {
  const W = 560, H = 220, padL = 8, padR = 8, padT = 14, padB = 30
  if (!histogram.length) return null

  const lo = histogram[0].x0
  const hi = histogram[histogram.length - 1].x1
  const span = Math.max(1, hi - lo)
  const maxCount = Math.max(1, ...histogram.map((b) => b.count))
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const x = (v: number) => padL + ((v - lo) / span) * plotW
  const barW = plotW / histogram.length

  const markers: Array<{ v: number; label: string; color: string }> = [
    { v: metrics.worst_case, label: 'худший', color: 'var(--intent-danger)' },
    { v: metrics.cvar, label: 'CVaR', color: 'var(--intent-warning)' },
    { v: metrics.var, label: 'VaR', color: 'var(--focus)' },
    { v: metrics.expected, label: 'E[прибыль]', color: 'var(--intent-success)' },
  ]
  const showZero = lo < 0 && hi > 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label="Распределение прибыли робастного портфеля">
      {/* Столбцы */}
      {histogram.map((b, i) => {
        const h = (b.count / maxCount) * plotH
        const negative = b.x1 <= 0
        return (
          <rect key={i}
            x={padL + i * barW + 0.5} y={padT + (plotH - h)}
            width={Math.max(0.5, barW - 1)} height={h}
            fill={negative ? 'var(--intent-danger)' : 'var(--accent)'}
            opacity={negative ? 0.55 : 0.85} rx="1" />
        )
      })}

      {/* Базовая линия */}
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH}
            stroke="var(--border-strong)" strokeWidth="1" />

      {/* Ноль (граница убытка) */}
      {showZero && (
        <line x1={x(0)} y1={padT} x2={x(0)} y2={padT + plotH}
              stroke="var(--text-disabled)" strokeWidth="1" strokeDasharray="2 2" />
      )}

      {/* Маркеры риска */}
      {markers.map((m, i) => {
        const mx = x(m.v)
        if (mx < padL || mx > W - padR) return null
        return (
          <g key={i}>
            <line x1={mx} y1={padT} x2={mx} y2={padT + plotH}
                  stroke={m.color} strokeWidth="1.5" />
            <text x={mx} y={padT - 3} fontSize="9" fill={m.color}
                  textAnchor={i % 2 === 0 ? 'start' : 'end'}
                  style={{ fontFamily: 'var(--font-mono)' }}>{m.label}</text>
          </g>
        )
      })}

      {/* Подписи оси X */}
      <text x={padL} y={H - 8} fontSize="10" fill="var(--text-muted)"
            style={{ fontFamily: 'var(--font-mono)' }}>{money(lo)} ₽</text>
      <text x={W - padR} y={H - 8} fontSize="10" fill="var(--text-muted)" textAnchor="end"
            style={{ fontFamily: 'var(--font-mono)' }}>{money(hi)} ₽</text>
    </svg>
  )
}
