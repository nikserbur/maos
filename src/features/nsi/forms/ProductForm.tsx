import { useState } from 'react'
import { num } from '../../../explain/format'
import { api } from '../../../lib/api'
import { useProducts } from '../useNsi'
import type { EditCtx } from '../CreateDialog'

interface Props {
  onSuccess: () => void
  edit?: EditCtx
}

export function ProductForm({ onSuccess, edit }: Props) {
  const products = useProducts()
  const r = edit?.row ?? {}
  const sv = (k: string, d = '') => (r[k] == null ? d : String(r[k]))

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
  const [error, setError]         = useState<string | null>(null)

  // Живая модель рынка: доступный объём = ёмкость − конкуренты (нельзя продать больше).
  const nMkt = Number(mktCap) || 0
  const nComp = Number(compSup) || 0
  const nDem = Number(demandMax) || 0
  const availMarket = nMkt > 0 ? Math.max(0, nMkt - nComp) : null
  const compTooBig = nMkt > 0 && nComp > nMkt
  const demandClamped = availMarket !== null && nDem > availMarket

  /** Включение «Товарная позиция»: заполняем разумные значения, чтобы оптимизация
   *  не получила молчаливый нулевой спрос (портфель из нулей без объяснений). */
  const toggleSellable = (on: boolean) => {
    setSellable(on)
    if (on && !demandMax && !mktCap) {
      setDemandMax('1000'); setMktCap('1500'); setElast('0.5'); setCompSup('0')
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Укажите наименование'); return }
    if (sellable && (Number(basePrice) || 0) <= 0) {
      setError('Для товарной позиции укажите ориентир цены (> 0) — иначе оптимизация посчитает нулевую выручку'); return
    }
    if (sellable && nDem <= 0) {
      setError('Для товарной позиции задайте годовой спрос (> 0) — при нуле оптимизация не включит изделие в портфель'); return
    }
    if (compTooBig) {
      setError('Предложение конкурентов не может превышать ёмкость рынка'); return
    }
    setLoading(true)
    setError(null)
    try {
      const payload = {
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
        market_capacity: mktCap || '0',
        price_elasticity: elast || '0.5',
        competitor_supply: compSup || '0',
      }
      if (edit) await api.products.update(edit.id, payload)
      else await api.products.create(payload)
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

      <div className="form__section">Ценообразование</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">{purchased ? 'Цена закупки, ₽' : 'Себестоимость, ₽'}</label>
          <input className="form__input" type="number" min="0" value={baseCost}
                 onChange={(e) => setBaseCost(e.target.value)} placeholder="0" />
        </div>
        <div className="form__field">
          <label className="form__label">Ориентир цены сбыта, ₽ {sellable ? '*' : ''}</label>
          <input className="form__input" type="number" min="0" value={basePrice}
                 disabled={!sellable}
                 onChange={(e) => setBasePrice(e.target.value)}
                 placeholder={sellable ? '90000' : 'только для товарных позиций'} />
        </div>
      </div>

      <div className="form__section">Спрос и рынок</div>
      <label className="form__check">
        <input type="checkbox" checked={sellable} onChange={(e) => toggleSellable(e.target.checked)} />
        Товарная позиция — продаётся на рынке и участвует в оптимизации портфеля
      </label>
      {sellable && (
        <span className="form__hint" style={{ marginTop: 2 }}>
          Спрос задаётся <b>годовым</b> объёмом — планирование само пересчитывает его на
          горизонт (горизонт 6 мес → половина годового), а разброс спроса добавляют
          сценарии (Монте-Карло). Рынок в целом поглотит не более <b>ёмкость − конкуренты</b>;
          чем ближе выпуск к насыщению, тем ниже цена сбыта (эластичность). Конкретные заказы
          для расписания (Стадия 1) задаются отдельно: экран «План» → «Производственная программа».
        </span>
      )}
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">Спрос в год, {unit} {sellable ? '*' : ''}</label>
          <input className="form__input" type="number" min="0" value={demandMax}
                 disabled={!sellable}
                 onChange={(e) => setDemandMax(e.target.value)} placeholder={sellable ? '1000' : '—'} />
        </div>
        <div className="form__field">
          <label className="form__label">Ёмкость рынка в год, {unit}</label>
          <input className="form__input" type="number" min="0" value={mktCap} disabled={!sellable}
                 onChange={(e) => setMktCap(e.target.value)} placeholder={sellable ? '1500' : '—'} />
        </div>
        <div className="form__field">
          <label className="form__label">Конкуренты в год, {unit}</label>
          <input className="form__input" type="number" min="0" value={compSup} disabled={!sellable}
                 onChange={(e) => setCompSup(e.target.value)} placeholder="0"
                 style={compTooBig ? { borderColor: 'var(--intent-danger)' } : undefined} />
        </div>
      </div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Эластичность цены (0 — спрос не зависит от цены; 0.5 — типично; 1+ — очень чувствителен)</label>
          <input className="form__input" type="number" min="0" max="2" step="0.1" value={elast} disabled={!sellable}
                 onChange={(e) => setElast(e.target.value)} placeholder="0.5" />
        </div>
      </div>
      {sellable && compTooBig && (
        <span className="form__hint" style={{ color: 'var(--intent-danger)' }}>
          Конкуренты ({nComp}) продают больше ёмкости рынка ({nMkt}) — так не бывает, поправьте значения.
        </span>
      )}
      {sellable && !compTooBig && availMarket !== null && (
        <span className="form__hint" style={demandClamped ? { color: 'var(--intent-warning)' } : undefined}>
          Доступный вам рынок: <b>{num(availMarket, 0)} {unit}/год</b> (ёмкость {num(nMkt, 0)} − конкуренты {num(nComp, 0)}).
          {demandClamped && <> Спрос {num(nDem, 0)} выше — фактически продастся не более {num(availMarket, 0)}.</>}
        </span>
      )}

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
