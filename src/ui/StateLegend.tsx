/**
 * Единая легенда состояний (X2 «одно состояние — один глиф — одно слово»): глифы и слова — из
 * src/ui/stateVocabulary.ts, те же, что у узлов карты, бейджей паспорта, степпера и полосы
 * методологии. Глифы — глобальные (styles/glyphs.css), поэтому видны без визита на карту.
 * `present` — показать только состояния, которые реально есть на экране.
 */
import type { NodeState } from '../features/method-map/types'
import { NODE_STATE_VOCAB, vocabForState } from './stateVocabulary'
import './fields.css'

/** Порядок по умолчанию — от «по данным» к «не задано». */
export const DEFAULT_LEGEND_STATES: readonly NodeState[] = ['estimated', 'manual', 'normative', 'default', 'stale', 'unconfigured']

interface StateLegendProps {
  states?: readonly NodeState[]
  /** Состояния, которые есть на экране: легенда показывает только их (порядок — из `states`). */
  present?: readonly NodeState[]
  /** Компактная строка без заголовка (в подсказках и шапках карточек). */
  compact?: boolean
  label?: string
}

export function StateLegend({ states = DEFAULT_LEGEND_STATES, present, compact = false, label = 'Легенда состояний' }: StateLegendProps) {
  const presentKeys = present ? new Set(present.map((s) => NODE_STATE_VOCAB[s])) : null
  const seen = new Set<string>()
  // Одна запись на слово словаря: «оценено» и «калибровка» — одно «● по данным».
  const shown = states.filter((s) => {
    const key = NODE_STATE_VOCAB[s]
    if (seen.has(key) || (presentKeys && !presentKeys.has(key))) return false
    seen.add(key)
    return true
  })
  if (shown.length === 0) return null
  return (
    <span className={`pf-legend${compact ? ' pf-legend--compact' : ''}`} role="list" aria-label={label}>
      {shown.map((s) => {
        const v = vocabForState(s)
        return (
          <span key={s} className={`pf-legend__item${v.key === 'planned' ? ' pf-legend__item--planned' : ''}`} role="listitem" title={v.hint}>
            {v.glyph && <span className={`mm-glyph mm-glyph--${s}`} aria-hidden="true" />}
            {v.word}
          </span>
        )
      })}
    </span>
  )
}
