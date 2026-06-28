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
  // Экономика внешних условий (для устойчивой оптимизации):
  const [sellable, setSellable]   = useState(false)
  const [basePrice, setBasePrice] = useState('')
  const [baseCost, setBaseCost]   = useState('')
  const [demandMax, setDemandMax] = useState('')
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
        sellable: sellable ? '1' : '0',
        base_price: basePrice || '0',
        base_cost: baseCost || '0',
        demand_max: demandMax || '0',
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

      <div className="form__section">Экономика (внешние условия)</div>
      <label className="form__check">
        <input type="checkbox" checked={sellable} onChange={(e) => setSellable(e.target.checked)} />
        Товарная позиция (участвует в портфеле и оптимизации)
      </label>
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">{purchased ? 'Цена закупки, ₽' : 'Себест. закупки, ₽'}</label>
          <input className="form__input" type="number" min="0" value={baseCost}
                 onChange={(e) => setBaseCost(e.target.value)} placeholder="0" />
        </div>
        <div className="form__field">
          <label className="form__label">Ориентир цены, ₽</label>
          <input className="form__input" type="number" min="0" value={basePrice}
                 disabled={!sellable}
                 onChange={(e) => setBasePrice(e.target.value)} placeholder={sellable ? '90000' : '—'} />
        </div>
        <div className="form__field">
          <label className="form__label">Спрос на горизонт</label>
          <input className="form__input" type="number" min="0" value={demandMax}
                 disabled={!sellable}
                 onChange={(e) => setDemandMax(e.target.value)} placeholder={sellable ? '4000' : '—'} />
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
