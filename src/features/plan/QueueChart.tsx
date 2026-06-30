import type { ScheduleResult } from '../../lib/api'

const h0 = (v: number) => Math.round(v).toLocaleString('ru')

/**
 * График очередей: сколько операций «ждут» свободного станка в каждый момент времени.
 * Пик отмечает узкое место (где и когда копится очередь). Чистый SVG.
 */
export function QueueChart({ data }: { data: NonNullable<ScheduleResult['queue_timeline']> }) {
  const W = 600, H = 156, padL = 34, padR = 12, padT = 16, padB = 26
  if (!data || data.length < 2) return null
  const maxQ = Math.max(1, ...data.map((d) => d.queued))
  const tMax = Math.max(1, ...data.map((d) => d.t))
  const plotW = W - padL - padR, plotH = H - padT - padB
  const x = (t: number) => padL + (t / tMax) * plotW
  const y = (q: number) => padT + (1 - q / maxQ) * plotH
  const line = data.map((d) => `${x(d.t)},${y(d.queued)}`).join(' ')
  const area = `${x(0)},${padT + plotH} ${line} ${x(tMax)},${padT + plotH}`
  const peak = data.reduce((a, b) => (b.queued > a.queued ? b : a), data[0])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Очереди операций во времени">
      {/* сетка по Y */}
      {[0.5, 1].map((f) => (
        <line key={f} x1={padL} y1={y(maxQ * f)} x2={W - padR} y2={y(maxQ * f)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
      ))}
      <polygon points={area} fill="var(--intent-warning)" opacity="0.16" />
      <polyline points={line} fill="none" stroke="var(--intent-warning)" strokeWidth="1.6" />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth="1" />

      {/* пик очереди = узкое место */}
      <circle cx={x(peak.t)} cy={y(peak.queued)} r="3.5" fill="var(--intent-danger)" />
      <text x={Math.min(x(peak.t), W - padR - 90)} y={Math.max(padT + 8, y(peak.queued) - 6)} fontSize="9.5"
            fill="var(--intent-danger)" style={{ fontFamily: 'var(--font-mono)' }}>
        пик {peak.queued} · {peak.top_wc}
      </text>

      {/* подписи осей */}
      <text x={4} y={padT + 4} fontSize="9" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>{maxQ}</text>
      <text x={4} y={padT + plotH} fontSize="9" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>0</text>
      <text x={padL} y={H - 8} fontSize="9" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>0 ч</text>
      <text x={W - padR} y={H - 8} fontSize="9" fill="var(--text-muted)" textAnchor="end" style={{ fontFamily: 'var(--font-mono)' }}>{h0(tMax)} ч</text>
      <text x={(padL + W) / 2} y={H - 8} fontSize="9" fill="var(--text-muted)" textAnchor="middle">в очереди (операций) ↑ · время →</text>
    </svg>
  )
}
