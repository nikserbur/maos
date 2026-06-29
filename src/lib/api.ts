/** Typed API client — проксируется через Vite на 127.0.0.1:8080 в dev-режиме. */

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!text) throw new Error(`HTTP ${res.status}: empty response`)
  const json: ApiResponse<T> = JSON.parse(text)
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.data as T
}

const get  = <T>(path: string)               => request<T>('GET',    path)
const post = <T>(path: string, body: unknown) => request<T>('POST',   path, body)
const put  = <T>(path: string, body: unknown) => request<T>('PUT',    path, body)
const del  = <T>(path: string)               => request<T>('DELETE', path)

/* ── NSI entities ────────────────────────────────────────────────────────── */
export interface WorkCenterType {
  id: string; name: string; group_name: string
  kind: string                // ObjectKind: определяет 3D-вид на схеме
  characteristics: string     // JSON [{label,value}] — фикс. характеристики типа
  description: string; interchangeable: string; created_at: string
}
export interface Machine {
  id: string; name: string; wc_type_id: string; org_unit: string
  inv_no: string; serial_no: string; year_made: string
  schedule: string; status: string
  // Раскладка на 3D-схеме (схема = справочник оборудования):
  subtitle: string; pos_x: string; pos_z: string; rotation_y: string
  parent_machine_id: string
  created_at: string
}
export interface Flow {
  id: string; from_id: string; to_id: string; parent_id: string; created_at: string
}
export interface Product {
  id: string; code: string; name: string; unit: string
  parent_id: string; qty_in_parent: string; batch_size: string
  stock: string; purchased: string; created_at: string
  // Экономика внешних условий / робастной оптимизации:
  sellable: string; base_cost: string; base_price: string; demand_max: string
}
export interface Routing {
  id: string; name: string; product_id: string; created_at: string
  operations?: Operation[]
}
export interface Operation {
  id: string; routing_id: string; code: string; name: string
  op_type: string; wc_types: string; order_no: string
  setup_required: string; t_norm: string; t_opt: string; t_pess: string
  cost: string; risk_coef: string; setup_cost?: string; labor_rate?: string
  controls: string; mechanisms: string; inputs: string; outputs: string
  created_at: string
}
/** Тело создания операции: связи реестров — по ID (типы оборуд., входные изделия). */
export interface OperationCreatePayload extends Partial<Operation> {
  name: string
  wc_type_ids?: string[]
  input_products?: Array<{ product_id: string; qty: number }>
}
export interface Worker {
  id: string; tab_no: string; last_name: string; first_name: string
  middle_name: string; org_unit: string; position: string
  grade: string; skills: string; created_at: string
}
export interface RoutingCreatePayload {
  name: string
  product_id?: string
  operations?: Array<Partial<Omit<Operation, 'id' | 'routing_id' | 'created_at'>> & { name: string }>
}

export interface AuditAction {
  id: string; ts: string; actor: string
  entity_type: string; entity_id: string
  action_type: string; payload: string
}

/* ── Администрирование (Стадия D) ────────────────────────────────────────── */
export interface User {
  id: string; login: string; status: string; failed_attempts: string
  role_id: string; role_name: string; permissions: string; created_at: string
}
export interface Role { id: string; name: string; permissions: string }
export interface OrgUnit { id: string; name: string; parent_id: string; created_at: string }

/* ── Сценарии внешних условий (стохастика цен) ───────────────────────────── */
export type DistType = 'normal' | 'lognormal' | 'triangular' | 'uniform'

export interface PriceDistribution {
  id?: string; scenario_id?: string; product_id: string
  dist_type: DistType
  mean: number | string; stddev: number | string
  min_val?: number | string; max_val?: number | string; mode_val?: number | string
  beta?: number | string   // загрузка на рыночный фактор (корреляция цен)
}
export interface ScenarioOverride {
  product_id: string; base_price?: string; base_cost?: string
}
export interface PriceScenario {
  id: string; name: string; description: string; horizon_hours: string
  market_corr?: string; objective?: string; alpha?: string; max_share?: string
  mode?: string; inflation?: string; fx?: string; demand?: string
  volatility?: string; months?: string
  plan_id?: string; start_date?: string; end_date?: string
  created_at: string
  distributions?: PriceDistribution[]
  overrides?: ScenarioOverride[]
}
export interface ScenarioPayload {
  name: string; description?: string; horizon_hours?: number; market_corr?: number
  objective?: string; alpha?: number; max_share?: number
  mode?: string; inflation?: number; fx?: number; demand?: number
  volatility?: number; months?: number
  plan_id?: string; start_date?: string; end_date?: string
  distributions?: PriceDistribution[]
  overrides?: ScenarioOverride[]
}

/* ── Результат робастной оптимизации (зеркало Optimizer.cpp) ──────────────── */
export interface OptMetrics {
  expected: number; std: number; worst_case: number; var: number
  cvar: number; p_loss: number; downside: number; best: number; max_regret: number
}
export interface OptItem {
  product_id: string; qty: number; unit_price: number; unit_cost: number
  unit_margin: number; contribution: number; risk_contribution: number
}
export interface OptResourceLoad {
  wc_type_id: string; load_hours: number; capacity_hours: number; utilization: number
}
export interface OptDiversification {
  n_products: number; hhi: number; effective_n: number; concentration: number
}
export interface OptPortfolio {
  items: OptItem[]; resource_load: OptResourceLoad[]; total_load_hours: number
  diversification: OptDiversification; metrics: OptMetrics
}
export interface OptHistBin { x0: number; x1: number; count: number }
export interface OptCandidate {
  expected: number; cvar: number; worst_case: number; std: number
  p_loss: number; max_regret: number; is_robust: boolean; is_expected: boolean
}
export interface OptResult {
  scenario_id: string; scenario_name: string; objective: string
  samples: number; alpha: number; lambda: number; seed: number; horizon_hours: number
  market_corr: number; max_share: number
  sellables: number
  robust: OptPortfolio; expected: OptPortfolio
  price_of_robustness: number
  histogram: OptHistBin[]; candidates: OptCandidate[]
  warnings: string[]; run_id?: string
  error_soft?: boolean
}
export interface OptimizeParams {
  scenario_id?: string; objective?: string; samples?: number
  alpha?: number; lambda?: number; seed?: number; horizon_hours?: number; max_share?: number
}
export interface OptRunSummary {
  id: string; scenario_id: string; objective: string; samples: string; alpha: string; created_at: string
}

export interface SchemeAggregate {
  meta: Record<string, string>
  nodes: Machine[]; edges: Flow[]; types: WorkCenterType[]
}

/* ── Стадия 1: расписание (план исполнения) ──────────────────────────────── */
export interface GanttJob {
  order_idx: number; product_id: string; product_name: string
  op_id: string; op_name: string; wc_type_id: string; wc_name: string
  machine_id: string; machine_name: string; worker: number
  start: number; end: number; due: number; late: boolean
}
export interface SchedLoad {
  wc_type_id?: string; wc_name?: string; machine_id?: string; machine_name?: string
  busy_hours: number; idle_hours: number; utilization: number
}
export interface WorkerPlan {
  worker_id: string; name: string; job_count: number
  busy_hours: number; idle_hours: number; utilization: number
  jobs: Array<{ op_name: string; product_id: string; start: number; end: number }>
}
export interface SchedRule {
  rule: string; makespan: number; makespan_cvar: number; makespan_worst: number
  tardiness: number; score: number; chosen: boolean
}
export interface SchedKpi {
  makespan: number; makespan_mean: number; makespan_cvar: number; makespan_worst: number
  tardiness: number; tardiness_cvar: number; n_late: number; otd: number
  utilization: number; cost: number
}
export interface ScheduleResult {
  rule: string; samples: number; alpha: number
  weights: { time: number; cost: number; risk: number }
  n_orders: number; n_jobs: number; n_machines: number; n_workers: number
  program: Array<{ product_id: string; product_name: string; qty: number; due_hours: number }>
  gantt: GanttJob[]; machine_load: SchedLoad[]; wc_load: SchedLoad[]; worker_plan: WorkerPlan[]
  bottleneck: { wc_type_id: string; wc_name: string; utilization: number }
  idle: { machine_idle_hours: number; machine_utilization: number }
  calendar: { enabled: boolean; work_fond_hours: number }
  kpi: SchedKpi; rules: SchedRule[]; warnings: string[]
  plan_id?: string; error_soft?: boolean
}
export interface ScheduleParams {
  run_id?: string; rule?: string; w_time?: number; w_cost?: number; w_risk?: number
  samples?: number; alpha?: number; tail_weight?: number; use_calendar?: boolean
  program?: Array<{ product_id: string; qty: number; due_hours?: number }>
}
export interface WorkCalendar {
  schedule_id?: string; name?: string; enabled: boolean
  start_hour?: number; end_hour?: number; days?: number[]
}

/* ── MRP / запасы (Стадия C) ─────────────────────────────────────────────── */
export interface MrpMaterial {
  product_id: string; name: string; purchased: boolean
  gross_req: number; on_hand: number; safety_stock: number; net_req: number
  shortage: boolean; reorder: boolean; lead_time_hours: number; unit_cost: number
}
export interface MrpResult { feasible: boolean; materials: MrpMaterial[]; n_orders: number }

/* ── Производственная программа (заказы) ─────────────────────────────────── */
export interface DemandOrder {
  id: string; plan_id: string; product_id: string; quantity: string; due_hours: string
  release_hours: string; priority: string; status: string; created_at: string
}
export interface ProductionPlan { id: string; name: string; description: string; created_at: string }

/* ── API surface ─────────────────────────────────────────────────────────── */
// Стадия E+: прогноз цен во времени под макрофакторами.
export interface ForecastParams {
  months?: number; inflation?: number; fx?: number; demand?: number
  volatility?: number; corr?: number; runs?: number; scenario_id?: string
}
export interface ForecastFit {
  data_driven: boolean; dist: 'normal' | 'laplace' | 't' | 'stable'; n_obs: number
  mu: number; sigma: number; nu?: number; alpha?: number
  aic_normal: number; aic_laplace: number; aic_t?: number; aic_stable?: number
}
export interface ForecastProduct {
  id: string; name: string; role: 'product' | 'raw' | 'rate'; base: number
  p10: number[]; p50: number[]; p90: number[]; mean: number[]
  fit?: ForecastFit
}
export interface ForecastResult {
  months: number; inflation_monthly: number; fx: number; demand: number
  volatility: number; corr: number; mode?: string; scenario_id?: string
  inflation_index: number[]
  rate?: ForecastProduct | null
  products: ForecastProduct[]
}

export const api = {
  health: () => get<{ status: string; version: string }>('/health'),

  auth: {
    login: (login: string, password: string) =>
      post<{ token: string; login: string; role: string; permissions: string[] }>(
        '/auth/login', { login, password }),
  },

  workCenterTypes: {
    list:   ()                               => get<WorkCenterType[]>('/work_center_types'),
    get:    (id: string)                     => get<WorkCenterType>(`/work_center_types/${id}`),
    create: (d: Partial<WorkCenterType>)     => post<WorkCenterType>('/work_center_types', d),
    update: (id: string, d: Partial<WorkCenterType>) => put<WorkCenterType>(`/work_center_types/${id}`, d),
    delete: (id: string)                     => del<object>(`/work_center_types/${id}`),
  },

  machines: {
    list:   ()                           => get<Machine[]>('/machines'),
    get:    (id: string)                 => get<Machine>(`/machines/${id}`),
    create: (d: Partial<Machine>)        => post<Machine>('/machines', d),
    update: (id: string, d: Partial<Machine>) => put<Machine>(`/machines/${id}`, d),
    delete: (id: string)                 => del<object>(`/machines/${id}`),
  },

  products: {
    list:   ()                            => get<Product[]>('/products'),
    get:    (id: string)                  => get<Product>(`/products/${id}`),
    create: (d: Partial<Product>)         => post<Product>('/products', d),
    update: (id: string, d: Partial<Product>) => put<Product>(`/products/${id}`, d),
    delete: (id: string)                  => del<object>(`/products/${id}`),
  },

  routings: {
    list:   ()                                  => get<Routing[]>('/routings'),
    get:    (id: string)                        => get<Routing>(`/routings/${id}`),
    create: (d: RoutingCreatePayload)           => post<Routing>('/routings', d),
    delete: (id: string)                        => del<object>(`/routings/${id}`),
  },

  operations: {
    list:   ()                             => get<Operation[]>('/operations'),
    get:    (id: string)                   => get<Operation>(`/operations/${id}`),
    create: (d: OperationCreatePayload)    => post<Operation>('/operations', d),
    update: (id: string, d: Partial<Operation>) => put<Operation>(`/operations/${id}`, d),
    delete: (id: string)                   => del<object>(`/operations/${id}`),
  },

  flows: {
    list:   ()                         => get<Flow[]>('/flows'),
    create: (d: Partial<Flow>)         => post<Flow>('/flows', d),
    delete: (id: string)               => del<object>(`/flows/${id}`),
  },

  workers: {
    list:   ()                            => get<Worker[]>('/workers'),
    get:    (id: string)                  => get<Worker>(`/workers/${id}`),
    create: (d: Partial<Worker>)          => post<Worker>('/workers', d),
    update: (id: string, d: Partial<Worker>) => put<Worker>(`/workers/${id}`, d),
    delete: (id: string)                  => del<object>(`/workers/${id}`),
  },

  actions: {
    list: (limit = 100) => get<AuditAction[]>(`/actions?limit=${limit}`),
  },

  admin: {
    users: () => get<User[]>('/users'),
    roles: () => get<Role[]>('/roles'),
  },

  orgUnits: {
    list: () => get<OrgUnit[]>('/org_units'),
  },

  scheme: {
    get: () => get<SchemeAggregate>('/scheme'),
  },

  scenarios: {
    list:   ()                          => get<PriceScenario[]>('/scenarios'),
    get:    (id: string)                => get<PriceScenario>(`/scenarios/${id}`),
    create: (d: ScenarioPayload)        => post<PriceScenario>('/scenarios', d),
    update: (id: string, d: ScenarioPayload) => put<PriceScenario>(`/scenarios/${id}`, d),
    clone:  (id: string)                => post<PriceScenario>(`/scenarios/${id}/clone`, {}),
    delete: (id: string)                => del<object>(`/scenarios/${id}`),
  },

  optimize: {
    run:  (p: OptimizeParams)  => post<OptResult>('/optimize', p),
    runs: ()                   => get<OptRunSummary[]>('/optimize/runs'),
    run_get: (id: string)      => get<OptResult>(`/optimize/runs/${id}`),
  },

  schedule: {
    run: (p: ScheduleParams) => post<ScheduleResult>('/schedule', p),
  },

  forecast: (p: ForecastParams) => post<ForecastResult>('/forecast', p),

  calendar: {
    get:    ()                       => get<WorkCalendar>('/calendar'),
    update: (d: { start_hour: number; end_hour: number; days: number[] }) => put<{ ok: boolean }>('/calendar', d),
  },

  mrp: {
    run: (program?: Array<{ product_id: string; qty: number }>) =>
      post<MrpResult>('/mrp', program ? { program } : {}),
  },

  demandOrders: {
    list:   ()                          => get<DemandOrder[]>('/demand_orders'),
    create: (d: Partial<DemandOrder>)   => post<DemandOrder>('/demand_orders', d),
    update: (id: string, d: Partial<DemandOrder>) => put<DemandOrder>(`/demand_orders/${id}`, d),
    delete: (id: string)                => del<object>(`/demand_orders/${id}`),
  },

  plans: {
    list:   ()                          => get<ProductionPlan[]>('/production_plans'),
    create: (d: { name: string; description?: string }) => post<ProductionPlan>('/production_plans', d),
    delete: (id: string)                => del<object>(`/production_plans/${id}`),
  },

  demo: {
    seed: () => post<Array<{ nodeId: string; machineId: string }>>('/demo/seed', {}),
  },
}
