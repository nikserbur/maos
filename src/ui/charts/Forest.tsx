/**
 * Лесной график сравнения с базой (X2 «сравнение — явная Δ к названной базе + доля побед»):
 * строка = вариант: имя · Δ к базе с ДИ (отрезок) и точкой · Δ числом · доля побед. Все строки — на
 * общей шкале X, нулевая линия подписана («0 — как база»), порог — подписанным пунктиром.
 * Рамка — ChartFrame с таблицей-двойником. Цвет точки — --chart-1, текст — текстовыми токенами;
 * отрезок, целиком правее нуля, — «лучше» (глиф ▲ и слово), а не цвет.
 */
import type { ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { useMeasuredWidth } from './hooks'
import { DASH } from '../../explain/format'
import './charts.css'

export interface ForestRow {
  key: string
  label: string
  /** Δ к базе (точечная оценка). */
  delta: number
  /** Границы ДИ Δ. */
  lo: number
  hi: number
  /** Доля побед над базой (0…1) — «в 62 из 100 сценариев». */
  share?: number
  /** Выделить строку (выбранный вариант). */
  emphasis?: boolean
}

interface ForestProps {
  rows: ReadonlyArray<ForestRow>
  /** Форматтер Δ со знаком (signed(v, unit), pp(v, { signed: true })). */
  fmt: (v: number) => string
  /** Форматтер доли побед (по умолчанию «62 из 100»). */
  fmtShare?: (v: number) => string
  /** Общая шкала X; по умолчанию — по ДИ, нулю и порогу. */
  domain?: readonly [number, number]
  threshold?: { value: number; label: string }
  zeroLabel?: string
  /** Чем лучше Δ: больше (high) или меньше (low). */
  better?: 'high' | 'low'
  /** Названная база: «к правилу CR». */
  baseLabel?: string
  title?: ReactNode
  subtitle?: ReactNode
  ariaLabel?: string
  compact?: boolean
  className?: string
}

const ROW_H = 26
const PAD = 8

const defaultShare = (v: number) => `${Math.round(v * 100)} из 100`

/** Вердикт строки по ДИ: целиком по «лучшую» сторону нуля — лучше, по «худшую» — хуже, иначе — неясно. */
export function forestVerdict(r: Pick<ForestRow, 'lo' | 'hi'>, better: 'high' | 'low' = 'high'): 'better' | 'worse' | 'unclear' {
  const above = r.lo > 0
  const below = r.hi < 0
  if (!above && !below) return 'unclear'
  return (above === (better === 'high')) ? 'better' : 'worse'
}

const VERDICT: Record<'better' | 'worse' | 'unclear', { glyph: string; word: string }> = {
  better: { glyph: '▲', word: 'лучше' },
  worse: { glyph: '▼', word: 'хуже' },
  unclear: { glyph: '○', word: 'не отличить' },
}

export function Forest({
  rows, fmt, fmtShare = defaultShare, domain, threshold, zeroLabel = '0 — как база', better = 'high', baseLabel, title, subtitle, ariaLabel, compact, className,
}: ForestProps) {
  const [ref, trackW] = useMeasuredWidth<HTMLDivElement>(240)
  const vals = rows.flatMap((r) => [r.lo, r.hi, r.delta]).filter(Number.isFinite)
  const lo = domain ? domain[0] : Math.min(0, threshold?.value ?? 0, ...vals)
  const hi = domain ? domain[1] : Math.max(0, threshold?.value ?? 0, ...vals)
  const span = hi - lo || 1
  const x = (v: number) => PAD + ((Math.min(hi, Math.max(lo, v)) - lo) / span) * Math.max(10, trackW - PAD * 2)
  const hasShare = rows.some((r) => r.share !== undefined)
  const table: ChartTable = {
    columns: ['Вариант', `Разница${baseLabel ? ` ${baseLabel}` : ' с базой'}`, 'Диапазон от', 'Диапазон до', ...(hasShare ? ['Доля побед'] : []), 'Вывод'],
    rows: rows.map((r) => [r.label, fin(r.delta, fmt), fin(r.lo, fmt), fin(r.hi, fmt), ...(hasShare ? [r.share === undefined ? DASH : fmtShare(r.share)] : []), VERDICT[forestVerdict(r, better)].word]),
  }
  const label = ariaLabel ?? `Сравнение с базой${baseLabel ? ` ${baseLabel}` : ''}: ${rows.length} вариантов`

  return (
    <ChartFrame title={title} subtitle={subtitle} ariaLabel={label} table={rows.length ? table : null} compact={compact} className={className}
      empty={rows.length === 0 ? 'Нет вариантов для сравнения' : undefined}>
      <div className={`ch-forest${hasShare ? ' ch-forest--share' : ''}`}>
        <div className="ch-forest__row ch-forest__row--axis" aria-hidden="true">
          <span />
          <div ref={ref} className="ch-forest__track">
            <svg className="ch-svg" width={trackW} height={ROW_H} viewBox={`0 0 ${trackW} ${ROW_H}`}>
              {axisLabels(x, trackW, zeroLabel, threshold).map((l) => (
                <text key={l.key} className="ch-forest__axislabel" x={l.x} y={ROW_H - 6 - l.row * 12} textAnchor={l.anchor}>{l.text}</text>
              ))}
            </svg>
          </div>
          <span className="ch-forest__h num">Разница</span>
          {hasShare && <span className="ch-forest__h num">Побед</span>}
        </div>
        {rows.map((r) => {
          const v = forestVerdict(r, better)
          return (
            <div key={r.key} className={`ch-forest__row${r.emphasis ? ' is-emph' : ''}`}>
              <span className="ch-forest__name" title={r.label}>{r.label}</span>
              <div className="ch-forest__track">
                <svg className="ch-svg" width={trackW} height={ROW_H} viewBox={`0 0 ${trackW} ${ROW_H}`} aria-hidden="true">
                  <line className="ch-forest__zero" x1={x(0)} x2={x(0)} y1={0} y2={ROW_H} />
                  {threshold && <line className="ch-forest__thr" x1={x(threshold.value)} x2={x(threshold.value)} y1={0} y2={ROW_H} />}
                  {Number.isFinite(r.lo) && Number.isFinite(r.hi) && <line className="ch-forest__ci" x1={x(r.lo)} x2={x(r.hi)} y1={ROW_H / 2} y2={ROW_H / 2} />}
                  {Number.isFinite(r.delta) && <circle className="ch-forest__dot" cx={x(r.delta)} cy={ROW_H / 2} r={4.5} />}
                </svg>
              </div>
              <span className="ch-forest__v num" title={VERDICT[v].word}>
                <span className={`ch-forest__glyph ch-forest__glyph--${v}`} aria-hidden="true">{VERDICT[v].glyph}</span>{fin(r.delta, fmt)}
              </span>
              {hasShare && <span className="ch-forest__v num">{r.share === undefined ? DASH : fmtShare(r.share)}</span>}
            </div>
          )
        })}
      </div>
    </ChartFrame>
  )
}

/** Ширина символа подписи 11 px (sans), px — для оценки длины подписи без DOM. */
const LABEL_CHAR_W = 6.2

interface AxisLabel { key: string; x: number; anchor: 'start' | 'middle' | 'end'; text: string; row: number }

/**
 * Подписи нулевой линии и порога: целиком внутри дорожки (у краёв — прижаты), при наезде порог
 * уходит на строку выше — подпись никогда не обрезается рамкой SVG.
 */
export function axisLabels(x: (v: number) => number, trackW: number, zeroLabel: string, threshold?: { value: number; label: string }): AxisLabel[] {
  const place = (key: string, v: number, text: string): AxisLabel => {
    const half = (text.length * LABEL_CHAR_W) / 2
    const cx = x(v)
    if (cx - half < 0) return { key, x: 0, anchor: 'start', text, row: 0 }
    if (cx + half > trackW) return { key, x: trackW, anchor: 'end', text, row: 0 }
    return { key, x: cx, anchor: 'middle', text, row: 0 }
  }
  const span = (l: AxisLabel): [number, number] => {
    const w = l.text.length * LABEL_CHAR_W
    return l.anchor === 'start' ? [l.x, l.x + w] : l.anchor === 'end' ? [l.x - w, l.x] : [l.x - w / 2, l.x + w / 2]
  }
  const zero = place('zero', 0, zeroLabel)
  if (!threshold) return [zero]
  const thr = place('thr', threshold.value, threshold.label)
  const [a0, a1] = span(zero)
  const [b0, b1] = span(thr)
  const overlap = a0 < b1 + 8 && b0 < a1 + 8
  return [zero, { ...thr, row: overlap ? 1 : 0 }]
}

function fin(v: number, fmt: (v: number) => string): string {
  return Number.isFinite(v) ? fmt(v) : DASH
}
