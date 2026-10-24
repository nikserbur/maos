import { useMemo, useState } from 'react'
import { num } from '../../../explain/format'
import { api } from '../../../lib/api'
import { useProducts } from '../useNsi'
import { changedFields, fieldOf, useFormBridge, type NsiFormProps } from './formBridge'
import { FormError, FormNote, NO_CHANGES } from './FormError'

/** Изделие/материал: состав, склад, цены, спрос и рынок. Правка — только изменённые поля. */
export function ProductForm({ onSuccess, edit, bridge }: NsiFormProps) {
  const products = useProducts()
  const r = useMemo(() => edit?.row ?? {}, [edit])
  const sv = fieldOf(r)

  const [code, setCode]           = useState(sv('code'))
  const [name, setName]           = useState(sv('name'))
  const [unit, setUnit]           = useState(sv('unit', 'шт'))
  const [parentId, setParentId]   = useState(sv('parent_id'))
  const [qty, setQty]             = useState(sv('qty_in_parent', '1'))
  const [batch, setBatch]         = useState(sv('batch_size', '1'))
  const [purchased, setPurchased] = useState(sv('purchased') === '1')
  const [stock, setStock]         = useState(sv('stock', '0'))
  // Экономика внешних условий (для устойчивой оптимизации):
  const [sellable, setSellable]   = useState(sv('sellable') === '1')
  const [basePrice, setBasePrice] = useState(sv('base_price'))
  const [baseCost, setBaseCost]   = useState(sv('base_cost'))
  const [demandMax, setDemandMax] = useState(sv('demand_max'))
  // Модель спроса/конкуренции: выше ёмкости рынка продать НЕЛЬЗЯ; цена падает с насыщением.
  const [mktCap, setMktCap]       = useState(sv('market_capacity'))
  const [elast, setElast]         = useState(sv('price_elasticity'))
  const [compSup, setCompSup]     = useState(sv('competitor_supply'))
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<unknown>(null)
  const [note, setNote]           = useState<string | null>(null)

  // Живая модель рынка: доступный объём = ёмкость − конкуренты (нельзя продать больше).
  const nMkt = Number(mktCap) || 0
  const nComp = Number(compSup) || 0
  const nDem = Number(demandMax) || 0
  const availMarket = nMkt > 0 ? Math.max(0, nMkt - nComp) : null
  const compTooBig = nMkt > 0 && nComp > nMkt
  const demandClamped = availMarket !== null && nDem > availMarket

  /** Включение «Товарная позиция»: разумные значения, чтобы оптимизация не получила молчаливый нулевой спрос. */
  const toggleSellable = (on: boolean) => {
    setSellable(on)
    if (on && !demandMax && !mktCap) {
      setDemandMax('1000'); setMktCap('1500'); setElast('0.5'); setCompSup('0')
    }
  }

  const payload = {
    code, name, unit, parent_id: parentId, qty_in_parent: qty, batch_size: batch,
    purchased: purchased ? '1' : '0', stock, sellable: sellable ? '1' : '0',
    base_price: basePrice || '0', base_cost: baseCost || '0', demand_max: demandMax || '0',
    market_capacity: mktCap || '0', price_elasticity: elast || '0.5', competitor_supply: compSup || '0',
  }
  const [initial] = useState(() => ({ ...payload }))
  const dirty = Object.keys(changedFields(payload, initial)).length > 0

  const validate = (): string | null => {
    if (!name.trim()) return 'Укажите наименование'
    if (sellable && (Number(basePrice) || 0) <= 0) return 'Для товарной позиции укажите ориентир цены (> 0) — иначе оптимизация посчитает нулевую выручку'
    if (sellable && nDem <= 0) return 'Для товарной позиции задайте годовой спрос (> 0) — при нуле оптимизация не включит изделие в портфель'
    if (compTooBig) return 'Предложение конкурентов не может превышать ёмкость рынка'
    return null
  }

  const handleSubmit = async () => {
    setNote(null)
    const problem = validate()
    if (problem) { setError(problem); return }
    const body = edit ? changedFields(payload, initial) : payload
    if (edit && Object.keys(body).length === 0) { setNote(NO_CHANGES); return }
    setLoading(true)
    setError(null)
    try {
      if (edit) await api.products.update(edit.id, body)
      else await api.products.create(payload)
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

      <div className="form__section">Идентификация</div>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Код *</span>
          <input className="form__input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="СМ-012" />
        </label>
        <label className="form__field">
          <span className="form__label">Ед. измерения</span>
          <select className="form__select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {['шт', 'т', 'кг', 'м', 'м²', 'м³'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <label className="form__field">
        <span className="form__label">Наименование *</span>
        <input className="form__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Сталь листовая 3 мм" />
      </label>
      <label className="form__check">
        <input type="checkbox" checked={purchased} onChange={(e) => setPurchased(e.target.checked)} />
        Покупается у поставщика (сырьё)
      </label>

      <div className="form__section">Состав и склад</div>
      <label className="form__field">
        <span className="form__label">Входит в изделие</span>
        <select className="form__select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— верхний уровень —</option>
          {products.filter((p) => p.id !== edit?.id).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
      </label>
      <div className="form__row form__row--3">
        <label className="form__field">
          <span className="form__label">Кол-во в составе</span>
          <input className="form__input" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="form__field">
          <span className="form__label">Партия</span>
          <input className="form__input" type="number" min="1" value={batch} onChange={(e) => setBatch(e.target.value)} />
        </label>
        <label className="form__field">
          <span className="form__label">Остаток, {unit}</span>
          <input className="form__input" type="number" min="0" step="0.001" value={stock} onChange={(e) => setStock(e.target.value)} />
        </label>
      </div>

      <div className="form__section">Цены</div>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">{purchased ? 'Цена закупки, ₽' : 'Себестоимость, ₽'}</span>
          <input className="form__input" type="number" min="0" value={baseCost} onChange={(e) => setBaseCost(e.target.value)} placeholder="не задана" />
        </label>
        <label className="form__field">
          <span className="form__label">Цена продажи, ₽ {sellable ? '*' : ''}</span>
          <input className="form__input" type="number" min="0" value={basePrice} disabled={!sellable}
                 onChange={(e) => setBasePrice(e.target.value)} placeholder={sellable ? '90000' : 'только для товаров'} />
        </label>
      </div>

      <div className="form__section">Спрос и рынок</div>
      <label className="form__check">
        <input type="checkbox" checked={sellable} onChange={(e) => toggleSellable(e.target.checked)} />
        Товар — продаётся и участвует в оптимизации портфеля
      </label>
      {sellable && (
        <span className="form__hint form__hint--tight">
          Спрос — <b>годовой</b> объём; планирование пересчитывает его на горизонт, разброс добавляют сценарии.
          Рынок поглотит не более <b>ёмкость − конкуренты</b>.
        </span>
      )}
      <div className="form__row form__row--3">
        <label className="form__field">
          <span className="form__label">Спрос в год, {unit} {sellable ? '*' : ''}</span>
          <input className="form__input" type="number" min="0" value={demandMax} disabled={!sellable}
                 onChange={(e) => setDemandMax(e.target.value)} placeholder={sellable ? '1000' : '—'} />
        </label>
        <label className="form__field">
          <span className="form__label">Ёмкость рынка, {unit}</span>
          <input className="form__input" type="number" min="0" value={mktCap} disabled={!sellable}
                 onChange={(e) => setMktCap(e.target.value)} placeholder={sellable ? '1500' : '—'} />
        </label>
        <label className="form__field">
          <span className="form__label">Конкуренты, {unit}</span>
          <input className="form__input" type="number" min="0" value={compSup} disabled={!sellable} aria-invalid={compTooBig || undefined}
                 aria-describedby={compTooBig ? 'pf-comp-err' : undefined} onChange={(e) => setCompSup(e.target.value)} placeholder="0" />
        </label>
      </div>
      <label className="form__field">
        <span className="form__label">Эластичность цены</span>
        <input className="form__input" type="number" min="0" max="2" step="0.1" value={elast} disabled={!sellable}
               onChange={(e) => setElast(e.target.value)} placeholder="0.5" />
        <span className="form__hint">0 — спрос не зависит от цены; 0,5 — типично; 1 и выше — очень чувствителен.</span>
      </label>
      {sellable && compTooBig && (
        <span className="form__hint form__hint--danger" id="pf-comp-err">
          Конкуренты ({num(nComp, 0)}) продают больше ёмкости рынка ({num(nMkt, 0)}) — так не бывает, поправьте значения.
        </span>
      )}
      {sellable && !compTooBig && availMarket !== null && (
        <span className={demandClamped ? 'form__hint form__hint--warn' : 'form__hint'}>
          Доступный вам рынок: <b>{num(availMarket, 0)} {unit}/год</b> (ёмкость {num(nMkt, 0)} − конкуренты {num(nComp, 0)}).
          {demandClamped && <> Спрос {num(nDem, 0)} выше — продастся не более {num(availMarket, 0)}.</>}
        </span>
      )}
    </div>
  )
}
