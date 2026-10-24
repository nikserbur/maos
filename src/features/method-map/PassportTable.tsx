/**
 * Паспорт параметра на карте (UX-V2 §5.2) — на общих компонентах (X2 P-124): карточка одного параметра —
 * ui/PassportCard, бейдж происхождения — ui/ProvenanceBadge (глиф и слово единого словаря). Здесь только
 * подготовка значения: имена целей и правил — из explain/labels, числа — через explain/format (одна
 * точность на меру: часы — целые, как в карточке блока), и компактная таблица для панели блока.
 */
import { buildHash } from '../../shell/router'
import { NBSP, fmtValue, hours, joinRange, num, pct } from '../../explain/format'
import { objectiveLabel, ruleLabel } from '../../explain/labels'
import { PassportCard as SharedPassportCard } from '../../ui/PassportCard'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import type { ParameterPassport } from './types'

/** Значение параметра для людей: имена вместо id, единица — через общий форматтер. */
export function valueText(p: ParameterPassport): string {
  if (p.value === null || p.value === undefined) return '—'
  if (typeof p.value === 'string') {
    if (p.id === 'scenario.objective') return objectiveLabel(p.value)
    if (p.id === 'plan.rule') return ruleLabel(p.value)
    return p.value
  }
  switch (p.unit) {
    case '%': return pct(p.value, p.id === 'scenario.alpha' ? 0 : 1)
    case 'ч': return hours(p.value, 0)
    case '×': return `×${num(p.value)}`
    case '%/год': case '%/мес': case 'п.п.': case 'дн': case 'прогонов': return `${num(p.value)}${NBSP}${p.unit}`
    default: return fmtValue(p.value, p.unit)
  }
}

function rangeOf(p: ParameterPassport): string | null {
  if (!p.range) return null
  const one = (v: number) => valueText({ ...p, value: v })
  return joinRange(one(p.range[0]), one(p.range[1]))
}

/** Карточка параметра: общая ui/PassportCard с уже отформатированным значением и диапазоном в примечании. */
export function PassportCard({ passport }: { passport: ParameterPassport }) {
  const range = rangeOf(passport)
  const note = [passport.note, range ? `Разумный диапазон: ${range}.` : null].filter(Boolean).join(' ') || undefined
  const view: ParameterPassport = { ...passport, value: valueText(passport), unit: '—', range: undefined, note }
  return (
    <SharedPassportCard
      passport={view}
      actions={passport.screen ? (
        <a className="btn" href={buildHash(passport.screen.id, passport.screen.anchor)}>
          {passport.editable ? 'Изменить на экране' : 'Где задаётся'} →
        </a>
      ) : undefined}
    />
  )
}

export function PassportTable({ passports, onPick }: { passports: readonly ParameterPassport[]; onPick?: (id: string) => void }) {
  if (passports.length === 0) return null
  return (
    <table className="mm-ptable">
      <thead>
        <tr><th scope="col">Параметр</th><th scope="col" className="num">Значение</th><th scope="col">Происхождение</th><th scope="col"><span className="mm-sr">Изменить</span></th></tr>
      </thead>
      <tbody>
        {passports.map((p) => (
          <tr key={p.id}>
            <td>
              {onPick ? <button type="button" className="mm-link" onClick={() => onPick(p.id)}>{p.label}</button> : p.label}
            </td>
            <td className="num">
              {valueText(p)}
              {p.outOfRange && <span className="mm-ptable__warn" title="вне разумного диапазона"> ▲ вне</span>}
            </td>
            <td><ProvenanceBadge provenance={p.provenance} status={p.status} deprecated={p.deprecated} stage={p.stage} title={p.note} /></td>
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
