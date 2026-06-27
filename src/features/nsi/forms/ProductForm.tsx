import { useState } from 'react'
import { api } from '../../../lib/api'
import { useProducts } from '../useNsi'

interface Props {
  onSuccess: () => void
}

export function ProductForm({ onSuccess }: Props) {
  const products = useProducts()

  const [code, setCode]           = useState('')
  const [name, setName]           = useState('')
  const [unit, setUnit]           = useState('шт')
  const [parentId, setParentId]   = useState('')
  const [qty, setQty]             = useState('1')
  const [batch, setBatch]         = useState('1')
  const [purchased, setPurchased] = useState(false)
  const [stock, setStock]         = useState('0')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Укажите наименование'); return }
    setLoading(true)
    setError(null)
    try {
      await api.products.create({
        code, name, unit,
        parent_id: parentId,
        qty_in_parent: qty,
        batch_size: batch,
        purchased: purchased ? '1' : '0',
        stock,
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

      <div className="form__section">Идентификация</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Артикул / Код *</label>
          <input className="form__input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="STL-001" />
        </div>
        <div className="form__field">
          <label className="form__label">Ед. измерения</label>
          <select className="form__select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="шт">шт</option>
            <option value="т">т</option>
            <option value="кг">кг</option>
            <option value="м">м</option>
            <option value="м²">м²</option>
            <option value="м³">м³</option>
          </select>
        </div>
      </div>
      <div className="form__field">
        <label className="form__label">Наименование *</label>
        <input className="form__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Сталь листовая 3мм" />
      </div>

      <div className="form__section">Состав (BOM)</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Входит в изделие</label>
          <select className="form__select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— верхний уровень —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="form__field">
          <label className="form__label">Кол-во в составе</label>
          <input className="form__input" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
      </div>

      <div className="form__section">Производство и склад</div>
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">Размер партии</label>
          <input className="form__input" type="number" min="1" value={batch} onChange={(e) => setBatch(e.target.value)} />
        </div>
        <div className="form__field">
          <label className="form__label">Остаток на складе</label>
          <input className="form__input" type="number" min="0" step="0.001" value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
        <div className="form__field" style={{ justifyContent: 'flex-end', paddingBottom: 4 }}>
          <label className="form__check">
            <input type="checkbox" checked={purchased} onChange={(e) => setPurchased(e.target.checked)} />
            Покупное
          </label>
        </div>
      </div>

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
