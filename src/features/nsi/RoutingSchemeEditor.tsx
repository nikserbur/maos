import { useReducer, useState, type JSX } from 'react'
import { api, type Product, type Operation, type WorkCenterType } from '../../lib/api'
import { useProducts, useOperations, useWorkCenterTypes } from './useNsi'

/* ── Domain ──────────────────────────────────────────────────────────────── */
export interface InputMaterial {
  productId: string
  name: string
  qty: number
  unit: string
}

export interface RoutingOp {
  id: string
  order: number
  title: string
  opType: string
  wcType: string
  timeMin: number
  controls: string[]        // C — управление (стрелки сверху)
  mechanisms: string[]      // M — механизм  (стрелки снизу)
  inputs: InputMaterial[]   // I — вход: изделие/материал + количество
  outputs: string[]         // O — выход
}

interface RoutingState {
  name: string
  productId: string
  ops: RoutingOp[]
  selectedId: string | null
}

type TagField = 'controls' | 'mechanisms' | 'outputs'

type RoutingAction =
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_PRODUCT'; value: string }
  | { type: 'ADD_OP'; title: string; opType: string; wcType: string; timeMin: number }
  | { type: 'SELECT'; id: string | null }
  | { type: 'UPDATE_OP'; id: string; patch: Partial<Pick<RoutingOp, 'title' | 'opType' | 'wcType' | 'timeMin'>> }
  | { type: 'ADD_TAG'; id: string; field: TagField; value: string }
  | { type: 'DEL_TAG'; id: string; field: TagField; index: number }
  | { type: 'ADD_INPUT'; id: string; input: InputMaterial }
  | { type: 'DEL_INPUT'; id: string; index: number }
  | { type: 'DELETE_OP'; id: string }
  | { type: 'MOVE_UP'; id: string }
  | { type: 'MOVE_DOWN'; id: string }

const uuid = () => Math.random().toString(36).slice(2, 10)

function reducer(s: RoutingState, a: RoutingAction): RoutingState {
  switch (a.type) {
    case 'SET_NAME':    return { ...s, name: a.value }
    case 'SET_PRODUCT': return { ...s, productId: a.value }
    case 'SELECT':      return { ...s, selectedId: a.id }

    case 'ADD_OP': {
      const maxOrder = s.ops.reduce((m, o) => Math.max(m, o.order), 0)
      const op: RoutingOp = {
        id: uuid(), order: maxOrder + 10,
        title: a.title, opType: a.opType, wcType: a.wcType, timeMin: a.timeMin,
        controls: [], mechanisms: [], inputs: [], outputs: [],
      }
      return { ...s, ops: [...s.ops, op], selectedId: op.id }
    }

    case 'UPDATE_OP':
      return { ...s, ops: s.ops.map(o => o.id === a.id ? { ...o, ...a.patch } : o) }

    case 'ADD_TAG':
      return {
        ...s, ops: s.ops.map(o =>
          o.id === a.id ? { ...o, [a.field]: [...o[a.field], a.value] } : o,
        ),
      }

    case 'DEL_TAG':
      return {
        ...s, ops: s.ops.map(o =>
          o.id === a.id
            ? { ...o, [a.field]: o[a.field].filter((_, i) => i !== a.index) }
            : o,
        ),
      }

    case 'ADD_INPUT':
      return {
        ...s, ops: s.ops.map(o =>
          o.id === a.id ? { ...o, inputs: [...o.inputs, a.input] } : o,
        ),
      }

    case 'DEL_INPUT':
      return {
        ...s, ops: s.ops.map(o =>
          o.id === a.id ? { ...o, inputs: o.inputs.filter((_, i) => i !== a.index) } : o,
        ),
      }

    case 'DELETE_OP':
      return {
        ...s,
        ops: s.ops.filter(o => o.id !== a.id),
        selectedId: s.selectedId === a.id ? null : s.selectedId,
      }

    case 'MOVE_UP': {
      const sorted = [...s.ops].sort((a, b) => a.order - b.order)
      const idx = sorted.findIndex(o => o.id === a.id)
      if (idx <= 0) return s
      const [prev, cur] = [sorted[idx - 1], sorted[idx]]
      return { ...s, ops: s.ops.map(o => o.id === prev.id ? { ...o, order: cur.order } : o.id === cur.id ? { ...o, order: prev.order } : o) }
    }

    case 'MOVE_DOWN': {
      const sorted = [...s.ops].sort((a, b) => a.order - b.order)
      const idx = sorted.findIndex(o => o.id === a.id)
      if (idx < 0 || idx >= sorted.length - 1) return s
      const [cur, next] = [sorted[idx], sorted[idx + 1]]
      return { ...s, ops: s.ops.map(o => o.id === cur.id ? { ...o, order: next.order } : o.id === next.id ? { ...o, order: cur.order } : o) }
    }

    default: return s
  }
}

const INIT: RoutingState = { name: '', productId: '', ops: [], selectedId: null }

/* ── SVG layout ──────────────────────────────────────────────────────────── */
const BW = 200, BH = 90, GAP = 110
const HSTEP = BW + GAP
const ML = 130, MR = 80
const CY = 195
const BT = CY - BH / 2
const BB = CY + BH / 2
const SU = 80, SD = 80
const SVG_H = 415
const AC = '#4a9eff', AS = 7

function trunc(s: string, n = 18) { return s.length > n ? s.slice(0, n - 1) + '…' : s }
function blX(i: number) { return ML + i * HSTEP }

function Ah({ x, y, dir }: { x: number; y: number; dir: 'r' | 'd' | 'u' }) {
  const p =
    dir === 'r' ? `${x},${y} ${x - AS},${y - AS * 0.55} ${x - AS},${y + AS * 0.55}` :
    dir === 'd' ? `${x},${y} ${x - AS * 0.55},${y - AS} ${x + AS * 0.55},${y - AS}` :
                  `${x},${y} ${x - AS * 0.55},${y + AS} ${x + AS * 0.55},${y + AS}`
  return <polygon points={p} fill={AC} />
}

function CtrlStubs({ op, i }: { op: RoutingOp; i: number }) {
  const bl = blX(i)
  const items = op.controls.length ? op.controls : ['']
  return (
    <>
      {items.map((label, j) => {
        const x = bl + (j + 1) * BW / (items.length + 1)
        const stub = op.controls.length > 0
        return (
          <g key={j} opacity={stub ? 1 : 0.25}>
            <line x1={x} y1={BT - SU} x2={x} y2={BT} stroke={AC} strokeWidth={1.5}
              strokeDasharray={stub ? undefined : '5 3'} />
            <Ah x={x} y={BT} dir="d" />
            {stub && (
              <text x={x + 3} y={BT - SU + 2} fontSize={10} fill="#8f99a8"
                transform={`rotate(-45,${x + 3},${BT - SU + 2})`} fontFamily="inherit">
                {trunc(label, 16)}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}

function MechStubs({ op, i }: { op: RoutingOp; i: number }) {
  const bl = blX(i)
  const items = op.mechanisms.length ? op.mechanisms : ['']
  return (
    <>
      {items.map((label, j) => {
        const x = bl + (j + 1) * BW / (items.length + 1)
        const stub = op.mechanisms.length > 0
        return (
          <g key={j} opacity={stub ? 1 : 0.25}>
            <line x1={x} y1={BB} x2={x} y2={BB + SD} stroke={AC} strokeWidth={1.5}
              strokeDasharray={stub ? undefined : '5 3'} />
            <Ah x={x} y={BB} dir="u" />
            {stub && (
              <text x={x} y={BB + SD + 14} textAnchor="middle" fontSize={10} fill="#8f99a8" fontFamily="inherit">
                {trunc(label, 16)}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}

function Block({ op, index, selected, onClick }: {
  op: RoutingOp; index: number; selected: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const bl = blX(index)
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      <CtrlStubs op={op} i={index} />
      <MechStubs op={op} i={index} />
      <rect x={bl} y={BT} width={BW} height={BH} rx={4}
        fill={selected ? '#0f1f36' : '#1c2127'}
        stroke={selected ? AC : '#404854'} strokeWidth={selected ? 2 : 1} />
      <text x={bl + 5}       y={CY + 4} fontSize={8} fontWeight="700" fill={AC} opacity={0.45}>I</text>
      <text x={bl + BW - 5}  y={CY + 4} textAnchor="end" fontSize={8} fontWeight="700" fill={AC} opacity={0.45}>O</text>
      <text x={bl + BW / 2}  y={BT + 11} textAnchor="middle" fontSize={8} fontWeight="700" fill={AC} opacity={0.45}>C</text>
      <text x={bl + BW / 2}  y={BB - 4}  textAnchor="middle" fontSize={8} fontWeight="700" fill={AC} opacity={0.45}>M</text>
      <text x={bl + BW / 2}  y={BT + 30} textAnchor="middle" fontSize={13} fontWeight="600" fill="#f6f7f9" fontFamily="inherit">
        {trunc(op.title || 'Операция', 23)}
      </text>
      {op.wcType && (
        <text x={bl + BW / 2} y={BT + 48} textAnchor="middle" fontSize={11} fill="#8f99a8" fontFamily="inherit">
          {trunc(op.wcType, 23)}
        </text>
      )}
      <text x={bl + BW / 2} y={BT + 65} textAnchor="middle" fontSize={11} fill="#5c7080" fontFamily="inherit">
        {op.timeMin} мин
      </text>
      <text x={bl + BW - 7} y={BB - 6} textAnchor="end" fontSize={10} fontFamily="monospace" fill="#5c7080">
        A{index + 1}
      </text>
    </g>
  )
}

function FlowArrows({ ops }: { ops: RoutingOp[] }) {
  const elems: JSX.Element[] = []
  if (!ops.length) return null
  const f = ops[0]
  const inLabel = f.inputs.length ? trunc(f.inputs.map(i => `${i.name}×${i.qty}`).join(', '), 18) : 'Вход'
  elems.push(
    <g key="in">
      <line x1={ML - 70} y1={CY} x2={ML} y2={CY} stroke={AC} strokeWidth={2} />
      <Ah x={ML} y={CY} dir="r" />
      <text x={ML - 70} y={CY - 8} fontSize={10} fill="#5c7080" fontFamily="inherit">{inLabel}</text>
    </g>,
  )
  for (let i = 0; i < ops.length - 1; i++) {
    const fromX = blX(i) + BW, toX = blX(i + 1)
    elems.push(
      <g key={`c${i}`}>
        <line x1={fromX} y1={CY} x2={toX} y2={CY} stroke={AC} strokeWidth={2} />
        <Ah x={toX} y={CY} dir="r" />
      </g>,
    )
  }
  const l = ops[ops.length - 1]
  const outLabel = l.outputs.length ? trunc(l.outputs.join(' + '), 18) : 'Выход'
  const lastRight = blX(ops.length - 1) + BW
  elems.push(
    <g key="out">
      <line x1={lastRight} y1={CY} x2={lastRight + 60} y2={CY} stroke={AC} strokeWidth={2} />
      <Ah x={lastRight + 60} y={CY} dir="r" />
      <text x={lastRight + 5} y={CY - 8} fontSize={10} fill="#5c7080" fontFamily="inherit">{outLabel}</text>
    </g>,
  )
  return <g>{elems}</g>
}

function Diagram({ ops, selectedId, onSelect }: {
  ops: RoutingOp[]; selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const n = ops.length
  const W = n === 0 ? 640 : ML + (n - 1) * HSTEP + BW + MR
  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#0d1014', position: 'relative' }}>
      {n === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: 'var(--text-disabled)', fontSize: 13, pointerEvents: 'none', textAlign: 'center',
        }}>
          Добавьте первую операцию в панели справа.<br />
          Узлы соединятся в IDEF0-маршрут.
        </div>
      )}
      <svg width={W} height={SVG_H} viewBox={`0 0 ${W} ${SVG_H}`}
        style={{ display: 'block' }} onClick={() => onSelect(null)}>
        <rect width={W} height={SVG_H} fill="#0d1014" />
        <defs>
          <pattern id="rse-grid" width={20} height={20} patternUnits="userSpaceOnUse">
            <path d="M20 0L0 0 0 20" fill="none" stroke="#141920" strokeWidth={0.8} />
          </pattern>
        </defs>
        <rect width={W} height={SVG_H} fill="url(#rse-grid)" />
        {ops.map((op, i) => (
          <Block key={op.id} op={op} index={i} selected={op.id === selectedId}
            onClick={e => { e.stopPropagation(); onSelect(op.id) }} />
        ))}
        <FlowArrows ops={ops} />
        <text x={8} y={SVG_H - 8} fontSize={9} fill="#3a4450" fontFamily="inherit">
          IDEF0 — I: вход (←)  C: управление (↓)  O: выход (→)  M: механизм (↑)
        </text>
      </svg>
    </div>
  )
}

/* ── Input material picker (выбор из справочника + количество) ────────────── */
function InputMaterialPicker({ items, products, onAdd, onRemove }: {
  items: InputMaterial[]
  products: Product[]
  onAdd: (m: InputMaterial) => void
  onRemove: (i: number) => void
}) {
  const [selId, setSelId] = useState('')
  const [qty,   setQty]   = useState('1')

  const add = () => {
    const p = products.find(p => p.id === selId)
    if (!p) return
    onAdd({ productId: p.id, name: p.name, qty: Number(qty) || 1, unit: p.unit || 'шт' })
    setSelId(''); setQty('1')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form__label">I — Входные материалы</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 24 }}>
        {items.map((m, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 8px', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 2, fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <span style={{ color: 'var(--accent)', fontSize: 10 }}>↙</span>
            <span style={{ flex: 1 }}>{m.name}</span>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {m.qty} {m.unit}
            </span>
            <button onClick={() => onRemove(i)}
              style={{ padding: 0, lineHeight: 1, fontSize: 12, color: '#cd4246', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </span>
        ))}
        {items.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Не заданы входные материалы</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <select className="form__select" style={{ flex: 1 }} value={selId}
          onChange={e => setSelId(e.target.value)}>
          <option value="">— изделие / материал —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} ` : ''}{p.name}</option>
          ))}
        </select>
        <input className="form__input" style={{ width: 52 }} type="number" min="0.001" step="any"
          value={qty} onChange={e => setQty(e.target.value)} placeholder="кол." />
        <button className="btn btn--primary" style={{ flexShrink: 0, padding: '0 10px' }}
          disabled={!selId} onClick={add}>+</button>
      </div>
      {products.length === 0 && (
        <span className="form__hint">Нет изделий в реестре — создайте их в НСИ.</span>
      )}
    </div>
  )
}

function TagList({ label, hint, items, onAdd, onRemove }: {
  label: string; hint: string
  items: string[]
  onAdd: (v: string) => void
  onRemove: (i: number) => void
}) {
  const [val, setVal] = useState('')
  const add = () => { if (!val.trim()) return; onAdd(val.trim()); setVal('') }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form__label">{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 24 }}>
        {items.map((t, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 2, fontSize: 12, color: 'var(--text-secondary)',
          }}>
            {t}
            <button onClick={() => onRemove(i)}
              style={{ padding: 0, lineHeight: 1, fontSize: 12, color: '#cd4246', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </span>
        ))}
        {items.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="form__input" style={{ flex: 1 }} value={val}
          onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Добавить…" />
        <button className="btn" style={{ flexShrink: 0 }} onClick={add}>+</button>
      </div>
    </div>
  )
}

/* ── Right panel ─────────────────────────────────────────────────────────── */
function Panel({
  state, sorted, dispatch, products, registryOps, wcTypes,
}: {
  state: RoutingState; sorted: RoutingOp[]
  dispatch: React.Dispatch<RoutingAction>
  products: Product[]
  registryOps: Operation[]
  wcTypes: WorkCenterType[]
}) {
  const [pickedOpId, setPickedOpId] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [customWcType, setCustomWcType] = useState('')
  const [customTime, setCustomTime]   = useState('30')
  const [showCustom, setShowCustom]   = useState(false)
  const [saveToNsi, setSaveToNsi]     = useState(false)
  const [savingToNsi, setSavingToNsi] = useState(false)

  const sel = state.ops.find(o => o.id === state.selectedId) ?? null
  const sidx = sel ? sorted.findIndex(o => o.id === sel.id) : -1

  const addFromRegistry = () => {
    const op = registryOps.find(o => o.id === pickedOpId)
    if (!op) return
    dispatch({
      type: 'ADD_OP',
      title: op.name,
      opType: op.op_type,
      wcType: op.wc_types,
      timeMin: Number(op.t_norm) || 30,
    })
    setPickedOpId('')
  }

  const addCustom = async () => {
    if (!customTitle.trim()) return
    const wcTypeName = wcTypes.find(t => t.id === customWcType)?.name ?? ''
    if (saveToNsi && customTitle.trim()) {
      setSavingToNsi(true)
      try {
        await api.operations.create({
          name: customTitle.trim(),
          wc_types: wcTypeName,
          t_norm: customTime,
          t_opt: customTime,
          t_pess: customTime,
        })
      } catch { /* non-fatal — still add to routing */ } finally {
        setSavingToNsi(false)
      }
    }
    dispatch({
      type: 'ADD_OP',
      title: customTitle.trim(),
      opType: '',
      wcType: wcTypeName,
      timeMin: Number(customTime) || 30,
    })
    setCustomTitle(''); setCustomTime('30'); setCustomWcType('')
  }

  const panelStyle: React.CSSProperties = {
    width: 280, flexShrink: 0,
    background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflowY: 'auto', fontSize: 13,
  }

  const sectionStyle: React.CSSProperties = {
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', gap: 8,
  }

  return (
    <div style={panelStyle}>

      {/* Routing meta */}
      <div style={sectionStyle}>
        <div className="form__label">Название техкарты *</div>
        <input className="form__input" value={state.name}
          onChange={e => dispatch({ type: 'SET_NAME', value: e.target.value })}
          placeholder="Техкарта изготовления…" />

        <div className="form__label">Изделие</div>
        <select className="form__select" value={state.productId}
          onChange={e => dispatch({ type: 'SET_PRODUCT', value: e.target.value })}>
          <option value="">— выберите изделие —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>
          ))}
        </select>
        {products.length === 0 && (
          <span className="form__hint">Нет изделий — создайте их в реестре НСИ.</span>
        )}
      </div>

      {/* Add operation */}
      <div style={sectionStyle}>
        <div className="form__label">Добавить операцию</div>

        {/* From registry */}
        {registryOps.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Из реестра:</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="form__select" style={{ flex: 1 }}
                value={pickedOpId} onChange={e => setPickedOpId(e.target.value)}>
                <option value="">— операция —</option>
                {registryOps.map(op => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>
              <button className="btn btn--primary" style={{ flexShrink: 0 }}
                disabled={!pickedOpId} onClick={addFromRegistry}>+</button>
            </div>
          </>
        )}

        {/* Custom / freeform */}
        <button
          style={{
            fontSize: 11, color: 'var(--text-muted)', background: 'none',
            border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0,
          }}
          onClick={() => setShowCustom(v => !v)}
        >
          {showCustom ? '▾' : '▸'} {registryOps.length > 0 ? 'или создать новую' : 'Создать операцию'}
        </button>

        {(showCustom || registryOps.length === 0) && (
          <>
            <input className="form__input" value={customTitle}
              onChange={e => setCustomTitle(e.target.value)} placeholder="Название операции" />
            <select className="form__select" value={customWcType}
              onChange={e => setCustomWcType(e.target.value)}>
              <option value="">— тип оборудования —</option>
              {wcTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="form__input" style={{ width: 70 }} type="number" min="1"
                value={customTime} onChange={e => setCustomTime(e.target.value)} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center' }}>мин</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={saveToNsi} onChange={e => setSaveToNsi(e.target.checked)} />
              Сохранить в реестре операций НСИ
            </label>
            <button className="btn btn--primary" onClick={addCustom} disabled={savingToNsi}>
              {savingToNsi ? 'Сохраняем…' : '+ Добавить в маршрут'}
            </button>
          </>
        )}
      </div>

      {/* Sequence */}
      <div style={sectionStyle}>
        <div className="form__label">Маршрут ({sorted.length})</div>
        {sorted.map((op, i) => (
          <div key={op.id}
            onClick={() => dispatch({ type: 'SELECT', id: op.id })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
              borderRadius: 3, marginBottom: 2, cursor: 'pointer',
              background: op.id === state.selectedId ? 'var(--bg-card)' : 'transparent',
              boxShadow: op.id === state.selectedId ? 'inset 2px 0 0 var(--accent)' : 'none',
            }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)',
              display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700,
              color: '#fff', flexShrink: 0,
            }}>{i + 1}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 12 }}>
              {op.title}
            </span>
            <button className="btn" style={{ padding: '0 5px', minWidth: 0 }}
              onClick={e => { e.stopPropagation(); dispatch({ type: 'MOVE_UP', id: op.id }) }}>↑</button>
            <button className="btn" style={{ padding: '0 5px', minWidth: 0 }}
              onClick={e => { e.stopPropagation(); dispatch({ type: 'MOVE_DOWN', id: op.id }) }}>↓</button>
          </div>
        ))}
        {sorted.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Нет операций</div>
        )}
      </div>

      {/* Selected op IDEF0 editor */}
      {sel && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form__label" style={{ color: AC }}>Операция A{sidx + 1}</div>

          <div className="form__field">
            <div className="form__label">Название</div>
            <input className="form__input" value={sel.title}
              onChange={e => dispatch({ type: 'UPDATE_OP', id: sel.id, patch: { title: e.target.value } })} />
          </div>

          <div className="form__field">
            <div className="form__label">Тип оборудования</div>
            <select className="form__select" value={sel.wcType}
              onChange={e => dispatch({ type: 'UPDATE_OP', id: sel.id, patch: { wcType: e.target.value } })}>
              <option value="">— не задано —</option>
              {wcTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="form__field">
            <div className="form__label">Время, мин</div>
            <input className="form__input" type="number" min="1" value={sel.timeMin}
              onChange={e => dispatch({ type: 'UPDATE_OP', id: sel.id, patch: { timeMin: Number(e.target.value) } })} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <TagList label="C — Управление (сверху)" hint="ГОСТ, НТД, регламент…"
              items={sel.controls}
              onAdd={v => dispatch({ type: 'ADD_TAG', id: sel.id, field: 'controls', value: v })}
              onRemove={i => dispatch({ type: 'DEL_TAG', id: sel.id, field: 'controls', index: i })} />
          </div>
          <TagList label="M — Механизм (снизу)" hint="Станок, разряд рабочего…"
            items={sel.mechanisms}
            onAdd={v => dispatch({ type: 'ADD_TAG', id: sel.id, field: 'mechanisms', value: v })}
            onRemove={i => dispatch({ type: 'DEL_TAG', id: sel.id, field: 'mechanisms', index: i })} />
          <InputMaterialPicker
            items={sel.inputs}
            products={products}
            onAdd={m => dispatch({ type: 'ADD_INPUT', id: sel.id, input: m })}
            onRemove={i => dispatch({ type: 'DEL_INPUT', id: sel.id, index: i })} />
          <TagList label="O — Выход операции" hint="Полуфабрикат, изделие…"
            items={sel.outputs}
            onAdd={v => dispatch({ type: 'ADD_TAG', id: sel.id, field: 'outputs', value: v })}
            onRemove={i => dispatch({ type: 'DEL_TAG', id: sel.id, field: 'outputs', index: i })} />

          <button className="btn btn--danger" style={{ marginTop: 4 }}
            onClick={() => dispatch({ type: 'DELETE_OP', id: sel.id })}>
            Удалить операцию
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Root ────────────────────────────────────────────────────────────────── */
interface RoutingSchemeEditorProps {
  onSave: () => void
  onCancel: () => void
}

export function RoutingSchemeEditor({ onSave, onCancel }: RoutingSchemeEditorProps) {
  const [state, dispatch] = useReducer(reducer, INIT)
  const products    = useProducts()
  const registryOps = useOperations()
  const wcTypes     = useWorkCenterTypes()

  const sorted = [...state.ops].sort((a, b) => a.order - b.order)
  const total  = sorted.reduce((s, o) => s + o.timeMin, 0)

  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!state.name.trim()) { setSaveError('Укажите название техкарты'); return }
    setSaving(true)
    setSaveError(null)
    try {
      await api.routings.create({
        name: state.name,
        product_id: state.productId || undefined,
        operations: sorted.map(op => ({
          code: `OP-${String(op.order).padStart(3, '0')}`,
          name: op.title,
          op_type: op.opType,
          wc_types: op.wcType,
          order_no: String(op.order),
          setup_required: '0',
          t_norm: String(op.timeMin),
          t_opt:  String(op.timeMin),
          t_pess: String(op.timeMin),
          cost: undefined, risk_coef: '0.05',
          controls:   op.controls.join(','),
          mechanisms: op.mechanisms.join(','),
          inputs:     op.inputs.length ? JSON.stringify(op.inputs) : '',
          outputs:    op.outputs.join(','),
        })),
      })
      onSave()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-app)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
        borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-panel)',
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{state.name || '(без названия)'}</strong>
          {state.productId && products.length > 0 && (() => {
            const p = products.find(p => p.id === state.productId)
            return p ? <span>  ·  {p.name}</span> : null
          })()}
          <span style={{ marginLeft: 12, color: 'var(--text-disabled)' }}>
            {sorted.length} оп. · {total} мин
          </span>
        </span>
        {saveError && (
          <span style={{ fontSize: 12, color: '#ff6b6b' }}>{saveError}</span>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onCancel} disabled={saving}>Отмена</button>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить техкарту'}
        </button>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Diagram ops={sorted} selectedId={state.selectedId}
          onSelect={id => dispatch({ type: 'SELECT', id })} />
        <Panel
          state={state} sorted={sorted} dispatch={dispatch}
          products={products} registryOps={registryOps} wcTypes={wcTypes}
        />
      </div>
    </div>
  )
}
