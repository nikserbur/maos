/**
 * Развёрнутый паспорт параметра (UX-V2 §5.2) — одна карточка везде: мастер плана, сценарии,
 * панель карты. Состав: значение + единица · бейдж статуса · источник (датасет, n, период,
 * метод) · файл-ссылка в коде · «обновлено» · note · действия. Источник данных — строка
 * серверного паспорта (`PassportParam`) и/или паспорт карты (`ParameterPassport`).
 */
import type { ReactNode } from 'react'
import type { ParameterPassport } from '../features/method-map/types'
import type { PassportParam } from '../lib/api'
import { dateTime } from '../explain/format'
import { ProvenanceBadge } from './ProvenanceBadge'
import { ownerLabel } from './passportBadge'
import './fields.css'

interface PassportCardProps {
  /** Серверная строка (GET /api/passport). */
  server?: PassportParam | null
  /** Паспорт карты (живое значение, диапазон, владелец, экран). */
  passport?: ParameterPassport | null
  scenarioName?: string
  actions?: ReactNode
  compact?: boolean
}

/** Время паспорта — через общий форматтер (серверное время без зоны — UTC → местное). */
const fmtDate = (s?: string) => (s ? dateTime(s) : null)

export function PassportCard({ server, passport, scenarioName, actions, compact = false }: PassportCardProps) {
  if (!server && !passport) return null
  const title = passport?.label ?? server?.name ?? ''
  const value = passport?.value ?? server?.value ?? null
  const unit = passport?.unit && passport.unit !== '—' ? passport.unit : server?.unit && server.unit !== '—' ? server.unit : ''
  const updated = fmtDate(passport?.estimatedAt ?? server?.updated_at)
  const note = [passport?.note, server?.note].filter((t, i, a) => t && a.indexOf(t) === i).join(' ')
  return (
    <section className={`pf-pass${compact ? ' pf-pass--compact' : ''}`} aria-label={`Паспорт: ${title}`}>
      <header className="pf-pass__head">
        <span className="pf-pass__title">{title}</span>
        <ProvenanceBadge provenance={passport?.provenance} status={server?.status ?? passport?.status} deprecated={passport?.deprecated} stage={passport?.stage} long />
      </header>
      <div className="pf-pass__value-row">
        <span className={`pf-pass__value num${passport?.outOfRange ? ' is-warn' : ''}`}>{value === null || value === '' ? '—' : String(value)}</span>
        {unit && <span className="pf-pass__unit">{unit}</span>}
        {passport?.outOfRange && <span className="pf-pass__warn glyph-setup">вне разумного диапазона</span>}
      </div>
      <dl className="pf-pass__meta">
        {server?.code && <div><dt>код</dt><dd className="mono">{server.code}</dd></div>}
        {server?.block && <div><dt>блок</dt><dd>{server.block}</dd></div>}
        {passport?.owner && <div><dt>владелец</dt><dd>{ownerLabel(passport.owner, scenarioName)}</dd></div>}
        {(server?.source || passport?.sourceText) && <div><dt>источник</dt><dd>{server?.source || passport?.sourceText}</dd></div>}
        {(server?.file_ref || passport?.fileRef) && <div><dt>в коде</dt><dd className="mono">{server?.file_ref || passport?.fileRef}</dd></div>}
        {passport?.range && <div><dt>разумный диапазон</dt><dd className="num">{passport.range[0]}…{passport.range[1]}{passport.outOfRange ? ' · ▲ вне' : ''}</dd></div>}
        {updated && <div><dt>обновлено</dt><dd className="num">{updated}</dd></div>}
      </dl>
      {note && <p className="pf-pass__note">{note}</p>}
      {actions && <div className="pf-pass__actions">{actions}</div>}
    </section>
  )
}
