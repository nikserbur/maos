/**
 * Разница с названной базой (X2 «сравнение — явная Δ к базе»): «▲ +1,2 млн ₽ к №27». Знак — U+2212,
 * стрелка ▲▼ — направление, тон — направление × «что лучше» (только на стрелке; текст — текстовым
 * токеном) и слово «лучше/хуже» для экранного диктора. Числа — только через src/explain/format.ts.
 */
import { DASH, signed, type Unit } from '../../explain/format'
import './kit.css'

export type DeltaBetter = 'high' | 'low'

interface DeltaChipProps {
  value: number | null | undefined
  unit?: Unit
  /** Свой форматтер модуля со знаком (п. п., б. п.) — вместо `signed(value, unit)`. */
  fmt?: (v: number) => string
  /** Что лучше: рост (high) или снижение (low); без него — нейтрально. */
  better?: DeltaBetter
  /** Названная база: «№27», «Базовый», «правило CR». */
  base?: string
  size?: 'sm' | 'md'
  title?: string
}

export type DeltaTone = 'good' | 'bad' | 'neutral'

/** Тон разницы: направление × «что лучше»; ноль и неизвестное «лучше» — нейтрально. */
export function deltaTone(value: number, better?: DeltaBetter): DeltaTone {
  if (!better || !Number.isFinite(value) || value === 0) return 'neutral'
  const up = value > 0
  return (better === 'high') === up ? 'good' : 'bad'
}

const WORD: Record<DeltaTone, string> = { good: 'лучше', bad: 'хуже', neutral: '' }

export function DeltaChip({ value, unit = '—', fmt, better, base, size = 'sm', title }: DeltaChipProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={`dk-delta dk-delta--${size} dk-delta--neutral`}>{DASH}</span>
  }
  const tone = deltaTone(value, better)
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '='
  const text = fmt ? fmt(value) : signed(value, unit)
  return (
    <span className={`dk-delta dk-delta--${size} dk-delta--${tone}`} title={title}>
      <span className="dk-delta__arrow" aria-hidden="true">{arrow}</span>
      <span className="dk-delta__v num">{text}</span>
      {base && <span className="dk-delta__base">к {base}</span>}
      {WORD[tone] && <span className="dk-vh"> — {WORD[tone]}</span>}
    </span>
  )
}
