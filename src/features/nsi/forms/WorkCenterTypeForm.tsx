import { useState } from 'react'
import { api } from '../../../lib/api'
import { KIND_META, PALETTE } from '../../plant-scene/graph/sceneModel'

interface Props {
  onSuccess: () => void
}

export function WorkCenterTypeForm({ onSuccess }: Props) {
  const [name,  setName]  = useState('')
  const [group, setGroup] = useState('')
  const [kind,  setKind]  = useState('feedstock')
  const [desc,  setDesc]  = useState('')
  const [inter, setInter] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Укажите наименование'); return }
    setLoading(true)
    setError(null)
    try {
      await api.workCenterTypes.create({
        name, group_name: group, kind,
        description: desc,
        interchangeable: inter ? '1' : '0',
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

      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Наименование *</label>
          <input
            className="form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Прокатный стан"
          />
        </div>
        <div className="form__field">
          <label className="form__label">Группа</label>
          <input
            className="form__input"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Прокат"
          />
        </div>
      </div>

      <div className="form__field">
        <label className="form__label">3D-вид на схеме</label>
        <select className="form__select" value={kind} onChange={(e) => setKind(e.target.value)}>
          {PALETTE.map((k) => (
            <option key={k} value={k}>{KIND_META[k].label}</option>
          ))}
        </select>
        <span className="form__hint">
          Все единицы этого типа будут отображаться на 3D-схеме выбранной моделью.
        </span>
      </div>

      <div className="form__field">
        <label className="form__label">Описание</label>
        <textarea
          className="form__textarea"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Назначение и особенности типа оборудования"
        />
      </div>

      <label className="form__check">
        <input type="checkbox" checked={inter} onChange={(e) => setInter(e.target.checked)} />
        Взаимозаменяемость — единицы этого типа равнозначны при планировании
      </label>

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
