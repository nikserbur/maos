/**
 * Шаг 4 «Ограничения» [3] (UX-V2 §4.2): мощности (станки × календарь — переключатель здесь, с фондом
 * в часах), труд (`LaborWarning`), MRP под программу («материально осуществимо / дефицит N позиций —
 * план будет построен с задержкой запуска»), карточка «Финансовые ограничения» (fin_params + паспорта).
 * Календарь — переопределение прогона; пины — на шаге «Результат».
 */
import { useEffect, useState } from 'react'
import { api, type MrpResult } from '../../../../lib/api'
import { num } from '../../../../explain/format'
import { ParamField } from '../../../../ui/ParamField'
import { LaborWarning } from '../../../nsi/LaborWarning'
import { useRefs } from '../../../method-map/useMethodMapState'
import { MrpTable } from '../../MrpTable'
import { Chip } from '../../ui'
import type { WizardData } from '../useWizardData'
import { FinancialCard } from './FinancialCard'
import { effectiveFields, isChanged, useWizard, wizardActions } from '../wizardStore'

export function ConstraintsStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const refs = useRefs()
  const f = effectiveFields(w)
  const [mrp, setMrp] = useState<MrpResult | null>(null)
  const [mrpOpen, setMrpOpen] = useState(false)
  const cal = data.calendar

  // MRP под текущую программу (time-phased по срокам).
  useEffect(() => {
    if (data.program.length === 0) { setMrp(null); return }
    let alive = true
    api.mrp.run(data.program.map((o) => ({ product_id: o.product_id, qty: o.qty, due_hours: o.due_hours })))
      .then((r) => { if (alive) setMrp(r) }).catch(() => { if (alive) setMrp(null) })
    return () => { alive = false }
  }, [data.program])

  const shortages = mrp?.materials.filter((m) => m.purchased && m.shortage).length ?? 0
  const hoursPerDay = cal ? (cal.end_hour ?? 0) - (cal.start_hour ?? 0) : 24
  const daysPerWeek = cal?.days?.length ?? 7

  return (
    <div className="wz-step">
      <div className="wz-fields">
        <ParamField label="Мощности" value={`${refs.counts.machines} станков · ${refs.counts.wcTypes} типов РЦ`} provenance="manual" owner="из НСИ" readOnly
          note={<>Коэффициент готовности типа РЦ efficiency 0,85 [НОРМ]; хвостовая поправка мощности Стадии 2 ≈ 1,076 [К] (R4). <a className="pf-link" href="#/nsi/machines">станки →</a></>} />
        <ParamField label="Календарь смен" value={f.useCalendar ? 'учитывать' : 'не учитывать (24×7)'} provenance={isChanged(w, 'useCalendar') ? 'manual' : 'default'} status="НОРМ"
          owner={isChanged(w, 'useCalendar') ? 'этот прогон' : w.owners.useCalendar ?? 'календарь проекта'} changed={isChanged(w, 'useCalendar')} onRevert={() => wizardActions.revert('useCalendar')}
          effect={cal ? <>{cal.name ?? 'календарь'}: {hoursPerDay} ч × {daysPerWeek} дн ≈ <b className="num">{num(hoursPerDay * daysPerWeek, 0)} ч/нед</b> на станок</> : undefined}>
          <label className="form__check wz-check">
            <input type="checkbox" checked={f.useCalendar} onChange={(e) => wizardActions.setOverride('useCalendar', e.target.checked)} />
            учитывать рабочее время смен (фонд — в результате)
          </label>
        </ParamField>
      </div>

      <section className="wz-card" aria-label="Труд">
        <p className="wz-card__t">Труд · операторы и допуски</p>
        <LaborWarning />
        <p className="pl-note">Параллельно работает не больше станков, чем операторов с допуском; план строится с этим ограничением.</p>
      </section>

      <section className="wz-card" aria-label="MRP">
        <div className="wz-card__head">
          <p className="wz-card__t">
            MRP под программу ·{' '}
            {mrp ? (mrp.feasible ? <Chip tone="good">материально осуществимо</Chip> : <Chip tone="bad">дефицит {shortages} позиций — план будет построен с задержкой запуска</Chip>) : <Chip>нет программы</Chip>}
          </p>
          {mrp && <button type="button" className="btn btn--sm" onClick={() => setMrpOpen((v) => !v)}>{mrpOpen ? 'Свернуть' : 'Показать материалы'}</button>}
        </div>
        {mrp && mrpOpen && <MrpTable mrp={mrp} />}
        {mrp && !mrpOpen && <p className="pl-note">{mrp.materials.filter((m) => m.purchased).length} закупных позиций · {mrp.materials.filter((m) => !m.purchased).length} полуфабрикатов внутри · нетто с учётом страхового запаса; дефицит → заказ закупки (срок поставки lead_time [НОРМ]).</p>}
      </section>

      <FinancialCard open={w.preset === 'money' || isChanged(w, 'lMin') || isChanged(w, 'beta')} />
    </div>
  )
}
