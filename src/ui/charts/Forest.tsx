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
    columns: ['Вариант', `Δ${baseLabel ? ` ${baseLabel}` : ''}`, 'ДИ от', 'ДИ до', ...(hasShare ? ['Доля побед'] : []), 'Вывод'],
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
              <text className="ch-forest__axislabel" x={x(0)} y={ROW_H - 6} textAnchor="middle">{zeroLabel}</text>
              {threshold && <text className="ch-forest__axislabel" x={x(threshold.value)} y={ROW_H - 6} textAnchor="middle">{threshold.label}</text>}
            </svg>
          </div>
          <span className="ch-forest__h num">Δ</span>
          {hasShare && <span className="ch-forest__h num">побед</span>}
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

function fin(v: number, fmt: (v: number) => string): string {
  return Number.isFinite(v) ? fmt(v) : DASH
}
