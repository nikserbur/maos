/**
 * Модель конструктора техкарты (G3 1.4): операции маршрута с IDEF0-связями
 * (I вход · C управление · O выход · M механизм), редьюсер без мутаций, конвертация
 * из операций API и обратно в payload `api.routings.create`. Сохранение не теряет полей (P-42):
 * код, тип, PERT-время, наладка, ставка, риск, наладка-флаг, стоимость и связи по ID едут туда и обратно.
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
  /** Код операции из API (OP-010); пусто — назначается по порядку при сохранении. */
  code: string
  title: string
  opType: string
  /** Ведущий тип оборудования (имя) — подпись узла; все допустимые типы — `wcTypeIds`. */
  wcType: string
  wcTypeIds: string[]
  timeMin: number
  tOpt: number
  tPess: number
  setupMin: number
  setupRequired: boolean
  laborRate: number
  riskCoef: number
  cost: string
  controls: string[]        // C — управление
  mechanisms: string[]      // M — механизм
  inputs: InputMaterial[]   // I — вход: изделие/материал + количество
  outputs: string[]         // O — выход
  /** Входы загружены (JSON-массив в записи операции). false — входы есть только в связях сервера и сюда не пришли. */
  inputsKnown: boolean
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
export type OpPatch = Partial<Pick<RoutingOp, 'title' | 'opType' | 'wcType' | 'wcTypeIds' | 'timeMin' | 'tOpt' | 'tPess' | 'setupMin'>>
export type NewOp = Partial<Omit<RoutingOp, 'id' | 'order'>> & { title: string; wcType: string; timeMin: number }

export type RoutingAction =
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_PRODUCT'; value: string }
  | ({ type: 'ADD_OP' } & NewOp)
  | { type: 'SELECT'; id: string | null }
  | { type: 'UPDATE_OP'; id: string; patch: OpPatch }
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

/** Самая длинная операция маршрута (при равенстве — первая). */
export function longestId(ops: ReadonlyArray<RoutingOp>): string | null {
  let best: RoutingOp | null = null
  for (const o of sortOps(ops)) if (!best || o.timeMin > best.timeMin) best = o
  return best?.id ?? null
}

export interface CapacityBottleneck { id: string; minutes: number; machines: number; perMachine: number }

/**
 * Узкое место по мощности: операция с наибольшей нормой на один станок её типов
 * (t_norm / число активных станков допустимых типов). Нет станков — ∞ (сразу узкое место).
 */
export function capacityBottleneck(ops: ReadonlyArray<RoutingOp>, machinesOf: (op: RoutingOp) => number): CapacityBottleneck | null {
  let best: CapacityBottleneck | null = null
  for (const o of sortOps(ops)) {
    const m = machinesOf(o)
    const perMachine = m > 0 ? o.timeMin / m : Number.POSITIVE_INFINITY
    if (!best || perMachine > best.perMachine) best = { id: o.id, minutes: o.timeMin, machines: m, perMachine }
  }
  return best
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

/** Новая операция маршрута: недостающее — по умолчанию (детерминированное время, без наладки, входы известны). */
export function makeOp(src: NewOp, order: number): RoutingOp {
  return {
    code: '', opType: '', wcTypeIds: [], tOpt: src.timeMin, tPess: src.timeMin, setupMin: 0, setupRequired: false,
    laborRate: 0, riskCoef: 0.05, cost: '', controls: [], mechanisms: [], inputs: [], outputs: [], inputsKnown: true,
    ...src, id: uuid(), order,
  }
}

export function routingReducer(s: RoutingState, a: RoutingAction): RoutingState {
  const ops = (next: RoutingOp[]): RoutingState => ({ ...s, ops: next, dirty: true })
  switch (a.type) {
    case 'SET_NAME': return { ...s, name: a.value, dirty: true }
    case 'SET_PRODUCT': return { ...s, productId: a.value, dirty: true }
    case 'SELECT': return { ...s, selectedId: a.id }
    case 'ADD_OP': {
      const { type: _t, ...src } = a
      const maxOrder = s.ops.reduce((m, o) => Math.max(m, o.order), 0)
      const op = makeOp(src, maxOrder + 10)
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
const numOr = (raw: string | number | null | undefined, d: number): number => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return d
  const n = Number(raw)
  return Number.isFinite(n) ? n : d
}

/** Входы из JSON-массива записи операции; null — массива нет (входы только в связях сервера, сюда не пришли). */
export function parseInputs(raw: string | undefined): InputMaterial[] | null {
  if (!raw || !raw.trim()) return null
  try {
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr.filter((x): x is InputMaterial => typeof x === 'object' && x !== null && 'productId' in x)
  } catch { return null }
}

/**
 * Типы оборудования из CSV имён `wc_types`. Имена сами бывают с запятой («линия (альфа-сет, OMEGA)»),
 * поэтому имя ищется целиком на границах «начало/запятая … запятая/конец», а не разбиением строки.
 */
export function typesFromNames(csv: string | undefined, wcTypes: ReadonlyArray<WorkCenterType>): WorkCenterType[] {
  const s = (csv ?? '').trim()
  if (!s) return []
  const hits: Array<{ t: WorkCenterType; at: number }> = []
  for (const t of wcTypes) {
    const name = t.name.trim()
    if (!name) continue
    let from = 0
    while (from <= s.length) {
      const at = s.indexOf(name, from)
      if (at < 0) break
      const before = s.slice(0, at).trimEnd()
      const after = s.slice(at + name.length).trimStart()
      if ((before === '' || before.endsWith(',')) && (after === '' || after.startsWith(','))) { hits.push({ t, at }); break }
      from = at + 1
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.t)
}

/** Операции техкарты из реестра операций (по routing_id, в порядке order_no). */
export function opsFromApi(all: ReadonlyArray<Operation>, routingId: string, wcTypes: ReadonlyArray<WorkCenterType> = []): RoutingOp[] {
  return all
    .filter((o) => o.routing_id === routingId)
    .sort((a, b) => Number(a.order_no) - Number(b.order_no))
    .map((o) => {
      const byName = typesFromNames(o.wc_types, wcTypes)
      const ids = o.wc_type_ids?.length ? [...o.wc_type_ids] : byName.map((t) => t.id)
      const lead = wcTypes.find((t) => t.id === ids[0])?.name ?? byName[0]?.name ?? splitList(o.wc_types)[0] ?? ''
      const inputs = parseInputs(o.inputs)
      const tNorm = numOr(o.t_norm, 0)
      return {
        id: uuid(), order: numOr(o.order_no, 0), code: o.code ?? '', title: o.name, opType: o.op_type ?? '',
        wcType: lead, wcTypeIds: ids, timeMin: tNorm, tOpt: numOr(o.t_opt, tNorm), tPess: numOr(o.t_pess, tNorm),
        setupMin: numOr(o.setup_time, 0), setupRequired: o.setup_required === '1', laborRate: numOr(o.labor_rate, 0),
        riskCoef: numOr(o.risk_coef, 0.05), cost: o.cost ?? '',
        controls: splitList(o.controls), mechanisms: splitList(o.mechanisms), outputs: splitList(o.outputs),
        inputs: inputs ?? [], inputsKnown: inputs !== null,
      }
    })
}

/** ID допустимых типов операции: явные связи; иначе — по имени ведущего типа. */
function typeIdsOf(op: RoutingOp, wcTypes: ReadonlyArray<WorkCenterType>): string[] {
  const lead = wcTypes.find((t) => t.name === op.wcType)?.id
  if (op.wcTypeIds.length) return lead && !op.wcTypeIds.includes(lead) ? [lead, ...op.wcTypeIds] : [...op.wcTypeIds]
  return lead ? [lead] : []
}

/** Payload сохранения: каждое поле операции — как загружено/изменено (ничего не теряется по дороге). */
export function payloadFromState(state: RoutingState, wcTypes: ReadonlyArray<WorkCenterType>): RoutingCreatePayload {
  return {
    name: state.name,
    product_id: state.productId || undefined,
    operations: sortOps(state.ops).map((op) => {
      const ids = typeIdsOf(op, wcTypes)
      const names = ids.map((id) => wcTypes.find((t) => t.id === id)?.name).filter((x): x is string => Boolean(x))
      return {
        code: op.code || `OP-${String(op.order).padStart(3, '0')}`,
        name: op.title,
        op_type: op.opType,
        wc_types: names.length ? names.join(', ') : op.wcType,
        // Связь по ID обязательна: планировщик подбирает станки через operation_wc_types.
        wc_type_ids: ids,
        order_no: String(op.order),
        setup_required: op.setupRequired || op.setupMin > 0 ? '1' : '0',
        setup_time: String(op.setupMin),
        t_norm: String(op.timeMin), t_opt: String(op.tOpt), t_pess: String(op.tPess),
        cost: op.cost || undefined, risk_coef: String(op.riskCoef), labor_rate: String(op.laborRate),
        controls: op.controls.join(','), mechanisms: op.mechanisms.join(','),
        // Пустой массив — «входов нет» (а не «неизвестно»): в следующий раз техкарта откроется с известными входами.
        inputs: JSON.stringify(op.inputs), outputs: op.outputs.join(','),
      }
    }),
  }
}

/** Проверка перед сохранением; null — всё в порядке. */
export function validateRouting(state: RoutingState): string | null {
  if (!state.name.trim()) return 'Укажите название техкарты'
  if (state.ops.length === 0) return 'Техкарта должна содержать хотя бы одну операцию — добавьте её кнопкой «+ Операция»'
  if (state.ops.some((op) => !op.wcType)) return 'У каждой операции должен быть тип оборудования — иначе её не на чем выполнять'
  return null
}

/** Номера (1…n) операций, чьи входы не загрузились: сохранение стёрло бы их связи. */
export function unknownInputOps(ops: ReadonlyArray<RoutingOp>): number[] {
  return sortOps(ops).flatMap((o, i) => (o.inputsKnown ? [] : [i + 1]))
}

/** Почему сохранять нельзя (входы операций не загружены); null — можно. */
export function saveBlocker(state: RoutingState): string | null {
  const nums = unknownInputOps(state.ops)
  if (nums.length === 0) return null
  const list = nums.length > 6 ? `${nums.slice(0, 6).join(', ')}…` : nums.join(', ')
  return `Входы операций № ${list} заданы в Справочниках и сюда не загружаются — сохранение стёрло бы их. ` +
    'Входы правятся в реестре «Операции»; сохранение техкарты откроется после доработки сервера.'
}

/** Операции, у которых сервер пока не сохраняет наладку (POST /routings без setup_time) — для предупреждения. */
export function setupLossCount(ops: ReadonlyArray<RoutingOp>): number {
  return ops.filter((o) => o.setupMin > 0).length
}
