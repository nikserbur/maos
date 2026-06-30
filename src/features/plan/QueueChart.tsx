import { useState } from 'react'
import type { ScheduleResult } from '../../lib/api'

const h0 = (v: number) => Math.round(v).toLocaleString('ru')
type QPoint = NonNullable<ScheduleResult['queue_timeline']>[number]

/**
 * График очередей: сколько операций «ждут» свободного станка во времени. Пик — узкое
 * место. Интерактивно: наведение показывает время, длину очереди и где она копится.
 */
export function QueueChart({ data }: { data: NonNullable<ScheduleResult['queue_timeline']> }) {
  const W = 620, H = 168, padL = 36, padR = 14, padT = 16, padB = 28
  const [hi, setHi] = useState<number | null>(null)
  if (!data || data.length < 2) return null

  const maxQ = Math.max(1, ...data.map((d) => d.queued))
  const tMax = Math.max(1, ...data.map((d) => d.t))
  const plotW = W - padL - padR, plotH = H - padT - padB
  const x = (t: number) => padL + (t / tMax) * plotW
  const y = (q: number) => padT + (1 - q / maxQ) * plotH
  const line = data.map((d) => `${x(d.t)},${y(d.queued)}`).join(' ')
  const area = `${x(0)},${padT + plotH} ${line} ${x(tMax)},${padT + plotH}`
  const peakIdx = data.reduce((a, _b, i) => (data[i].queued > data[a].queued ? i : a), 0)
  const peak: QPoint = data[peakIdx]
  const hov = hi != null ? data[hi] : null

  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Очереди операций во времени"
           onMouseMove={(e) => {
             const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
             const vx = ((e.clientX - r.left) / r.width) * W
             const t = ((vx - padL) / plotW) * tMax
             let best = 0; for (let i = 1; i < data.length; i++) if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i
             setHi(best)
           }}>
        <defs>
          <linearGradient id="queue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--intent-warning)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--intent-warning)" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <line key={f} x1={padL} y1={y(maxQ * f)} x2={W - padR} y2={y(maxQ * f)}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
        ))}
        <polygon points={area} fill="url(#queue-fill)" />
        <polyline points={line} fill="none" stroke="var(--intent-warning)" strokeWidth="1.8" strokeLinejoin="round" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth="1" />

        {/* пик = узкое место */}
        <circle cx={x(peak.t)} cy={y(peak.queued)} r="3.8" fill="var(--intent-danger)" />
        <text x={Math.min(x(peak.t), W - padR - 92)} y={Math.max(padT + 8, y(peak.queued) - 6)} fontSize="9.5"
              fill="var(--intent-danger)" style={{ fontFamily: 'var(--font-mono)' }}>пик {peak.queued} · {peak.top_wc}</text>

        {/* курсор */}
        {hov && (
          <g>
            <line x1={x(hov.t)} y1={padT} x2={x(hov.t)} y2={padT + plotH} stroke="var(--accent)" strokeWidth="1" opacity="0.6" />
            <circle cx={x(hov.t)} cy={y(hov.queued)} r="3.5" fill="var(--accent)" />
          </g>
        )}

        <text x={4} y={padT + 4} fontSize="9" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>{maxQ}</text>
        <text x={4} y={padT + plotH} fontSize="9" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>0</text>
        <text x={padL} y={H - 8} fontSize="9" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>0 ч</text>
        <text x={W - padR} y={H - 8} fontSize="9" fill="var(--text-muted)" textAnchor="end" style={{ fontFamily: 'var(--font-mono)' }}>{h0(tMax)} ч</text>
        <text x={(padL + W) / 2} y={H - 8} fontSize="9" fill="var(--text-muted)" textAnchor="middle">в очереди ↑ · время →</text>
      </svg>

      {hov && (
        <div style={{
          position: 'absolute', left: `min(${(x(hov.t) / W) * 100}%, calc(100% - 170px))`, top: 6,
          transform: 'translateX(8px)', pointerEvents: 'none', zIndex: 5,
          background: 'var(--surface, #161a20)', border: '1px solid var(--accent)', borderRadius: 8,
          padding: '6px 9px', fontSize: 11.5, boxShadow: '0 6px 22px rgba(0,0,0,.45)',
        }}>
          <b>{h0(hov.t)} ч</b>
          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
            в очереди: <b style={{ color: 'var(--intent-warning)' }}>{hov.queued}</b> оп.<br />
            {hov.top_wc ? `узко: ${hov.top_wc} (${hov.top_wc_n})` : 'нет очереди'}
          </div>
        </div>
      )}
    </div>
  )
}
