/**
 * Бейдж происхождения значения (UX-V2 §4.3, §5.2): глиф + короткое слово единого словаря
 * (stateVocabulary.ts), подробность — в подсказке. Один компонент для серверного паспорта (status) и
 * паспорта карты (provenance); «вручную» побеждает статус, «в плане» — пунктирная рамка без глифа.
 */
import type { Provenance, Stage } from '../features/method-map/types'
import { badgeForField, type BadgeSpec } from './passportBadge'
import './fields.css'

interface ProvenanceBadgeProps {
  provenance?: Provenance
  status?: string
  deprecated?: boolean
  stage?: Stage
  /** Полная подпись вместо короткой метки. */
  long?: boolean
  title?: string
}

export function ProvenanceBadge({ provenance, status, deprecated, stage, long = false, title }: ProvenanceBadgeProps) {
  const spec: BadgeSpec = badgeForField({ provenance, status, deprecated, stage })
  return (
    <span className={`pf-badge pf-badge--${spec.tone} pf-badge--${spec.key}`} title={title ?? spec.label} data-key={spec.key}>
      {spec.glyph && <span className="pf-badge__glyph" aria-hidden="true">{spec.glyph}</span>}
      {long ? spec.label : spec.short}
    </span>
  )
}
