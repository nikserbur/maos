/**
 * Малые формы (из kpiParts Плана): `StackBar` — доли одной полосы с 2 px зазорами поверхности
 * и легендой; `Meter` — заполнение одной шкалы, дорожка — светлая ступень того же цвета;
 * двуполярный `Meter` (skill −100…+100 %) — от центра. Цвета — токены графиков; для разложения
 * фонда станков сегменты несут состояния (обработка/наладка/ТО/простой) — тогда цвет статуса
 * идёт вместе с глифом в легенде, штриховка (`hatched`) отличает «ТО/ремонт» без цвета.
 */
import { useId, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { colorOf, type LegendItem } from './palette'
import { svgId } from './scale'
import './charts.css'

export interface StackSegment {
  key: string
  label: string
  value: number
  color?: string
  /** Глиф состояния в легенде (класс glyphs.css). */
  glyph?: string
  /** Диагональная штриховка поверх цвета — второй признак, не зависящий от цвета. */
  hatched?: boolean
}

interface StackBarProps {
  segments: ReadonlyArray<StackSegment>
  fmt: (v: number) => string
  title?: ReactNode
  subtitle?: ReactNode
  ariaLabel?: string
  compact?: boolean
  /** Подпись итога в конце легенды («фонд 557 ч»). */
  total?: string
  className?: string
}

/** Полоса долей: сегменты пропорциональны значениям; легенда всегда (≥ 2 сегментов). */
export function StackBar({ segments, fmt, title, subtitle, ariaLabel, compact = true, total: totalLabel, className }: StackBarProps) {
  const rid = useId()
  const hatchId = svgId(rid, 'hatch')
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1
  const legend: LegendItem[] = segments.map((s, i) => ({ key: s.key, label: `${s.label} · ${fmt(s.value)}`, color: colorOf(i, s.color), shape: 'rect', glyph: s.glyph }))
  if (totalLabel) legend.push({ key: 'total', label: totalLabel, color: 'transparent', swatchClass: 'ch-swatch--none' })
  const table: ChartTable = { columns: ['Составляющая', 'Значение'], rows: segments.map((s) => [s.label, fmt(s.value)]) }
  let x = 0
  return (
    <ChartFrame title={title} subtitle={subtitle} legend={legend} ariaLabel={ariaLabel ?? `Доли: ${segments.map((s) => `${s.label} ${fmt(s.value)}`).join(', ')}`}
      table={table} compact={compact} className={className} empty={segments.length === 0 ? 'Нет данных' : undefined}>
      <svg className="ch-stack" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="2" height="10" patternTransform="skewX(-30)">
            <rect className="ch-stack__hatch" x="0" y="0" width="1" height="10" />
          </pattern>
        </defs>
        {segments.map((s, i) => {
          const w = (Math.max(0, s.value) / total) * 100
          const x0 = x
          x += w
          if (w <= 0) return null
          return (
            <g key={s.key}>
              <rect x={x0} y="0" width={w} height="10" fill={colorOf(i, s.color)} />
              {s.hatched && <rect x={x0} y="0" width={w} height="10" fill={`url(#${hatchId})`} />}
            </g>
          )
        })}
      </svg>
    </ChartFrame>
  )
}

export type MeterTone = 'accent' | 'good' | 'warn' | 'danger' | 'neutral'

interface MeterProps {
  /** Значение в единицах шкалы; `min`/`max` задают дорожку (по умолчанию 0…1). */
  value: number
  min?: number
  max?: number
  /** Тон заливки: серьёзность, а не ряд; дорожка — светлая ступень того же тона. */
  tone?: MeterTone
  /** Отметка на шкале (ковенант, порог) — вертикальная засечка. */
  mark?: number
  label?: string
  className?: string
}

/** Метр: одно число на дорожке. Двуполярный, если min < 0 < max — заливка от нуля. */
export function Meter({ value, min = 0, max = 1, tone = 'accent', mark, label, className }: MeterProps) {
  const span = max - min || 1
  const at = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100))
  const bipolar = min < 0 && max > 0
  const zero = bipolar ? at(0) : 0
  const v = at(Number.isFinite(value) ? value : min)
  const x = bipolar ? Math.min(zero, v) : 0
  const w = bipolar ? Math.abs(v - zero) : v
  return (
    <svg className={`ch-meter ch-meter--${tone}${className ? ` ${className}` : ''}`} viewBox="0 0 100 6" preserveAspectRatio="none"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect className="ch-meter__track" x="0" y="0" width="100" height="6" />
      <rect className="ch-meter__fill" x={x} y="0" width={Math.max(0.5, w)} height="6" />
      {bipolar && <line className="ch-meter__zero" x1={zero} x2={zero} y1="0" y2="6" />}
      {mark !== undefined && <line className="ch-meter__mark" x1={at(mark)} x2={at(mark)} y1="0" y2="6" />}
    </svg>
  )
}
