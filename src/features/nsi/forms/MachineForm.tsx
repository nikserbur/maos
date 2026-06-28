import { useState } from 'react'
import { api } from '../../../lib/api'
import { useWorkCenterTypes, useOrgUnits } from '../useNsi'
import type { EditCtx } from '../CreateDialog'

interface Props {
  onSuccess: () => void
  edit?: EditCtx
}

export function MachineForm({ onSuccess, edit }: Props) {
  const wcTypes = useWorkCenterTypes()
  const orgUnits = useOrgUnits()
  const r = edit?.row ?? {}
  const sv = (k: string, d = '') => (r[k] == null ? d : String(r[k]))

  const [name, setName]         = useState(sv('name'))
  const [wcTypeId, setWcTypeId] = useState(sv('wc_type_id'))
  const [orgUnit, setOrgUnit]   = useState(sv('org_unit'))
  const [invNo, setInvNo]       = useState(sv('inv_no'))
  const [serial, setSerial]     = useState(sv('serial_no'))
  const [year, setYear]         = useState(sv('year_made'))
  const [schedule, setSchedule] = useState(sv('schedule'))
  const [status, setStatus]     = useState(sv('status', 'active'))
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Укажите наименование'); return }
    setLoading(true)
    setError(null)
    try {
      const payload = {
        name, wc_type_id: wcTypeId, org_unit: orgUnit,
        inv_no: invNo, serial_no: serial, year_made: year,
        schedule, status,
      }
      if (edit) await api.machines.update(edit.id, payload)
      else await api.machines.create(payload)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="form">
      {error && <div className="form__error">{error}</div>}

      <div className="form__section">Основные данные</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Наименование *</label>
          <input
            className="form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Токарный станок 16К20"
          />
        </div>
        <div className="form__field">
          <label className="form__label">Тип оборудования *</label>
          <select
            className="form__select"
            value={wcTypeId}
            onChange={(e) => setWcTypeId(e.target.value)}
          >
            <option value="">— выберите тип —</option>
            {wcTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {wcTypes.length === 0 && (
            <span className="form__hint">Сначала создайте типы оборудования в реестре.</span>
          )}
        </div>
      </div>

      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Подразделение / Цех</label>
          <select className="form__select" value={orgUnit} onChange={(e) => setOrgUnit(e.target.value)}>
            <option value="">— выберите подразделение —</option>
            {orgUnits.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
          </select>
        </div>
        <div className="form__field">
          <label className="form__label">Статус</label>
          <select className="form__select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">В работе</option>
            <option value="maintenance">Техобслуживание</option>
            <option value="decommissioned">Выведено из эксплуатации</option>
          </select>
        </div>
      </div>

      <div className="form__section">Паспортные данные</div>
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">Инвентарный №</label>
          <input className="form__input" value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="ОС-00247" />
        </div>
        <div className="form__field">
          <label className="form__label">Серийный №</label>
          <input className="form__input" value={serial} onChange={(e) => setSerial(e.target.value)} />
        </div>
        <div className="form__field">
          <label className="form__label">Год выпуска</label>
          <input className="form__input" type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2018" />
        </div>
      </div>

      <div className="form__field">
        <label className="form__label">Расписание работы</label>
        <select className="form__select" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          <option value="">— не задано —</option>
          <option value="8x5">8ч × 5 дней</option>
          <option value="12x2">12ч × 2 смены</option>
          <option value="24x7">Круглосуточно</option>
        </select>
        <span className="form__hint">Расписание определяет доступные окна в производственном плане.</span>
      </div>

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
