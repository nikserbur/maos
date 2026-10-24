import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { countText, num } from '../../../explain/format'
import { InfoTip } from '../../../ui/InfoTip'
import { KIND_META, PALETTE } from '../../plant-scene/graph/sceneModel'
import { isDefaultRouting } from '../registries'
import { typesFromNames } from '../routing/routingModel'
import { useOperations, useRoutings, useWorkCenterTypes } from '../useNsi'
import { changedFields, fieldOf, useFormBridge, type NsiFormProps } from './formBridge'
import { FormError, FormNote, NO_CHANGES } from './FormError'

const OP_FORMS = ['операция', 'операции', 'операций'] as const
const LIST_LIMIT = 8

/** Операции действующих техкарт, которые можно выполнить на типе: различные имена и число вхождений. */
function useLinkedOps(typeId: string | undefined) {
  const operations = useOperations()
  const routings = useRoutings()
  const wcTypes = useWorkCenterTypes()
  return useMemo(() => {
    if (!typeId) return []
    const active = new Set(routings.filter(isDefaultRouting).map((r) => r.id))
    const byName = new Map<string, number>()
    for (const op of operations) {
      if (!op.routing_id || !active.has(op.routing_id)) continue
      const ids = op.wc_type_ids?.length ? op.wc_type_ids : typesFromNames(op.wc_types, wcTypes).map((t) => t.id)
      if (ids.includes(typeId)) byName.set(op.name, (byName.get(op.name) ?? 0) + 1)
    }
    return [...byName.entries()].sort((a, b) => b[1] - a[1])
  }, [typeId, operations, routings, wcTypes])
}

/** Тип оборудования: имя, цех, 3D-вид, ставка, надёжность и ТО; связанные операции — только просмотр. */
export function WorkCenterTypeForm({ onSuccess, edit, bridge }: NsiFormProps) {
  const r = useMemo(() => edit?.row ?? {}, [edit])
  const sv = fieldOf(r)
  const linked = useLinkedOps(edit?.id)

  const [name,  setName]  = useState(sv('name'))
  const [group, setGroup] = useState(sv('group_name'))
  const [kind,  setKind]  = useState(sv('kind', 'feedstock'))
  const [desc,  setDesc]  = useState(sv('description'))
  const [inter, setInter] = useState(sv('interchangeable') === '1')
  const [rate,  setRate]  = useState(sv('hour_rate'))
  // Надёжность/ТО — входы симуляции поломок и планового обслуживания.
  const [mtbf,   setMtbf]   = useState(sv('mtbf_hours'))
  const [repair, setRepair] = useState(sv('repair_hours'))
  const [mtbm,   setMtbm]   = useState(sv('mtbm_hours'))
  const [maint,  setMaint]  = useState(sv('maintenance_hours'))
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<unknown>(null)
  const [note,    setNote]    = useState<string | null>(null)

  const payload = {
    name, group_name: group, kind, description: desc, interchangeable: inter ? '1' : '0', hour_rate: rate,
    mtbf_hours: mtbf, repair_hours: repair, mtbm_hours: mtbm, maintenance_hours: maint,
  }
  const [initial] = useState(() => ({ ...payload }))
  const dirty = Object.keys(changedFields(payload, initial)).length > 0

  const handleSubmit = async () => {
    setNote(null)
    if (!name.trim()) { setError('Укажите наименование'); return }
    const body = edit ? changedFields(payload, initial) : payload
    if (edit && Object.keys(body).length === 0) { setNote(NO_CHANGES); return }
    setLoading(true)
    setError(null)
    try {
      if (edit) await api.workCenterTypes.update(edit.id, body)
      else await api.workCenterTypes.create(payload)
      onSuccess(edit ? `Сохранено: ${name}` : `Создано: ${name}`)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useFormBridge(bridge, () => void handleSubmit(), dirty, loading)

  const linkedTotal = linked.reduce((s, [, n]) => s + n, 0)

  return (
    <div className="form">
      <FormError error={error} />
      <FormNote text={note} />

      <label className="form__field">
        <span className="form__label">Наименование *</span>
        <input className="form__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Токарный станок с ЧПУ" />
      </label>
      <label className="form__field">
        <span className="form__label">Цех / группа</span>
        <input className="form__input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Цех №2 — Механообрабатывающий" />
      </label>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">3D-вид на схеме</span>
          <select className="form__select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {PALETTE.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select>
        </label>
        <label className="form__field">
          <span className="form__label">Ставка, ₽/ч</span>
          <input className="form__input" type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="не задана" />
        </label>
      </div>
      <label className="form__field">
        <span className="form__label">Описание</span>
        <textarea className="form__textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Назначение и особенности типа" />
      </label>
      <label className="form__check">
        <input type="checkbox" checked={inter} onChange={(e) => setInter(e.target.checked)} />
        Единицы этого типа равнозначны при планировании
      </label>

      <div className="form__section nsi-form-head">
        Надёжность и ТО
        <InfoTip id="plan.maintenance" label="Как надёжность и ТО влияют на план" />
      </div>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Наработка на отказ, ч</span>
          <input className="form__input" type="number" min="0" value={mtbf} onChange={(e) => setMtbf(e.target.value)} placeholder="350" />
        </label>
        <label className="form__field">
          <span className="form__label">Средний ремонт, ч</span>
          <input className="form__input" type="number" min="0" value={repair} onChange={(e) => setRepair(e.target.value)} placeholder="6" />
        </label>
      </div>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">ТО каждые, ч</span>
          <input className="form__input" type="number" min="0" value={mtbm} onChange={(e) => setMtbm(e.target.value)} placeholder="160" />
        </label>
        <label className="form__field">
          <span className="form__label">Длительность ТО, ч</span>
          <input className="form__input" type="number" min="0" value={maint} onChange={(e) => setMaint(e.target.value)} placeholder="4" />
        </label>
      </div>

      {edit && (
        <section className="nsi-linked" aria-labelledby="wct-linked">
          <div className="form__section" id="wct-linked">Операции на этом типе</div>
          {linked.length === 0 ? (
            <p className="form__hint">Ни одна операция действующих техкарт не выполняется на этом типе — станки простаивают в плане.</p>
          ) : (
            <>
              <p className="form__hint">{countText(linkedTotal, OP_FORMS)} в действующих техкартах · {num(linked.length, 0)} различных. Связи меняются в реестре «Операции».</p>
              <ul className="nsi-linked__list">
                {linked.slice(0, LIST_LIMIT).map(([opName, n]) => (
                  <li key={opName}><span className="nsi-linked__name" title={opName}>{opName}</span><span className="nsi-linked__n num">×{num(n, 0)}</span></li>
                ))}
              </ul>
              {linked.length > LIST_LIMIT && <p className="form__hint">и ещё {num(linked.length - LIST_LIMIT, 0)} — полный список в реестре «Операции».</p>}
            </>
          )}
        </section>
      )}
    </div>
  )
}
