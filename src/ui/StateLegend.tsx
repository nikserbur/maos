/**
 * Единая легенда состояний (UX-V2 §3.4, X1 §7 «словарь состояний»): те же глифы и подписи,
 * что у узлов карты, бейджей паспорта и степпера — ● оценено · ■ вручную · ◆ норматив ·
 * ○ по умолчанию · ▲ устарело · ◌ не задано / в плане. Одна разметка для карты, сценариев и плана.
 */
import { STATE_META } from '../features/method-map/stateMeta'
import { StateGlyph } from '../features/method-map/StateGlyph'
import type { NodeState } from '../features/method-map/types'
import './fields.css'

/** Порядок по умолчанию — от «хорошо» к «не задано». */
export const DEFAULT_LEGEND_STATES: readonly NodeState[] = ['estimated', 'manual', 'normative', 'default', 'stale', 'unconfigured']

interface StateLegendProps {
  states?: readonly NodeState[]
  /** Компактная строка без заголовка (в подсказках и шапках карточек). */
  compact?: boolean
  label?: string
}

export function StateLegend({ states = DEFAULT_LEGEND_STATES, compact = false, label = 'Легенда состояний' }: StateLegendProps) {
  return (
    <span className={`pf-legend${compact ? ' pf-legend--compact' : ''}`} role="list" aria-label={label}>
      {states.map((s) => (
        <span key={s} className="pf-legend__item" role="listitem" title={STATE_META[s].hint}>
          <StateGlyph state={s} />
          {STATE_META[s].label}
        </span>
      ))}
    </span>
  )
}
