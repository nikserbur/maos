/**
 * Детали KPI-плиток: плитка с подписью и «i», крупное значение с единицей, полоса хвоста
 * риска (дет. ○ · E ● · CVaR ▲ · худший ■), разложение фонда станков, спарклайн очереди.
 */
import type { ReactNode } from 'react'
import { InfoTip, type InfoTipValues } from '../../ui/InfoTip'
import { NBSP, num } from '../../explain/format'

/* ── Плитка ──────────────────────────────────────────────────────────────── */

interface TileProps {
  metric: string
  label: string
  values: InfoTipValues
  span?: 's3' | 's4' | 's5' | 's7'
  hero?: boolean
  status?: ReactNode
  children: ReactNode
}

export function Tile({ metric, label, values, span = 's3', hero = false, status, children }: TileProps) {
  const cls = `pl-tile${span !== 's3' ? ` pl-tile--${span}` : ''}${hero ? ' pl-tile--hero' : ''}`
  return (
    <div className={cls} role="group" aria-label={label}>
      <div className="pl-tile__k">
        <span className="pl-tile__label text-caps">{label}<InfoTip id={metric} values={values} /></span>
        {status}
      </div>
      {children}
    </div>
  )
}

/** Подпись показателя внутри составной плитки (своя «i»). */
export function SubLabel({ metric, label, values }: { metric: string; label: string; values: InfoTipValues }) {
  return <span className="pl-tile__label text-caps pl-tile__k">{label}<InfoTip id={metric} values={values} /></span>
}

/** «1,23 млн ₽» → ["1,23", "млн ₽"]; «93,4 %» → ["93,4", "%"]. */
export function splitUnit(text: string): [string, string] {
  const m = /^([−\d,\s]*\d)\s(.+)$/u.exec(text)
  return m ? [m[1], m[2]] : [text, '']
}

export function Value({ text, unit, size = 'hero' }: { text: string; unit?: string; size?: 'hero' | 'md' }) {
  return (
    <div className={`pl-tile__v num ${size === 'md' ? 'pl-tile__v--md' : 'kpi-hero'}`}>
      {text}{unit && <span className="unit">{unit}</span>}
    </div>
  )
}

/** Значение из готовой строки форматтера («1 123,4 ч») с отделённой единицей. */
export function FmtValue({ text, size }: { text: string; size?: 'hero' | 'md' }) {
  const [n, u] = splitUnit(text)
  return <Value text={n} unit={u || undefined} size={size} />
}

/* ── Хвост риска длины расписания ────────────────────────────────────────── */

interface TailProps { det: number; mean: number; cvar: number; worst: number }

export function TailStrip({ det, mean, cvar, worst }: TailProps) {
  const lo = Math.min(det, mean, cvar)
  const hi = Math.max(worst, cvar, mean)
  const span = Math.max(1e-9, hi - lo)
  const pos = (v: number) => 3 + ((v - lo) / span) * 94
  const marks = [
    { key: 'det', v: det, cls: 'glyph-idle', label: 'детерминированное' },
    { key: 'cvar', v: cvar, cls: 'glyph-setup', label: 'CVaR' },
    { key: 'worst', v: worst, cls: 'glyph-down', label: 'худший прогон' },
  ]
  return (
    <div>
      <div className="pl-tail" aria-hidden="true">
        <span className="pl-tail__track" />
        {worst > cvar && <span className="pl-tail__zone" style={{ left: `${pos(cvar)}%`, width: `${pos(worst) - pos(cvar)}%` }} />}
        {marks.map((m) => (
          <span key={m.key} className={`pl-tail__m ${m.cls}`} style={{ left: `${pos(m.v)}%` }} title={`${m.label}: ${num(m.v, 1)} ч`} />
        ))}
        <span className="pl-tail__m is-mean" style={{ left: `${pos(mean)}%` }} title={`E[Cmax]: ${num(mean, 1)} ч`}>
          <span className="pl-tail__dot" />
        </span>
      </div>
      <div className="pl-fund-legend">
        <span className="glyph-idle">дет. <span className="num">{num(det, 1)}</span></span>
        <span className="pl-tail__key">E <b className="num">{num(mean, 1)}</b></span>
        <span className="glyph-setup">CVaR <span className="num">{num(cvar, 1)}</span></span>
        <span className="glyph-down">худший <span className="num">{num(worst, 1)}</span>{NBSP}ч</span>
      </div>
    </div>
  )
}

/* ── Разложение фонда станков ────────────────────────────────────────────── */

export interface FundParts { busy: number; setup: number; down: number; idle: number }

export function FundBar({ busy, setup, down, idle }: FundParts) {
  const total = busy + setup + down + idle
  if (total <= 0) return null
  const w = (v: number) => `${(v / total) * 100}%`
  const parts = [
    { key: 'busy', v: busy, cls: 'pl-fund__busy', glyph: 'glyph-running', label: 'обработка' },
    { key: 'setup', v: setup, cls: 'pl-fund__setup', glyph: 'glyph-setup', label: 'переналадки' },
    { key: 'down', v: down, cls: 'pl-fund__down', glyph: 'glyph-down', label: 'ТО и ремонты' },
    { key: 'idle', v: idle, cls: 'pl-fund__idle', glyph: 'glyph-idle', label: 'простой' },
  ]
  return (
    <>
      <div className="pl-fund" role="img"
           aria-label={parts.map((p) => `${p.label} ${num(p.v, 0)} ч`).join(', ')}>
        {parts.map((p) => p.v > 0 && <span key={p.key} className={p.cls} style={{ width: w(p.v) }} />)}
      </div>
      <div className="pl-fund-legend">
        {parts.map((p) => (
          <span key={p.key} className={p.glyph}>{p.label} <span className="num">{num(p.v, 0)}{NBSP}ч</span></span>
        ))}
        <span>фонд <span className="num">{num(total, 0)}{NBSP}ч</span></span>
      </div>
    </>
  )
}

/* ── Спарклайн ───────────────────────────────────────────────────────────── */

export function Sparkline({ points, label }: { points: ReadonlyArray<{ t: number; queued: number }>; label: string }) {
  if (points.length < 2) return null
  const tMax = Math.max(1e-9, ...points.map((p) => p.t))
  const qMax = Math.max(1, ...points.map((p) => p.queued))
  const xy = points.map((p) => `${(p.t / tMax) * 100},${32 - (p.queued / qMax) * 30}`)
  return (
    <svg className="pl-spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id="pl-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="pl-spark__s0" />
          <stop offset="100%" className="pl-spark__s1" />
        </linearGradient>
      </defs>
      <polygon className="pl-spark__area" points={`0,34 ${xy.join(' ')} 100,34`} />
      <polyline className="pl-spark__line" points={xy.join(' ')} />
    </svg>
  )
}
