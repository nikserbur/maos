/**
 * Инспектор операции (правая панель конструктора, 360 px; P-54): название (две строки, без обрезки) ·
 * тип станка (чип ▲ — только если его нет в Справочниках) · время PERT и наладка · связи IDEF0 под
 * «Связи IDEF0 (n) ▸» (раскрыты, если что-то задано) · внизу за разделителем — «Удалить операцию».
 * Нет выбранной операции — «Добавить операцию» (туда же ведёт «+ Операция» над канвасом).
 */
import { useState, type Dispatch, type KeyboardEvent } from 'react'
import type { Operation, Product, WorkCenterType } from '../../../lib/api'
import { Icon } from '../../../shell/icons'
import { fmtValue, num } from '../../../explain/format'
import { Chip } from '../../../ui/kit'
import { AddOperation } from './AddOperation'
import type { InputMaterial, OpPatch, RoutingAction, RoutingOp } from './routingModel'

interface InspectorProps {
  selected: RoutingOp | null
  selectedIndex: number
  count: number
  dispatch: Dispatch<RoutingAction>
  products: Product[]
  registryOps: Operation[]
  wcTypes: WorkCenterType[]
  addFocus: number
}

export function RoutingInspector({ selected, selectedIndex, count, dispatch, products, registryOps, wcTypes, addFocus }: InspectorProps) {
  return (
    <aside className="rt-inspector" aria-label="Инспектор операции">
      {selected ? (
        <OpEditor key={selected.id} op={selected} index={selectedIndex} count={count} dispatch={dispatch} products={products} wcTypes={wcTypes} />
      ) : (
        <>
          <div className="rt-inspector__empty">
            <p className="text-caps rt-inspector__t">Инспектор операции</p>
            <p className="rt-muted">Выберите операцию на канвасе или в полосе маршрута — здесь правятся её тип станка, время и связи IDEF0.</p>
          </div>
          <AddOperation dispatch={dispatch} registryOps={registryOps} wcTypes={wcTypes} focusToken={addFocus} />
        </>
      )}
    </aside>
  )
}

const idefCount = (op: RoutingOp) => op.inputs.length + op.outputs.length + op.controls.length + op.mechanisms.length

function OpEditor({ op, index, count, dispatch, products, wcTypes }: {
  op: RoutingOp; index: number; count: number; dispatch: Dispatch<RoutingAction>; products: Product[]; wcTypes: WorkCenterType[]
}) {
  const known = !op.wcType || wcTypes.length === 0 || wcTypes.some((t) => t.name === op.wcType)
  const patch = (p: OpPatch) => dispatch({ type: 'UPDATE_OP', id: op.id, patch: p })
  const deterministic = op.tOpt === op.timeMin && op.tPess === op.timeMin
  const setNorm = (v: number) => patch(deterministic ? { timeMin: v, tOpt: v, tPess: v } : { timeMin: v })
  const leadId = wcTypes.find((t) => t.name === op.wcType)?.id
  const others = op.wcTypeIds.filter((id) => id !== leadId).map((id) => wcTypes.find((t) => t.id === id)?.name).filter(Boolean)
  const setLead = (name: string) => {
    const nextId = wcTypes.find((t) => t.name === name)?.id
    const rest = op.wcTypeIds.filter((id) => id !== leadId && id !== nextId)
    patch({ wcType: name, wcTypeIds: nextId ? [nextId, ...rest] : rest })
  }
  const n = idefCount(op)
  const pert = deterministic ? '' : ` · ${num(op.tOpt, 0)}–${num(op.tPess, 0)} (PERT)`

  return (
    <section className="rt-section rt-section--edit">
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
        <textarea className="form__textarea rt-name" rows={2} value={op.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>

      <label className="form__field">
        <span className="form__label">Тип станка</span>
        <select className="form__select" value={op.wcType} aria-invalid={!op.wcType || undefined} onChange={(e) => setLead(e.target.value)}>
          <option value="">— не задан —</option>
          {!known && <option value={op.wcType}>{op.wcType}</option>}
          {wcTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
        {!known && <Chip tone="setup" size="sm">тип не найден в Справочниках</Chip>}
        {!op.wcType && <span className="form__hint">Без типа станка планировщику не на чем выполнять операцию.</span>}
        {others.length > 0 && <span className="form__hint">Также допустимы: {others.join(', ')}</span>}
      </label>

      <div className="form__field">
        <span className="form__label">Время, мин</span>
        <div className="rt-times">
          <label><span className="rt-times__l">норма</span>
            <input className="form__input" type="number" min="0" value={op.timeMin} onChange={(e) => setNorm(Number(e.target.value))} /></label>
          <label><span className="rt-times__l">оптим.</span>
            <input className="form__input" type="number" min="0" value={op.tOpt} onChange={(e) => patch({ tOpt: Number(e.target.value) })} /></label>
          <label><span className="rt-times__l">пессим.</span>
            <input className="form__input" type="number" min="0" value={op.tPess} onChange={(e) => patch({ tPess: Number(e.target.value) })} /></label>
        </div>
        <span className="form__hint num">
          {fmtValue(op.timeMin, 'мин')}{pert}{op.setupMin > 0 ? ` · наладка ${fmtValue(op.setupMin, 'мин')}` : ''}
        </span>
      </div>

      <details className="rt-idef-box" open={n > 0 || !op.inputsKnown}>
        <summary className="rt-idef-box__sum">Связи IDEF0 ({num(n, 0)})</summary>
        <div className="rt-idef-box__body">
          {op.inputsKnown ? (
            <InputMaterialPicker items={op.inputs} products={products}
              onAdd={(m) => dispatch({ type: 'ADD_INPUT', id: op.id, input: m })}
              onRemove={(i) => dispatch({ type: 'DEL_INPUT', id: op.id, index: i })} />
          ) : (
            <div className="rt-tags">
              <span className="form__label">I — Входные материалы</span>
              <p className="rt-muted">входы заданы в Справочниках — здесь не редактируются</p>
            </div>
          )}
          <TagList label="O — Выход операции" hint="Полуфабрикат, изделие…" items={op.outputs}
            onAdd={(v) => dispatch({ type: 'ADD_TAG', id: op.id, field: 'outputs', value: v })}
            onRemove={(i) => dispatch({ type: 'DEL_TAG', id: op.id, field: 'outputs', index: i })} />
          <TagList label="C — Управление" hint="ГОСТ, НТД, регламент…" items={op.controls}
            onAdd={(v) => dispatch({ type: 'ADD_TAG', id: op.id, field: 'controls', value: v })}
            onRemove={(i) => dispatch({ type: 'DEL_TAG', id: op.id, field: 'controls', index: i })} />
          <TagList label="M — Механизм" hint="Оснастка, разряд рабочего…" items={op.mechanisms}
            onAdd={(v) => dispatch({ type: 'ADD_TAG', id: op.id, field: 'mechanisms', value: v })}
            onRemove={(i) => dispatch({ type: 'DEL_TAG', id: op.id, field: 'mechanisms', index: i })} />
        </div>
      </details>

      <footer className="rt-inspector__foot">
        <button type="button" className="btn btn--danger btn--sm" onClick={() => dispatch({ type: 'DELETE_OP', id: op.id })}>
          Удалить операцию
        </button>
        <span className="rt-muted">удаление — до «Сохранить»; «Отмена» вернёт</span>
      </footer>
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
            <span className="rt-tag__t" title={m.name}>{m.name}</span>
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
        <button type="button" className="btn btn--icon" aria-label="Добавить материал" onClick={add}><Icon name="plus" size={14} /></button>
      </div>
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
            <span className="rt-tag__t" title={t}>{t}</span>
            <button type="button" className="rt-tag__x" aria-label={`Убрать ${t}`} onClick={() => onRemove(i)}><Icon name="close" size={12} /></button>
          </li>
        ))}
        {items.length === 0 && <li className="rt-muted">{hint}</li>}
      </ul>
      <div className="rt-row">
        <input className="form__input" value={val} placeholder="Добавить…" aria-label={label} onChange={(e) => setVal(e.target.value)} onKeyDown={onKey} />
        <button type="button" className="btn btn--icon" aria-label="Добавить" onClick={add}><Icon name="plus" size={14} /></button>
      </div>
    </div>
  )
}
