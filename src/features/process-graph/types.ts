/**
 * Граф процесса — общие типы. Источник истины — те же таблицы, что читает
 * планировщик (backend/src/Scheduler.cpp, load_model): routings (is_default),
 * operations (order_no), operation_wc_types, operation_inputs, time_norms,
 * machines (active), workers (skills). Косметические 3D-`flows` НЕ используются.
 */
import type { Machine, Operation, Product, Routing, WorkCenterType, Worker } from '../../lib/api'

/** Значение ячейки SQLite из GET (SELECT *): строка, число или NULL. */
export type Cell = string | number | null | undefined

/* ── Строки API (типизированные интерфейсы + колонки, которых нет в api.ts) ── */
export type ProductRow = Product & {
  lead_time_hours?: Cell
  safety_stock?: Cell
}
export type RoutingRow = Routing & { version?: Cell; is_default?: Cell }
export type OperationRow = Operation & {
  setup_time?: Cell
  tail_weight?: Cell
  tail_index?: Cell
}
export type WorkerRow = Worker & { cost_per_hour?: Cell }

/** Связи операций, которыми реально пользуется движок (предлагаемый GET /api/operation_links). */
export interface OpInputLink {
  operation_id: string
  product_id: string
  qty: Cell
}
export interface OpWcTypeLink {
  operation_id: string
  wc_type_id: string
}
export interface TimeNormLink {
  operation_id: string
  wc_type_id: string
  t_opt: Cell
  t_norm: Cell
  t_pess: Cell
  setup_time: Cell
}
export interface OperationLinks {
  inputs: OpInputLink[]
  wc_types: OpWcTypeLink[]
  time_norms?: TimeNormLink[]
}

/** Сырые данные экрана (один снимок справочников). */
export interface ProcessData {
  products: ProductRow[]
  routings: RoutingRow[]
  operations: OperationRow[]
  wcTypes: WorkCenterType[]
  machines: Machine[]
  workers: WorkerRow[]
  /** null — сервер не отдаёт таблицы связей; связи восстанавливаются из текстовых полей. */
  links: OperationLinks | null
}

/** Откуда взяты связи «операция ↔ тип РЦ / входы». */
export type LinkSource = 'engine' | 'text'

/* ── Нормализованная модель (зеркало Model из Scheduler.cpp) ──────────────── */
export interface ModelInput {
  productId: string
  qty: number
}

export interface ModelOp {
  id: string
  code: string
  name: string
  /** Изделие, чью техкарту исполняет операция. */
  productId: string
  routingId: string
  routingName: string
  orderNo: number
  /** Допустимые типы РЦ (FJSP); первый — ведущий. */
  wcTypeIds: string[]
  inputs: ModelInput[]
  /** Плоские нормы операции, мин. */
  tOpt: number
  tNorm: number
  tPess: number
  /** PERT-ожидание и σ так, как их считает движок (с учётом нормы пары time_norms), мин. */
  tExp: number
  sigma: number
  /** σ подставлена движком как 15 % от t_exp (t_opt = t_pess). */
  sigmaFallback: boolean
  /** Нормы взяты из time_norms для ведущего типа. */
  pairNorm: boolean
  setupTime: number
  cost: number
  riskCoef: number
}

export interface ModelProduct {
  id: string
  code: string
  name: string
  unit: string
  purchased: boolean
  sellable: boolean
  batchSize: number
  stock: number
  leadHours: number
  basePrice: number
  baseCost: number
  demandMax: number
  marketCapacity: number | null
  /** Действующие техкарты (is_default = 1). */
  routings: Array<{ id: string; name: string; version: number }>
  /** Операции в порядке движка (order_no, id). */
  opIds: string[]
}

export interface ModelWcType {
  id: string
  name: string
  group: string
  hourRate: number
  /** Индекс цвета --chart-1..8 (стабильный, по порядку имён). */
  colorIndex: number
  /** Активные станки этого типа. */
  machineIds: string[]
  mtbfHours: number
  repairHours: number
}

export interface ModelStats {
  /** Операции без техкарты / с недействующей техкартой — в расчёте не участвуют. */
  ignoredOps: number
  unresolvedInputs: number
  opsWithoutWcType: number
  bomCycles: number
}

export interface ProcessModel {
  products: ReadonlyMap<string, ModelProduct>
  ops: ReadonlyMap<string, ModelOp>
  wcTypes: ReadonlyMap<string, ModelWcType>
  /** Изделие → операции-потребители (по operation_inputs). */
  consumersOf: ReadonlyMap<string, string[]>
  linkSource: LinkSource
  stats: ModelStats
  warnings: string[]
}

/* ── Ресурсы (тип РЦ × станки × рабочие) ──────────────────────────────────── */
export interface ResourceRow {
  wcTypeId: string
  name: string
  group: string
  colorIndex: number
  machines: number
  /** Рабочие, явно допущенные к типу по навыкам. */
  eligibleWorkerIds: string[]
  /** Рабочие, которых движок реально допускает (с откатом «все», если допущенных нет). */
  effectiveOperators: number
  /** У типа нет ни одного допущенного — движок допускает любого рабочего. */
  fallbackAll: boolean
  /** Реальный параллелизм = min(станки, операторы); без рабочих в модели — станки. */
  capacity: number
  /** Операторов меньше, чем станков. */
  laborConstrained: boolean
  /** Операций, у которых тип — допустимый / ведущий. */
  opCount: number
}

/* ── Граф ─────────────────────────────────────────────────────────────────── */
export type NodeKind = 'raw' | 'op' | 'semi' | 'product'

export interface GraphNode {
  id: string
  kind: NodeKind
  /** id изделия или операции в БД. */
  refId: string
  label: string
  code: string
  /** Изделие, к которому относится узел (для операции — владелец техкарты). */
  productId: string
  /** Ведущий тип РЦ (только операции). */
  wcTypeId: string | null
  colorIndex: number | null
  /** > 0 — маршрут изделия свёрнут в этот узел. */
  collapsedOps: number
  /** Станков (Σ по допустимым типам операции). */
  machines: number
  /** Рабочих, допущенных хотя бы к одному из типов операции. */
  operators: number
  /** Тип операции ограничен трудом (операторов < станков). */
  laborConstrained: boolean
  /** Нет техкарты и не закупается — движок ничего не развернёт. */
  noRouting: boolean
  /** Нет ни одного активного станка допустимых типов. */
  noMachines: boolean
}

export type EdgeKind = 'input' | 'sequence' | 'output'

export interface GraphEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  /** Норма расхода на единицу изделия-владельца (только input). */
  qty: number | null
  unit: string
  /** Операции, через которые идёт поток (для планового объёма). */
  opIds: string[]
}

export interface ProcessGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Изделия, не участвующие в потоке (нет техкарты и нигде не потребляются). */
  isolatedProducts: number
}

/* ── Наложение плана ──────────────────────────────────────────────────────── */
export interface WcLoad {
  name: string
  utilization: number
  busyHours: number
  idleHours: number
}

export interface PlanOverlay {
  planId: string
  createdAt: string
  makespan: number
  wcLoad: ReadonlyMap<string, WcLoad>
  bottleneck: { wcTypeId: string; name: string; utilization: number } | null
  queuePeak: ReadonlyMap<string, number>
  /** Σ плановых часов операции (end − start по задачам плана). */
  opHours: ReadonlyMap<string, number>
  opTasks: ReadonlyMap<string, number>
  /** Заказов изделия в плане (различные order_idx). */
  productOrders: ReadonlyMap<string, number>
  kpi: Readonly<Record<string, number>>
}

export type ViewId = 'flow' | 'resources' | 'chain'

export type Selection = { kind: 'node'; id: string } | { kind: 'wc'; id: string } | null
