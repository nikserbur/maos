/**
 * Инспектор операции (правая панель конструктора): название · тип РЦ (бейдж НСИ) · время ·
 * входы (I) из реестра изделий · выход (O) · управление (C) · механизм (M) · порядок · удалить;
 * ниже — «Добавить операцию»: из реестра одним действием или «создать новую» (раскрывается).
 * Ни одной primary-кнопки — единственная primary экрана «Сохранить» в шапке.
 */
import { useState, type Dispatch, type KeyboardEvent } from 'react'
import { api, type Operation, type Product, type WorkCenterType } from '../../../lib/api'
import { Icon } from '../../../shell/icons'
import { fmtValue } from '../../../explain/format'
import type { InputMaterial, RoutingAction, RoutingOp } from './routingModel'

interface InspectorProps {
  selected: RoutingOp | null
  selectedIndex: number
  count: number
  dispatch: Dispatch<RoutingAction>
  products: Product[]
  registryOps: Operation[]
  wcTypes: WorkCenterType[]
}

export function RoutingInspector({ selected, selectedIndex, count, dispatch, products, registryOps, wcTypes }: InspectorProps) {
  return (
    <aside className="rt-inspector" aria-label="Инспектор операции">
      {selected ? (
        <OpEditor op={selected} index={selectedIndex} count={count} dispatch={dispatch} products={products} wcTypes={wcTypes} />
      ) : (
        <div className="rt-inspector__empty">
          <p className="text-caps rt-inspector__t">Инспектор операции</p>
          <p className="rt-muted">Выберите операцию на канвасе или в полосе маршрута внизу — здесь редактируются её тип РЦ, время и связи IDEF0.</p>
        </div>
      )}
      <AddOperation dispatch={dispatch} registryOps={registryOps} wcTypes={wcTypes} />
    </aside>
  )
}

function OpEditor({ op, index, count, dispatch, products, wcTypes }: {
  op: RoutingOp; index: number; count: number; dispatch: Dispatch<RoutingAction>; products: Product[]; wcTypes: WorkCenterType[]
}) {
  const known = wcTypes.some((t) => t.name === op.wcType)
  const patch = (p: Partial<Pick<RoutingOp, 'title' | 'opType' | 'wcType' | 'timeMin'>>) => dispatch({ type: 'UPDATE_OP', id: op.id, patch: p })
  return (
    <section className="rt-section">
      <header className="rt-section__head">
        <span className="text-caps rt-inspector__t">Операция A{index + 1}</span>
        <span className="rt-section__tools">
          <button type="button" className="btn btn--ghost btn--icon" title="Раньше" aria-label="Переместить раньше" disabled={index <= 0}
            onClick={() => dispatch({ type: 'MOVE', id: op.id, delta: -1 })}>←</button>
          <button type="button" className="btn btn--ghost btn--icon" title="Позже" aria-label="Переместить позже" disabled={index >= count - 1}
            onClick={() => dispatch({ type: 'MOVE', id: op.id, delta: 1 })}>→</button>
        </span>
      </header>

      <label className="form__field">
        <span className="form__label">Название</span>
        <input className="form__input" value={op.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>

      <label className="form__field">
        <span className="form__label">Тип рабочего центра {known ? <span className="rt-badge" title="Тип из реестра НСИ">● НСИ</span> : op.wcType ? <span className="rt-badge is-warn" title="Такого типа нет в реестре">▲ нет в НСИ</span> : null}</span>
        <select className="form__select" value={op.wcType} aria-invalid={!op.wcType || undefined} onChange={(e) => patch({ wcType: e.target.value })}>
          <option value="">— не задано —</option>
          {!known && op.wcType && <option value={op.wcType}>{op.wcType}</option>}
          {wcTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
        {!op.wcType && <span className="form__hint">Без типа РЦ планировщику не на чем выполнять операцию.</span>}
      </label>

      <label className="form__field rt-field--time">
        <span className="form__label">Время, мин</span>
        <input className="form__input" type="number" min="1" value={op.timeMin} onChange={(e) => patch({ timeMin: Number(e.target.value) })} />
      </label>

      <InputMaterialPicker items={op.inputs} products={products}
        onAdd={(m) => dispatch({ type: 'ADD_INPUT', id: op.id, input: m })}
        onRemove={(i) => dispatch({ type: 'DEL_INPUT', id: op.id, index: i })} />
      <TagList label="O — Выход операции" hint="Полуфабрикат, изделие…" items={op.outputs}
        onAdd={(v) => dispatch({ type: 'ADD_TAG', id: op.id, field: 'outputs', value: v })}
        onRemove={(i) => dispatch({ type: 'DEL_TAG', id: op.id, field: 'outputs', index: i })} />
      <TagList label="C — Управление" hint="ГОСТ, НТД, регламент…" items={op.controls}
        onAdd={(v) => dispatch({ type: 'ADD_TAG', id: op.id, field: 'controls', value: v })}
        onRemove={(i) => dispatch({ type: 'DEL_TAG', id: op.id, field: 'controls', index: i })} />
      <TagList label="M — Механизм" hint="Станок, разряд рабочего…" items={op.mechanisms}
        onAdd={(v) => dispatch({ type: 'ADD_TAG', id: op.id, field: 'mechanisms', value: v })}
        onRemove={(i) => dispatch({ type: 'DEL_TAG', id: op.id, field: 'mechanisms', index: i })} />

      <button type="button" className="btn btn--danger rt-delete" onClick={() => dispatch({ type: 'DELETE_OP', id: op.id })}>
        Удалить операцию
      </button>
    </section>
  )
}

/** Добавление операции: из реестра — одним «+»; новая — раскрывающаяся форма с опцией сохранения в НСИ. */
function AddOperation({ dispatch, registryOps, wcTypes }: { dispatch: Dispatch<RoutingAction>; registryOps: Operation[]; wcTypes: WorkCenterType[] }) {
  const [pickedOpId, setPickedOpId] = useState('')
  const [showCustom, setShowCustom] = useState(registryOps.length === 0)
  const [title, setTitle] = useState('')
  const [wc, setWc] = useState('')
  const [time, setTime] = useState('30')
  const [saveToNsi, setSaveToNsi] = useState(false)
  const [saving, setSaving] = useState(false)

  const addFromRegistry = () => {
    const op = registryOps.find((o) => o.id === pickedOpId)
    if (!op) return
    dispatch({ type: 'ADD_OP', title: op.name, opType: op.op_type, wcType: op.wc_types, timeMin: Number(op.t_norm) || 30 })
    setPickedOpId('')
  }

  const addCustom = async () => {
    if (!title.trim()) return
    const wcName = wcTypes.find((t) => t.id === wc)?.name ?? ''
    if (saveToNsi) {
      setSaving(true)
      try {
        await api.operations.create({ name: title.trim(), wc_types: wcName, t_norm: time, t_opt: time, t_pess: time })
      } catch { /* не фатально — операция всё равно попадает в маршрут */ } finally { setSaving(false) }
    }
    dispatch({ type: 'ADD_OP', title: title.trim(), opType: '', wcType: wcName, timeMin: Number(time) || 30 })
    setTitle(''); setTime('30'); setWc('')
  }

  return (
    <section className="rt-section rt-section--add">
      <p className="text-caps rt-inspector__t">Добавить операцию</p>
      {registryOps.length > 0 && (
        <div className="rt-row">
          <select className="form__select" value={pickedOpId} aria-label="Операция из реестра" onChange={(e) => setPickedOpId(e.target.value)}>
            <option value="">— из реестра —</option>
            {registryOps.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
          </select>
          <button type="button" className="btn btn--icon" aria-label="Добавить из реестра" disabled={!pickedOpId} onClick={addFromRegistry}><Icon name="plus" size={14} /></button>
        </div>
      )}
      {registryOps.length > 0 && (
        <button type="button" className="rt-link" aria-expanded={showCustom} onClick={() => setShowCustom((v) => !v)}>
          {showCustom ? '▾' : '▸'} или создать новую
        </button>
      )}
      {showCustom && (
        <div className="rt-custom">
          <input className="form__input" value={title} placeholder="Название операции" aria-label="Название новой операции"
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCustom() }} />
          <div className="rt-row">
            <select className="form__select" value={wc} aria-label="Тип оборудования" onChange={(e) => setWc(e.target.value)}>
              <option value="">— тип оборудования —</option>
              {wcTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input className="form__input rt-custom__time" type="number" min="1" value={time} aria-label="Время, мин" onChange={(e) => setTime(e.target.value)} />
          </div>
          <label className="rt-check">
            <input type="checkbox" checked={saveToNsi} onChange={(e) => setSaveToNsi(e.target.checked)} />
            сохранить и в реестре операций НСИ
          </label>
          <button type="button" className="btn" disabled={saving || !title.trim()} onClick={() => void addCustom()}>
            {saving ? 'Сохраняем…' : 'Добавить в маршрут'}
          </button>
        </div>
      )}
    </section>
  )
}

/** I — входные материалы: выбор из реестра изделий + количество. */
function InputMaterialPicker({ items, products, onAdd, onRemove }: {
  items: InputMaterial[]; products: Product[]; onAdd: (m: InputMaterial) => void; onRemove: (i: number) => void
}) {
  const [selId, setSelId] = useState('')
  const [qty, setQty] = useState('1')
  const add = () => {
    const p = products.find((x) => x.id === selId)
    if (!p) return
    onAdd({ productId: p.id, name: p.name, qty: Number(qty) || 1, unit: p.unit || 'шт' })
    setSelId(''); setQty('1')
  }
  return (
    <div className="rt-tags">
      <span className="form__label">I — Входные материалы</span>
      <ul className="rt-tags__list">
        {items.map((m, i) => (
          <li key={i} className="rt-tag">
            <span className="rt-tag__t">{m.name}</span>
            <span className="rt-tag__q num">{fmtValue(m.qty)} {m.unit}</span>
            <button type="button" className="rt-tag__x" aria-label={`Убрать ${m.name}`} onClick={() => onRemove(i)}><Icon name="close" size={12} /></button>
          </li>
        ))}
        {items.length === 0 && <li className="rt-muted">не заданы</li>}
      </ul>
      <div className="rt-row">
        <select className="form__select" value={selId} aria-label="Изделие или материал" onChange={(e) => setSelId(e.target.value)}>
          <option value="">— изделие / материал —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} ` : ''}{p.name}</option>)}
        </select>
        <input className="form__input rt-custom__time" type="number" min="0.001" step="any" value={qty} aria-label="Количество" onChange={(e) => setQty(e.target.value)} />
        <button type="button" className="btn btn--icon" aria-label="Добавить материал" disabled={!selId} onClick={add}><Icon name="plus" size={14} /></button>
      </div>
      {products.length === 0 && <span className="form__hint">Нет изделий в реестре — создайте их в НСИ.</span>}
    </div>
  )
}

function TagList({ label, hint, items, onAdd, onRemove }: { label: string; hint: string; items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void }) {
  const [val, setVal] = useState('')
  const add = () => { if (!val.trim()) return; onAdd(val.trim()); setVal('') }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); add() } }
  return (
    <div className="rt-tags">
      <span className="form__label">{label}</span>
      <ul className="rt-tags__list">
        {items.map((t, i) => (
          <li key={i} className="rt-tag">
            <span className="rt-tag__t">{t}</span>
            <button type="button" className="rt-tag__x" aria-label={`Убрать ${t}`} onClick={() => onRemove(i)}><Icon name="close" size={12} /></button>
          </li>
        ))}
        {items.length === 0 && <li className="rt-muted">{hint}</li>}
      </ul>
      <div className="rt-row">
        <input className="form__input" value={val} placeholder="Добавить…" aria-label={label} onChange={(e) => setVal(e.target.value)} onKeyDown={onKey} />
        <button type="button" className="btn btn--icon" aria-label="Добавить" disabled={!val.trim()} onClick={add}><Icon name="plus" size={14} /></button>
      </div>
    </div>
  )
}
