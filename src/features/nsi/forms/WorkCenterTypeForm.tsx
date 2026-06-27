import { useState } from 'react'
import { api } from '../../../lib/api'
import { KIND_META, PALETTE } from '../../plant-scene/graph/sceneModel'
import { useOperations } from '../useNsi'

interface Props {
  onSuccess: () => void
}

export function WorkCenterTypeForm({ onSuccess }: Props) {
  const operations = useOperations()
  // только шаблоны НСИ (без привязки к техкарте) — кандидаты для типа
  const opTemplates = operations.filter((o) => !o.routing_id)

  const [name,  setName]  = useState('')
  const [group, setGroup] = useState('')
  const [kind,  setKind]  = useState('feedstock')
  const [desc,  setDesc]  = useState('')
  const [inter, setInter] = useState(false)
  const [opIds, setOpIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const toggleOp = (id: string) =>
    setOpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

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
      // Связываем выбранные операции с этим типом: добавляем имя типа в op.wc_types.
      await Promise.all(
        opIds.map((id) => {
          const op = opTemplates.find((o) => o.id === id)
          if (!op) return Promise.resolve()
          const names = op.wc_types.split(',').map((s) => s.trim()).filter(Boolean)
          if (names.includes(name.trim())) return Promise.resolve()
          return api.operations.update(id, { wc_types: [...names, name.trim()].join(', ') })
        }),
      )
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

      <div className="form__field">
        <label className="form__label">Доступные операции для этого типа</label>
        {opTemplates.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
            {opTemplates.map((op) => (
              <label key={op.id} className="form__check" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={opIds.includes(op.id)}
                  onChange={() => toggleOp(op.id)}
                />
                {op.name}
              </label>
            ))}
          </div>
        ) : (
          <span className="form__hint">Нет операций-шаблонов в реестре — создайте операции.</span>
        )}
        <span className="form__hint">
          Выбранные операции смогут выполняться на оборудовании этого типа.
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
