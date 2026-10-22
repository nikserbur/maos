/**
 * Модель конструктора техкарты (G3 1.4): операции маршрута с IDEF0-связями
 * (I вход · C управление · O выход · M механизм), редьюсер без мутаций, конвертация
 * из операций API и обратно в тот же payload `api.routings.create` (контракт не менялся).
 */
import type { Operation, RoutingCreatePayload, WorkCenterType } from '../../../lib/api'

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
  controls: string[]        // C — управление
  mechanisms: string[]      // M — механизм
  inputs: InputMaterial[]   // I — вход: изделие/материал + количество
  outputs: string[]         // O — выход
}

export interface RoutingState {
  name: string
  productId: string
  ops: RoutingOp[]
  selectedId: string | null
  /** Есть несохранённые изменения. */
  dirty: boolean
}

export type TagField = 'controls' | 'mechanisms' | 'outputs'

export type RoutingAction =
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
  | { type: 'MOVE'; id: string; delta: -1 | 1 }
  | { type: 'MOVE_TO'; id: string; index: number }
  | { type: 'INIT'; name: string; productId: string; ops: RoutingOp[] }

export const uuid = () => Math.random().toString(36).slice(2, 10)

export const INIT_STATE: RoutingState = { name: '', productId: '', ops: [], selectedId: null, dirty: false }

/** Операции в порядке маршрута. */
export const sortOps = (ops: ReadonlyArray<RoutingOp>): RoutingOp[] => [...ops].sort((a, b) => a.order - b.order)

export const totalMinutes = (ops: ReadonlyArray<RoutingOp>): number => ops.reduce((s, o) => s + (Number(o.timeMin) || 0), 0)

/** Узкое место маршрута — операция с максимальным временем (при равенстве — первая). */
export function bottleneckId(ops: ReadonlyArray<RoutingOp>): string | null {
  let best: RoutingOp | null = null
  for (const o of sortOps(ops)) if (!best || o.timeMin > best.timeMin) best = o
  return best?.id ?? null
}

/** Переставить операцию на позицию `index` и перенумеровать с шагом 10. */
function reorder(ops: ReadonlyArray<RoutingOp>, id: string, index: number): RoutingOp[] {
  const sorted = sortOps(ops)
  const from = sorted.findIndex((o) => o.id === id)
  if (from < 0) return [...ops]
  const to = Math.max(0, Math.min(sorted.length - 1, index))
  if (from === to) return [...ops]
  const moved = sorted[from]
  const rest = sorted.filter((o) => o.id !== id)
  const next = [...rest.slice(0, to), moved, ...rest.slice(to)]
  return next.map((o, i) => ({ ...o, order: (i + 1) * 10 }))
}

export function routingReducer(s: RoutingState, a: RoutingAction): RoutingState {
  const ops = (next: RoutingOp[]): RoutingState => ({ ...s, ops: next, dirty: true })
  switch (a.type) {
    case 'SET_NAME': return { ...s, name: a.value, dirty: true }
    case 'SET_PRODUCT': return { ...s, productId: a.value, dirty: true }
    case 'SELECT': return { ...s, selectedId: a.id }
    case 'ADD_OP': {
      const maxOrder = s.ops.reduce((m, o) => Math.max(m, o.order), 0)
      const op: RoutingOp = {
        id: uuid(), order: maxOrder + 10, title: a.title, opType: a.opType, wcType: a.wcType, timeMin: a.timeMin,
        controls: [], mechanisms: [], inputs: [], outputs: [],
      }
      return { ...s, ops: [...s.ops, op], selectedId: op.id, dirty: true }
    }
    case 'UPDATE_OP': return ops(s.ops.map((o) => (o.id === a.id ? { ...o, ...a.patch } : o)))
    case 'ADD_TAG': return ops(s.ops.map((o) => (o.id === a.id ? { ...o, [a.field]: [...o[a.field], a.value] } : o)))
    case 'DEL_TAG': return ops(s.ops.map((o) => (o.id === a.id ? { ...o, [a.field]: o[a.field].filter((_, i) => i !== a.index) } : o)))
    case 'ADD_INPUT': return ops(s.ops.map((o) => (o.id === a.id ? { ...o, inputs: [...o.inputs, a.input] } : o)))
    case 'DEL_INPUT': return ops(s.ops.map((o) => (o.id === a.id ? { ...o, inputs: o.inputs.filter((_, i) => i !== a.index) } : o)))
    case 'DELETE_OP': {
      const rest = s.ops.filter((o) => o.id !== a.id)
      return { ...s, ops: rest, selectedId: s.selectedId === a.id ? null : s.selectedId, dirty: true }
    }
    case 'MOVE': {
      const idx = sortOps(s.ops).findIndex((o) => o.id === a.id)
      return idx < 0 ? s : ops(reorder(s.ops, a.id, idx + a.delta))
    }
    case 'MOVE_TO': return ops(reorder(s.ops, a.id, a.index))
    case 'INIT': return { name: a.name, productId: a.productId, ops: a.ops, selectedId: null, dirty: false }
    default: return s
  }
}

/* ── API ⇄ модель ───────────────────────────────────────────────────────── */

const splitList = (raw: string | undefined): string[] => (raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : [])

function parseInputs(raw: string | undefined): InputMaterial[] {
  if (!raw) return []
  try {
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is InputMaterial => typeof x === 'object' && x !== null && 'productId' in x) : []
  } catch { return [] }
}

/** Операции техкарты из реестра операций (по routing_id, в порядке order_no). */
export function opsFromApi(all: ReadonlyArray<Operation>, routingId: string): RoutingOp[] {
  return all
    .filter((o) => o.routing_id === routingId)
    .sort((a, b) => Number(a.order_no) - Number(b.order_no))
    .map((o) => ({
      id: uuid(), order: Number(o.order_no) || 0, title: o.name, opType: o.op_type, wcType: o.wc_types,
      timeMin: Number(o.t_norm) || 0, controls: splitList(o.controls), mechanisms: splitList(o.mechanisms),
      inputs: parseInputs(o.inputs), outputs: splitList(o.outputs),
    }))
}

/** Payload сохранения — тот же, что у прежнего модального редактора (API без изменений). */
export function payloadFromState(state: RoutingState, wcTypes: ReadonlyArray<WorkCenterType>): RoutingCreatePayload {
  return {
    name: state.name,
    product_id: state.productId || undefined,
    operations: sortOps(state.ops).map((op) => ({
      code: `OP-${String(op.order).padStart(3, '0')}`,
      name: op.title,
      op_type: op.opType,
      wc_types: op.wcType,
      // Связь по ID обязательна: планировщик подбирает станки через operation_wc_types.
      wc_type_ids: op.wcType ? [wcTypes.find((t) => t.name === op.wcType)?.id].filter((x): x is string => !!x) : [],
      order_no: String(op.order),
      setup_required: '0',
      t_norm: String(op.timeMin), t_opt: String(op.timeMin), t_pess: String(op.timeMin),
      cost: undefined, risk_coef: '0.05',
      controls: op.controls.join(','), mechanisms: op.mechanisms.join(','),
      inputs: op.inputs.length ? JSON.stringify(op.inputs) : '', outputs: op.outputs.join(','),
    })),
  }
}

/** Проверка перед сохранением; null — всё в порядке. */
export function validateRouting(state: RoutingState): string | null {
  if (!state.name.trim()) return 'Укажите название техкарты'
  if (state.ops.length === 0) return 'Техкарта должна содержать хотя бы одну операцию — добавьте её в инспекторе'
  if (state.ops.some((op) => !op.wcType)) return 'У каждой операции должен быть тип оборудования (РЦ) — иначе её не на чем выполнять'
  return null
}
