/**
 * Веер прогноза (UX-V2 §5.3 `FanChart`): история → «сейчас» → P10/P50/P90 (+ P25/P75 как более
 * тёмная полоса, если есть), тренд, ось дат и ось значений, ромбы факта бэктеста и область
 * ошибки; в углу — статус качества «CRPS · skill · покрытие» со своим «i». Второй веер (B)
 * накладывается охрой для сравнения сценариев. Только токены темы.
 */
import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'
import './fields.css'

export interface FanSeries {
  p10: readonly number[]
  p50: readonly number[]
  p90: readonly number[]
  p25?: readonly number[]
  p75?: readonly number[]
  trend?: readonly number[]
  history?: readonly number[]
}

export interface FanQuality {
  /** skill ∈ [0, 1]: доля ошибки, снятой относительно наивного; < 0 — хуже наивного. */
  skill?: number | null
  crps?: number | null
  /** Подпись меры: «CRPS» или «прокси (пинбол P10/P90)». */
  crpsLabel?: string
  coverage80?: number | null
  /** Сколько последних точек истории скрыто от модели (бэктест). */
  backtestK?: number
  /** Состояние: ok — лучше наивного, warn — хуже, none — нет проверки. */
  status: 'ok' | 'warn' | 'none'
  info?: string
  infoValues?: Readonly<Record<string, number | string | null | undefined>>
}

interface FanChartProps {
  a: FanSeries
  b?: FanSeries | null
  /** Подписи оси дат: история (мес назад) и прогноз (мес вперёд) — через `startLabel`/`stepLabel`. */
  monthLabel?: (offset: number) => string
  fmt?: (v: number) => string
  quality?: FanQuality
  title?: ReactNode
  badges?: ReactNode
  height?: number
  width?: number
}

const PADL = 44, PADR = 10, PADT = 14, PADB = 24

function minmax(s: FanSeries): [number, number] {
  const all = [...(s.history ?? []), ...s.p10, ...s.p90, ...(s.trend ?? [])].filter(Number.isFinite)
  return all.length ? [Math.min(...all), Math.max(...all)] : [0, 1]
}

export function FanChart({ a, b, monthLabel, fmt = (v) => String(Math.round(v)), quality, title, badges, height = 170, width = 360 }: FanChartProps) {
  const hist = a.history ?? []
  const H = hist.length
  const N = a.p50.length - 1
  const fcStart = H > 0 ? H - 1 : 0
  const total = fcStart + N + 1
  const [loA, hiA] = minmax(a)
  const [loB, hiB] = b ? minmax(b) : [loA, hiA]
  const lo = Math.min(loA, loB), hi = Math.max(hiA, hiB)
  const span = hi - lo || 1
  const X = (i: number) => PADL + (i / Math.max(1, total - 1)) * (width - PADL - PADR)
  const Y = (v: number) => PADT + (1 - (v - lo) / span) * (height - PADT - PADB)
  const fc = (arr: readonly number[]) => arr.map((v, f) => `${X(fcStart + f).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const band = (up: readonly number[], dn: readonly number[]) =>
    `${up.map((v, f) => `${X(fcStart + f).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} ${[...dn].map((v, f) => ({ v, f })).reverse().map(({ v, f }) => `${X(fcStart + f).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}`
  const nowX = X(fcStart)
  const ticksY = [lo, lo + span / 2, hi]
  const k = quality?.backtestK ?? 0
  const lbl = monthLabel ?? ((o) => (o === 0 ? 'сейчас' : o > 0 ? `+${o} мес` : `−${-o} мес`))
  return (
    <figure className="pf-fan">
      {(title || badges) && (
        <figcaption className="pf-fan__head">
          <span className="pf-fan__title">{title}</span>
          <span className="pf-fan__badges">{badges}</span>
        </figcaption>
      )}
      <div className="pf-fan__body">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" className="pf-fan__svg"
             aria-label={`Веер: медиана через ${N} мес ${fmt(a.p50[N] ?? 0)}, интервал ${fmt(a.p10[N] ?? 0)}–${fmt(a.p90[N] ?? 0)}`}>
          {ticksY.map((v) => (
            <g key={v}>
              <line className="pf-fan__grid" x1={PADL} x2={width - PADR} y1={Y(v)} y2={Y(v)} />
              <text className="pf-fan__tick" x={PADL - 6} y={Y(v) + 3.5} textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          <rect className="pf-fan__future" x={nowX} y={PADT} width={width - PADR - nowX} height={height - PADT - PADB} />
          {k > 0 && H > k && (
            <rect className="pf-fan__bt" x={X(H - 1 - k)} y={PADT} width={X(H - 1) - X(H - 1 - k)} height={height - PADT - PADB} />
          )}
          <line className="pf-fan__now" x1={nowX} x2={nowX} y1={PADT} y2={height - PADB} />
          {H > 0 && <polyline className="pf-fan__hist" points={hist.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} />}
          {k > 0 && H > k && hist.slice(H - k).map((v, i) => (
            <path key={i} className="pf-fan__fact" d={`M ${X(H - k + i)} ${Y(v) - 3.5} l 3.5 3.5 l -3.5 3.5 l -3.5 -3.5 z`} />
          ))}
          {b && <polygon className="pf-fan__band pf-fan__band--b" points={band(b.p90, b.p10)} />}
          <polygon className="pf-fan__band" points={band(a.p90, a.p10)} />
          {a.p25 && a.p75 && <polygon className="pf-fan__band pf-fan__band--inner" points={band(a.p75, a.p25)} />}
          <polyline className="pf-fan__q" points={fc(a.p90)} />
          <polyline className="pf-fan__q" points={fc(a.p10)} />
          {b && <polyline className="pf-fan__p50 pf-fan__p50--b" points={fc(b.p50)} />}
          <polyline className="pf-fan__p50" points={fc(a.p50)} />
          {a.trend && <polyline className="pf-fan__trend" points={fc(a.trend)} />}
          <text className="pf-fan__tick" x={PADL} y={height - 7}>{H > 0 ? lbl(-(H - 1)) : ''}</text>
          <text className="pf-fan__tick" x={nowX + 3} y={height - 7}>{lbl(0)}</text>
          <text className="pf-fan__tick" x={width - PADR} y={height - 7} textAnchor="end">{lbl(N)}</text>
        </svg>
        {quality && (
          <div className={`pf-fan__quality is-${quality.status}`} role="status">
            <span className={quality.status === 'ok' ? 'glyph-running' : quality.status === 'warn' ? 'glyph-setup' : 'glyph-idle'} aria-hidden="true" />
            <span className="mono">
              {quality.crps != null && `${quality.crpsLabel ?? 'CRPS'} ${quality.crps.toFixed(2)} · `}
              {quality.skill != null ? `skill ${(quality.skill * 100).toFixed(0)} %` : 'без проверки'}
              {quality.coverage80 != null && ` · покрытие ${(quality.coverage80 * 100).toFixed(0)} %`}
            </span>
            {quality.info && <InfoTip id={quality.info} values={quality.infoValues} />}
          </div>
        )}
      </div>
    </figure>
  )
}
