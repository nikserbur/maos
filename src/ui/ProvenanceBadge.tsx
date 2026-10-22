/**
 * Бейдж происхождения значения (UX-V2 §4.3, §5.2): короткая метка caps + глиф, тон — токены
 * статусов. Один компонент для серверного паспорта (status) и паспорта карты (provenance).
 */
import type { Provenance, Stage } from '../features/method-map/types'
import { badgeForProvenance, badgeForStatus, type BadgeSpec } from './passportBadge'
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
  const spec: BadgeSpec = status !== undefined && (stage === undefined || stage === 'done')
    ? badgeForStatus(status, { deprecated })
    : badgeForProvenance(provenance ?? 'default', { deprecated, stage })
  return (
    <span className={`pf-badge pf-badge--${spec.tone} pf-badge--${spec.key}`} title={title ?? spec.label} data-key={spec.key}>
      <span className="pf-badge__glyph" aria-hidden="true">{spec.glyph}</span>
      {long ? spec.label : spec.short}
    </span>
  )
}
