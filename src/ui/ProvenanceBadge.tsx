/**
 * Происхождение значения (UX-V2 §4.3, §5.2): глиф + короткое слово единого словаря
 * (stateVocabulary.ts) или источник словами («ЦБ РФ, сент. 2026»), подробность — в подсказке.
 * Один компонент для серверного паспорта (status) и паспорта карты (provenance); «вручную»
 * побеждает статус. Вид `inline` (по умолчанию в полях) — маленький глиф и слово без рамки
 * (владелец: «пунктирные CAPS-пилюли «ПО УМОЛЧАНИЮ» — некрасиво»); `pill` — для исключений
 * в таблицах и паспорте (▲ устарело, синтетика, в плане).
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
  /** Источник словами вместо короткого слова: «ЦБ РФ, сент. 2026», «НСИ», «история ряда». */
  source?: string
  /** inline — глиф и слово без рамки (поля); pill — бейдж в рамке (таблицы, паспорт). */
  variant?: 'pill' | 'inline'
}

export function ProvenanceBadge({ provenance, status, deprecated, stage, long = false, title, source, variant = 'pill' }: ProvenanceBadgeProps) {
  const spec: BadgeSpec = badgeForField({ provenance, status, deprecated, stage })
  const text = source ?? (long ? spec.label : spec.short)
  const tip = title ?? (source ? `${spec.label} · ${source}` : spec.label)
  const base = variant === 'inline' ? 'pf-prov' : 'pf-badge'
  // Строчный вид сохраняет классы `pf-badge pf-badge--<key>`: экраны прячут происхождение по ним.
  const hook = variant === 'inline' ? `pf-badge pf-badge--${spec.key} ` : ''
  return (
    <span className={`${hook}${base} ${base}--${spec.tone} ${base}--${spec.key}`} title={tip} data-key={spec.key}>
      {spec.glyph && <span className={`${base}__glyph`} aria-hidden="true">{spec.glyph}</span>}
      {text}
      {source && <span className="pf-vh">, {spec.short}</span>}
    </span>
  )
}
