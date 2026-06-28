import { useState } from 'react'
import { api } from '../../../lib/api'
import { useOrgUnits } from '../useNsi'
import type { EditCtx } from '../CreateDialog'

interface Props {
  onSuccess: () => void
  edit?: EditCtx
}

export function WorkerForm({ onSuccess, edit }: Props) {
  const orgUnits = useOrgUnits()
  const r = edit?.row ?? {}
  const sv = (k: string, d = '') => (r[k] == null ? d : String(r[k]))
  const [tabNo, setTabNo]     = useState(sv('tab_no'))
  const [last, setLast]       = useState(sv('last_name'))
  const [first, setFirst]     = useState(sv('first_name'))
  const [middle, setMiddle]   = useState(sv('middle_name'))
  const [orgUnit, setOrgUnit] = useState(sv('org_unit'))
  const [position, setPos]    = useState(sv('position'))
  const [grade, setGrade]     = useState(sv('grade', '3'))
  const [skills, setSkills]   = useState(sv('skills'))
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!last.trim() || !first.trim()) { setError('Укажите фамилию и имя'); return }
    if (!tabNo.trim()) { setError('Укажите табельный номер'); return }
    setLoading(true)
    setError(null)
    try {
      const payload = {
        tab_no: tabNo, last_name: last, first_name: first,
        middle_name: middle, org_unit: orgUnit, position,
        grade, skills,
      }
      if (edit) await api.workers.update(edit.id, payload)
      else await api.workers.create(payload)
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

      <div className="form__section">Личные данные</div>
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">Фамилия *</label>
          <input className="form__input" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Иванов" />
        </div>
        <div className="form__field">
          <label className="form__label">Имя *</label>
          <input className="form__input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Иван" />
        </div>
        <div className="form__field">
          <label className="form__label">Отчество</label>
          <input className="form__input" value={middle} onChange={(e) => setMiddle(e.target.value)} placeholder="Иванович" />
        </div>
      </div>

      <div className="form__section">Должность и место работы</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Табельный № *</label>
          <input className="form__input" value={tabNo} onChange={(e) => setTabNo(e.target.value)} placeholder="ТВ-01042" />
        </div>
        <div className="form__field">
          <label className="form__label">Разряд</label>
          <select className="form__select" value={grade} onChange={(e) => setGrade(e.target.value)}>
            {[1,2,3,4,5,6].map((g) => <option key={g} value={g}>{g} разряд</option>)}
          </select>
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
          <label className="form__label">Должность</label>
          <input className="form__input" value={position} onChange={(e) => setPos(e.target.value)} placeholder="Оператор ЧПУ" />
        </div>
      </div>

      <div className="form__field">
        <label className="form__label">Компетенции / навыки</label>
        <textarea
          className="form__textarea"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="Токарные работы, ЧПУ Fanuc, Контроль ОТК…"
        />
        <span className="form__hint">
          Рабочий — ресурс плана наравне с оборудованием («оборудование + рабочий»).
        </span>
      </div>

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
