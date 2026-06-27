import { useState } from 'react'
import { api } from '../../../lib/api'
import { useWorkCenterTypes } from '../useNsi'

interface Props {
  onSuccess: () => void
}

export function MachineForm({ onSuccess }: Props) {
  const wcTypes = useWorkCenterTypes()

  const [name, setName]         = useState('')
  const [wcTypeId, setWcTypeId] = useState('')
  const [orgUnit, setOrgUnit]   = useState('')
  const [invNo, setInvNo]       = useState('')
  const [serial, setSerial]     = useState('')
  const [year, setYear]         = useState('')
  const [schedule, setSchedule] = useState('')
  const [status, setStatus]     = useState('active')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Укажите наименование'); return }
    setLoading(true)
    setError(null)
    try {
      await api.machines.create({
        name, wc_type_id: wcTypeId, org_unit: orgUnit,
        inv_no: invNo, serial_no: serial, year_made: year,
        schedule, status,
      })
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
          <input
            className="form__input"
            value={orgUnit}
            onChange={(e) => setOrgUnit(e.target.value)}
            placeholder="Сталелитейный цех №1"
          />
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
