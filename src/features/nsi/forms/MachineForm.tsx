import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { useWorkCenterTypes, useOrgUnits } from '../useNsi'
import { changedFields, fieldOf, useFormBridge, type NsiFormProps } from './formBridge'
import { FormError, FormNote, NO_CHANGES } from './FormError'

/** Единица оборудования: имя, тип, цех, статус, паспорт, расписание. Правка — только изменённые поля. */
export function MachineForm({ onSuccess, edit, bridge }: NsiFormProps) {
  const wcTypes = useWorkCenterTypes()
  const orgUnits = useOrgUnits()
  const r = useMemo(() => edit?.row ?? {}, [edit])
  const sv = fieldOf(r)

  const [name, setName]         = useState(sv('name'))
  const [wcTypeId, setWcTypeId] = useState(sv('wc_type_id'))
  const [orgUnit, setOrgUnit]   = useState(sv('org_unit'))
  const [invNo, setInvNo]       = useState(sv('inv_no'))
  const [serial, setSerial]     = useState(sv('serial_no'))
  const [year, setYear]         = useState(sv('year_made'))
  const [schedule, setSchedule] = useState(sv('schedule'))
  const [status, setStatus]     = useState(sv('status', 'active'))
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<unknown>(null)
  const [note, setNote]         = useState<string | null>(null)

  const payload = {
    name, wc_type_id: wcTypeId, org_unit: orgUnit,
    // Цех хранится и по id: переводя станок, обновляем обе колонки, иначе id остался бы прежним.
    org_unit_id: orgUnit === sv('org_unit') ? sv('org_unit_id') : orgUnits.find((o) => o.name === orgUnit)?.id ?? '',
    inv_no: invNo, serial_no: serial, year_made: year, schedule, status,
  }
  const [initial] = useState(() => ({ ...payload }))
  const dirty = Object.keys(changedFields(payload, initial)).length > 0

  const handleSubmit = async () => {
    setNote(null)
    if (!name.trim()) { setError('Укажите наименование'); return }
    if (!wcTypeId) { setError('Выберите тип оборудования — без него станок не участвует в плане'); return }
    const body = edit ? changedFields(payload, initial) : payload
    if (edit && Object.keys(body).length === 0) { setNote(NO_CHANGES); return }
    setLoading(true)
    setError(null)
    try {
      if (edit) await api.machines.update(edit.id, body)
      else await api.machines.create(payload)
      onSuccess(edit ? `Сохранено: ${name}` : `Создано: ${name}`)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useFormBridge(bridge, () => void handleSubmit(), dirty, loading)

  return (
    <div className="form">
      <FormError error={error} />
      <FormNote text={note} />

      <div className="form__section">Основные данные</div>
      <label className="form__field">
        <span className="form__label">Наименование *</span>
        <input className="form__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Токарный станок 16К20" />
      </label>
      <label className="form__field">
        <span className="form__label">Тип оборудования *</span>
        <select className="form__select" value={wcTypeId} onChange={(e) => setWcTypeId(e.target.value)}>
          <option value="">— выберите тип —</option>
          {wcTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {wcTypes.length === 0 && <span className="form__hint">Сначала создайте типы оборудования в реестре.</span>}
      </label>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Цех</span>
          <select className="form__select" value={orgUnit} onChange={(e) => setOrgUnit(e.target.value)}>
            <option value="">— выберите цех —</option>
            {orgUnit && !orgUnits.some((o) => o.name === orgUnit) && <option value={orgUnit}>{orgUnit}</option>}
            {orgUnits.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
          </select>
        </label>
        <label className="form__field">
          <span className="form__label">Статус</span>
          <select className="form__select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">В работе</option>
            <option value="maintenance">На техобслуживании</option>
            <option value="decommissioned">Выведено из эксплуатации</option>
          </select>
        </label>
      </div>

      <label className="form__field">
        <span className="form__label">Расписание работы</span>
        <select className="form__select" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          <option value="">По графику цеха</option>
          <option value="8x5">8 ч × 5 дней</option>
          <option value="12x2">12 ч × 2 смены</option>
          <option value="24x7">Круглосуточно</option>
        </select>
        <span className="form__hint">Собственное расписание станка; иначе действует рабочий календарь цеха.</span>
      </label>

      <div className="form__section">Паспортные данные</div>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Инвентарный №</span>
          <input className="form__input" value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="ОС-00247" />
        </label>
        <label className="form__field">
          <span className="form__label">Серийный №</span>
          <input className="form__input" value={serial} onChange={(e) => setSerial(e.target.value)} />
        </label>
      </div>
      <label className="form__field">
        <span className="form__label">Год выпуска</span>
        <input className="form__input form__input--year" type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2018" />
      </label>
    </div>
  )
}
