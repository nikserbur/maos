/**
 * Паспорт параметра (UX-V2 §5.2) в двух видах: карточка одного параметра (значение
 * крупно, единица на шаг меньше, происхождение — 11 px caps) и таблица для панели
 * блока/подблока/формулы: значение · единица · происхождение · диапазон · «изм.».
 */
import { buildHash } from '../../shell/router'
import { fmtValue } from '../../explain/format'
import { PROVENANCE_LABEL, STAGE_LABEL, stateFromProvenance } from './stateMeta'
import { StateGlyph } from './StateGlyph'
import type { ParameterPassport } from './types'

const OWNER_LABEL: Record<ParameterPassport['owner'], string> = { project: 'из НСИ', scenario: 'из сценария', run: 'этот прогон' }

function valueText(p: ParameterPassport): string {
  if (p.value === null || p.value === undefined) return '—'
  if (typeof p.value === 'string') return p.value
  if (p.unit === '%') return fmtValue(p.value, '%')
  return fmtValue(p.value, p.unit === '×' || p.unit === '%/год' || p.unit === '%/мес' || p.unit === 'п.п.' || p.unit === 'дн' || p.unit === 'прогонов' ? '—' : p.unit)
}

function unitText(p: ParameterPassport): string {
  if (p.unit === '—' || p.unit === '%' || typeof p.value === 'string' || p.value === null) return ''
  return p.unit
}

export function ProvenanceBadge({ passport }: { passport: ParameterPassport }) {
  const planned = passport.stage && passport.stage !== 'done'
  return (
    <span className={`mm-prov mm-prov--${planned ? 'planned' : passport.provenance}`} title={passport.note}>
      <StateGlyph state={planned ? 'planned' : stateFromProvenance(passport.provenance)} />
      {planned ? STAGE_LABEL[passport.stage!] : PROVENANCE_LABEL[passport.provenance]}
    </span>
  )
}

export function PassportCard({ passport }: { passport: ParameterPassport }) {
  const range = passport.range ? `${fmtValue(passport.range[0], '—')}…${fmtValue(passport.range[1], '—')}` : null
  return (
    <section className="mm-pass">
      <div className="mm-pass__value-row">
        <span className={`mm-pass__value num${passport.outOfRange ? ' is-warn' : ''}`}>{valueText(passport)}</span>
        {unitText(passport) && <span className="mm-pass__unit">{unitText(passport)}</span>}
        <ProvenanceBadge passport={passport} />
      </div>
      <dl className="mm-pass__meta">
        <div><dt>владелец</dt><dd>{OWNER_LABEL[passport.owner]}</dd></div>
        {range && <div><dt>разумный диапазон</dt><dd className="num">{range}{passport.outOfRange ? ' · ▲ вне' : ''}</dd></div>}
        {passport.estimatedAt && <div><dt>обновлено</dt><dd className="num">{new Date(passport.estimatedAt).toLocaleString('ru-RU')}</dd></div>}
        {passport.id && <div><dt>id</dt><dd className="mono">{passport.id}</dd></div>}
      </dl>
      {passport.note && <p className="mm-pass__note">{passport.note}</p>}
      {passport.screen && (
        <a className="btn" href={buildHash(passport.screen.id, passport.screen.anchor)}>
          {passport.editable ? 'Изменить на экране' : 'Где задаётся'} →
        </a>
      )}
    </section>
  )
}

export function PassportTable({ passports, onPick }: { passports: readonly ParameterPassport[]; onPick?: (id: string) => void }) {
  if (passports.length === 0) return null
  return (
    <table className="mm-ptable">
      <thead>
        <tr><th>Параметр</th><th className="num">Значение</th><th>Происхождение</th><th aria-label="Изменить" /></tr>
      </thead>
      <tbody>
        {passports.map((p) => (
          <tr key={p.id} className={p.outOfRange ? 'is-warn' : undefined}>
            <td>
              {onPick ? <button type="button" className="mm-link" onClick={() => onPick(p.id)}>{p.label}</button> : p.label}
            </td>
            <td className="num">
              {valueText(p)}{unitText(p) && <span className="unit"> {unitText(p)}</span>}
              {p.outOfRange && <span className="mm-ptable__warn" title="вне разумного диапазона"> ▲</span>}
            </td>
            <td><ProvenanceBadge passport={p} /></td>
            <td>
              {p.screen && p.editable && (
                <a className="mm-link" href={buildHash(p.screen.id, p.screen.anchor)} title="Изменить на экране">изм.</a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
