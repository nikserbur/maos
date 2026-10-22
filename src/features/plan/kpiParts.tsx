/**
 * Детали KPI-плиток: плитка с подписью и «i», крупное значение с единицей, полоса хвоста
 * риска (дет. ○ · E ● · CVaR ▲ · худший ■) и разложение фонда станков — на примитивах
 * chart-системы (`RangeStrip`, `StackBar`), без inline-стилей.
 */
import type { ReactNode } from 'react'
import { InfoTip, type InfoTipValues } from '../../ui/InfoTip'
import { hours, num } from '../../explain/format'
import { RangeStrip, StackBar, type RangeMark, type StackSegment } from '../../ui/charts'

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

/** Подписи: E — герой выше; числом только CVaR и худший (X1: ≤ 14 чисел выше сгиба). */
export function TailStrip({ det, mean, cvar, worst }: TailProps) {
  const marks: RangeMark[] = [
    { key: 'det', value: det, label: 'детерминированное (Гант)', glyph: 'ring', tone: 'idle' },
    { key: 'mean', value: mean, label: 'E[Cmax]', glyph: 'dot', tone: 'accent' },
    { key: 'cvar', value: cvar, label: 'CVaR', glyph: 'triangle', tone: 'warn', showValue: true },
    { key: 'worst', value: worst, label: 'худший прогон', glyph: 'square', tone: 'danger', showValue: true },
  ]
  return (
    <div>
      <RangeStrip marks={marks} fmt={(v) => num(v, 1)} zone={worst > cvar ? [cvar, worst] : undefined} zoneLabel="хвост CVaR…худший"
        ariaLabel={`Длина расписания: детерминированная ${hours(det)}, E ${hours(mean)}, CVaR ${hours(cvar)}, худший прогон ${hours(worst)}`} />
      <div className="pl-fund-legend">
        <span className="glyph-idle" title={`детерминированное (Гант): ${hours(det)}`}>дет.</span>
        <span className="pl-tail__key">E[Cmax]</span>
        <span className="glyph-setup">CVaR</span>
        <span className="glyph-down">худший, ч</span>
      </div>
    </div>
  )
}

/* ── Разложение фонда станков ────────────────────────────────────────────── */

export interface FundParts { busy: number; setup: number; down: number; idle: number }

/** Состояния станка — цвета статусов вместе с глифами (● ▲ ■ ○), ТО/ремонт — ещё и штриховкой. */
export function FundBar({ busy, setup, down, idle }: FundParts) {
  const total = busy + setup + down + idle
  if (total <= 0) return null
  const segments: StackSegment[] = [
    { key: 'busy', label: 'обработка', value: busy, color: 'var(--status-running)', glyph: 'glyph-running' },
    { key: 'setup', label: 'переналадки', value: setup, color: 'var(--status-setup)', glyph: 'glyph-setup' },
    { key: 'down', label: 'ТО и ремонты', value: down, color: 'var(--status-down)', glyph: 'glyph-down', hatched: true },
    { key: 'idle', label: 'простой', value: idle, color: 'var(--chart-grid)', glyph: 'glyph-idle' },
  ].filter((s) => s.value > 0)
  return <StackBar segments={segments} fmt={(v) => hours(v, 0)} total={`фонд ${hours(total, 0)}`} ariaLabel={`Фонд станков ${hours(total, 0)}: ${segments.map((s) => `${s.label} ${hours(s.value, 0)}`).join(', ')}`} />
}
