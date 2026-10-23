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
  // Bearer-токен сессии: backend проверяет его на каждом /api/* (RBAC).
  const headers: Record<string, string> = {}
  if (body) headers['Content-Type'] = 'application/json'
  try {
    const token = sessionStorage.getItem('maos.token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch { /* приватный режим и т.п. */ }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  // Токен истёк/сервер перезапущен → чистим сессию и возвращаем на окно входа.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    try { sessionStorage.removeItem('maos.token'); sessionStorage.removeItem('maos.session') } catch { /* noop */ }
    window.location.reload()
  }
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
  hour_rate?: string; efficiency?: string
  // Надёжность/ТО (симуляция поломок и планового обслуживания):
  mtbf_hours?: string; repair_hours?: string; mtbm_hours?: string; maintenance_hours?: string
}
export interface Machine {
  id: string; name: string; wc_type_id: string; org_unit: string
  inv_no: string; serial_no: string; year_made: string
  schedule: string; status: string
  org_unit_id?: string
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
  // Модель спроса/конкуренции (ёмкость рынка, эластичность, конкуренты):
  market_capacity?: string; price_elasticity?: string; competitor_supply?: string
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
  /** Цех (FK org_units) — по нему сервер ограничивает найм начальником цеха. */
  org_unit_id?: string | null
  cost_per_hour?: string
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
  /** Цех пользователя — область права HIRE_WORKERS (начальник цеха). */
  org_unit_id?: string | null
}
export interface UserCreate { login: string; password: string; role_id: string; org_unit_id?: string }
export interface UserPatch { role_id?: string; org_unit_id?: string; status?: string; password?: string }
export interface Role { id: string; name: string; permissions: string }
export interface OrgUnit { id: string; name: string; parent_id: string; unit_type?: string; kind?: string; pos_x?: string; pos_z?: string; lat?: string; lng?: string; created_at: string }

/* ── Сценарии внешних условий (стохастика цен) ───────────────────────────── */
export type DistType = 'normal' | 'lognormal' | 'triangular' | 'uniform' | 't' | 'pareto'

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
  /** @deprecated волна M: ползунки приняты, но в расчёте не используются (паспорт r1.50–r1.53). */
  sanctions?: string; tax_change?: string; energy?: string; logistics?: string; key_rate?: string
  /** Волна M: режим макро-генератора (JSON-строка MacroMode или 'base'). */
  macro_mode?: string
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
  /** @deprecated волна M: не используются в расчёте. */
  sanctions?: number; tax_change?: number; energy?: number; logistics?: number; key_rate?: number
  /** Волна M: меню режимов/стрессов вместо ползунков (METHODOLOGY-V2 §2.6б). */
  macro_mode?: MacroMode | MacroModeName
  distributions?: PriceDistribution[]
  overrides?: ScenarioOverride[]
}

/* ── Волна M: обученный макро-генератор (MacroSampler; rl/macro) ─────────────── */
export type MacroModeName = 'base' | 'regime' | 'quantile' | 'episode' | 'iid_v063'
/** Стресс §2.6б: режим навязан | квантиль Student-t | исторический эпизод. null → базовый. */
export type MacroStress =
  | { regime: number }
  | { quantile_t: number }
  | { episode: string; months?: number }
  | null
/** Базовая траектория [НОРМ]: инфляция flat | узлы ЦБ | пользовательская; ставка flat | пользовательская. */
export interface MacroRef { cpi?: 'flat' | 'nodes' | number[]; key?: 'flat' | number[] }
export interface MacroMode { mode: MacroModeName; stress?: MacroStress; ref?: MacroRef }
export interface MacroRegime {
  index: number; label: string; share_of_history: number; n_months: number; stationary_prob: number
  resid_sd: { log_cpi_pp: number; real_key_pp: number; log_fx_pct: number }
  mean_duration_months: number; months: string[]; stay_prob: number; stay_prob_block: number
}
export interface MacroLastObs { month: string; cpi_yoy_pp: number; key_pp: number; usd_rub: number }
/** GET /macro/regimes */
export interface MacroRegimes {
  k: number; block_months: number; regimes: MacroRegime[]; transition: number[][]; crisis_index: number
  p_last: number[]; note: string; last_obs: MacroLastObs; stress_quantiles: number[]; episodes_available: [string, string]
}
export interface MacroHoldoutVar {
  coverage80: number; coverage90: number; mean_CRPS: number; mean_CRPS_persistence: number; mean_CRPS_fixed4?: number
  rmse_mean: number; rmse_persistence: number; PIT_histogram10: number[]
}
/** GET /macro/summary — данные, выбор (R, b), таблица CRPS, отложенное покрытие, хвосты. */
export interface MacroSummary {
  schema: string; trained_at: string; data: { source: string; n: number; first: string; last: string; synthetic: number }
  features: string[]; regimes: number; block_months: number; rank: number; n_resid: number
  ridge: number; spectral_radius: number; fx_trend: number[]; sigma_bb: Record<string, number | string>
  selection: { choice: { regimes: number; block_months: number; joint_standardized_CRPS_13months: number; naive_persistence_joint_CRPS: number; n_validation_targets: number }
               grid: Array<{ regimes: number; block_months: number; joint_standardized_CRPS_13months: number; per_variable_CRPS: number[] }>
               train_end: string; validation_targets: string; criterion: string }
  holdout?: { n: number; horizon_months: number; start_target: string; variables: Record<'cpi_yoy_pp' | 'key_pp' | 'usd_rub', MacroHoldoutVar>
              flags: { threshold: number; undercoverage80: string[]; note: string }; caveat: string }
  last_obs: MacroLastObs; usd_inflation: number; status: string
}
export interface MacroSampleParams {
  n?: number; seed?: number; horizon_weeks?: number; horizon_months?: number; paths?: number
  stress?: MacroStress; ref?: MacroRef
}
export interface MacroQuantiles { p05: number[]; p50: number[]; p95: number[]; mean: number[] }
export interface MacroSeriesQuantiles { cpi: MacroQuantiles; key: MacroQuantiles; fx: MacroQuantiles }
export interface MacroPath {
  id: number; regime: number[]
  monthly: { cpi: number[]; key: number[]; fx: number[] }
  weekly: { cpi: number[]; key: number[]; fx: number[] } | null
}
/** POST /macro/sample — слово «прогноз» допустимо только при is_forecast (базовый режим). */
export interface MacroSampleResult {
  n: number; seed: number; horizon_weeks: number; months: number
  mode: MacroModeName; stress: MacroStress; is_forecast: boolean; label: string
  ref: { cpi: number[]; key: number[] }; regime_share: number[]
  monthly: MacroSeriesQuantiles; weekly: MacroSeriesQuantiles | null
  paths: MacroPath[]; sigma_bb_fx: number
  streams: { macro: [number, number]; bridge: [number, number] }
  last_obs: MacroLastObs; ms: number
}
/** Блок macro в ответе /optimize: что генератор сделал со сценариями (§2.4). */
export interface OptMacroInfo {
  available: boolean; on: boolean; mode: MacroModeName; stress: MacroStress; ref: MacroRef | null
  months: number; weeks: number; regime_share: number[]
  streams: { macro: [number, number]; bridge: [number, number] }
  pass_through: { fx_product: number; fx_raw: number; cpi: number; conv_cpi: number; logistics_fx: number; logistics_cpi: number; status: string }
  factor_sd: number
}

/* ── Результат робастной оптимизации (зеркало Optimizer.cpp) ──────────────── */
export interface OptMetrics {
  expected: number; std: number; worst_case: number; var: number
  cvar: number; p_loss: number; downside: number; best: number; max_regret: number
}
export interface OptItem {
  product_id: string; qty: number; sold_qty?: number
  unit_price: number; unit_cost: number
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
export interface OptHistBin { x0: number; x1: number; count: number; count_expected?: number }
export interface OptCandidate {
  expected: number; cvar: number; worst_case: number; std: number
  p_loss: number; max_regret: number; is_robust: boolean; is_expected: boolean
  concentration?: number; is_pareto?: boolean
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
  /** R5: применён ли stage1_feedback и его хэш (пишется в optimization_runs). */
  feedback?: { applied: boolean; hash: string; rows: number }
  tail_uplift?: boolean
  /** Волна F: CVaR-LP с кассой (cash:true / POST /optimize/cash). */
  cash_lp?: CashLpResult
  /** Волна M: макро-генератор в этом прогоне (режим, доли режимов, pass-through, потоки CRN). */
  macro?: OptMacroInfo
}
export interface OptimizeParams {
  scenario_id?: string; objective?: string; samples?: number
  alpha?: number; lambda?: number; seed?: number; horizon_hours?: number; max_share?: number
  /** R5: применить поправку мощности из stage1_feedback (по умолчанию — нет, ответ не зависит от истории расписаний). */
  apply_feedback?: boolean
  /** R4: хвостовая поправка мощности Стадии 2 (по умолчанию включена). */
  tail_uplift?: boolean
  /** Волна F: CVaR-LP с кассой (METHODOLOGY-V2 §5.2) → поле cash_lp в ответе. */
  cash?: boolean; beta?: number; l_min?: number; financing_stage?: 'recourse' | 'first'
  horizon_weeks?: number; cash_samples?: number; schedule_ref_id?: string; pol_curve?: boolean
  /** Волна M: режим генератора (иначе — из сценария macro_mode, иначе base); 'iid_v063' — прежний i.i.d. фактор (только для E1). */
  macro_mode?: MacroMode | MacroModeName; macro_stress?: MacroStress; macro_ref?: MacroRef
  /** E1: оценить заданный план {product_id: qty} через водопад без решения LP → cash_lp.fixed_portfolio. */
  eval_portfolio?: Record<string, number>
}

/* ── Волна F: денежный слой (fin_params, паспорт, CVaR-LP с кассой) ──────── */
export type PassportStatus = 'Н' | 'О' | 'К' | 'НОРМ' | 'UI' | 'техн.' | 'синтетика'
export interface PassportParam {
  code: string; block: string; name: string; value: string; unit: string
  status: PassportStatus; source: string; file_ref: string; note: string; updated_at: string
}
export interface PassportList { params: PassportParam[]; count: number; by_status: Record<string, number>; note: string }
/** Финансовые параметры водопада кассы; ед. денег = ед. цен НСИ (₽), ставки годовые, периоды — недели. */
export interface FinParams {
  entity: string; period_type: string; effective_from: string; updated_at: string
  c0: number; c_min: number; credit_limit: number; d0: number
  key_rate: number; spread: number; overdraft_spread: number; overdraft_limit: number
  tau_v: number; tau_p: number; tau_soc: number; property_tax_weekly: number
  payroll_fixed_weekly: number; repair_budget_weekly: number; other_fixed_weekly: number
  dso_kernel: number[]; pd: number; lgd: number; prepay_share: number; dpo_weeks: number; lead_weeks: number
  vat_period_weeks: number; vat_instalments: number; vat_instalment_lag_weeks: number; tax_period_weeks: number
  payroll_weeks: number[]; dscr_covenant: number; rate_owner: number; rate_bank: number
  beta: number; l_min: number; horizon_weeks: number; cash_samples: number; auto_repay: number
}
export interface PeriodQuantiles { p05: number[]; p50: number[]; p95: number[] }
/** KPI денежного слоя (METHODOLOGY-V2 §6.0) по водопаду §4.3 на решении LP. */
export interface CashWaterfallKpi {
  financing: 'lp_recourse' | 'rule'
  cash_min_p50: number; cfar: number; cfar_ci: [number, number]
  p_breach: number; p_breach_ci: [number, number]; t_breach_p10: number
  dscr_min_p05: number; p_covenant: number
  debt_peak: number; debt_peak_share: number; int_cost: number; wc_avg: number; tax_paid: number
  profit_mean: number; profit_cvar: number
  npv_owner_mean: number; npv_bank_mean: number; p_npv_owner_neg: number
  identities_max_residual: number
  cash: PeriodQuantiles
}
export interface CashLpSummary {
  status: string; reason?: string; objective: number; lp_objective: number
  expected: number; cvar: number; worst: number; cfar: number; p_negative_cash: number
  eta: number; zeta: number; solve_ms: number; n_vars: number; n_rows: number; n_nonzeros: number
}
export interface PolPoint extends Partial<CashLpSummary> {
  l_min: number; status: string; pol?: number; pol_ci?: [number, number]; pol_objective?: number; local_dual?: number
}
export interface CashLpResult extends CashLpSummary {
  solver: string; solver_version: string; n_scenarios: number; horizon_weeks: number; runoff_weeks: number
  beta: number; l_min: number; financing_stage: 'recourse' | 'first'
  shipment_profile: { source: 'plan' | 'uniform'; plan_id: string; products_from_plan: number }
  fixed_weekly: number; weekly_rate: number; tail_k: number; tail_k_beta: number
  portfolio: Array<{ product_id: string; qty: number; qty_rounded: number }>
  duals: {
    capacity: Array<{ wc_type: string; shadow_price: number; utilization: number; load_hours: number; capacity_hours: number; binding: boolean }>
    liquidity: number; liquidity_binding: boolean; price_of_liquidity_local: number; credit_limit: number
  }
  tranches: { drawdown: PeriodQuantiles; repayment: PeriodQuantiles; debt: PeriodQuantiles; cash: PeriodQuantiles }
  oos: { gross_expected: number; gross_cvar: number; expected: number; cvar: number; gap_expected: number; gap_cvar: number }
  fixed_schedule: CashLpSummary & {
    price_of_inflexible_financing?: number; delta_expected?: number; delta_expected_ci?: [number, number]
    schedule?: Array<{ t: number; drawdown: number; repayment: number }>
  }
  price_of_liquidity?: { l_min: number; value: number; ci: [number, number]; objective_delta: number; local_dual: number; definition: string }
  pol_curve?: PolPoint[]
  unconstrained: CashLpSummary
  waterfall: { lp_recourse: CashWaterfallKpi; rule: CashWaterfallKpi }
  /** Волна M: источник ставки линии по сценарию/неделе (MacroSampler | fin_params) и её квантили по неделям. */
  key_rate?: { source: 'MacroSampler' | 'fin_params'; annual?: PeriodQuantiles | null }
  /** E1 (eval_portfolio): заданный план, валовые метрики и водопад по правилу; per_scenario — для парного бутстрепа. */
  fixed_portfolio?: {
    items: Array<{ product_id: string; qty: number }>
    gross: { expected: number; cvar: number; worst: number }
    waterfall_rule: CashWaterfallKpi
    per_scenario: { profit: number[]; min_cash: number[]; breach: number[]; interest: number[] }
  }
  total_ms: number
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
  job_idx: number
  order_idx: number; product_id: string; product_name: string
  op_id: string; op_name: string; wc_type_id: string; wc_name: string
  machine_id: string; machine_name: string; worker: number
  start: number; end: number; due: number; late: boolean
}
/** Ручная правка Ганта: операция стартует не раньше start_hours (на своём станке). */
export interface SchedPin { job_idx: number; start_hours: number; machine_id?: string }
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
  labor_cost?: number
  n_setups?: number; setup_hours?: number
  maintenance_hours?: number; breakdown_hours_mean?: number
  flow_time_mean_h?: number; wait_share?: number; wip_avg?: number; throughput_per_day?: number
}
/** ГА поверх диспетч-правил (Стадия 1): обучение на NS сценариях, проверка на отложенных. */
export interface SchedImprover {
  method?: 'ga'
  iterations: number; accepted: number
  score_before: number; score_after: number; improvement_pct: number
  adopted?: boolean
  population?: number; evaluations?: number; seeds?: number; genes?: number
  stopped?: 'generations' | 'stall' | 'time'
  train_scenarios?: number
  validation?: { scenarios: number; score_rule: number; score_ga: number; improvement_pct: number }
  /** Найденное составное правило: веса нормированных критериев (+ сдвиги заказов). */
  weights?: { due: number; rem: number; duration: number; inputs: number; setup: number }
  history?: Array<{ gen: number; best: number; mean: number }>
  makespan_mean_rule?: number; makespan_mean_final?: number
}
/* ── Волна A: агент RL — статус политики, структурные ходы (контракт UX-V2 §4.7) ───── */
export type MoveKind = 'reroute' | 'reassign' | 'reorder' | 'split' | 'merge' | 'transfer'
  | 'outsource' | 'shift' | 'drop' | 'finance' | 'shift_plus' | 'shift_minus'
export type MoveStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'frozen'
export interface MoveImpact {
  profit: { e_before: number; e_after: number; cvar_before: number; cvar_after: number }
  cash: { min_cash_cvar_before: number; min_cash_cvar_after: number; p_gap_before: number; p_gap_after: number }
  schedule: { cmax_e_delta_h: number; cmax_cvar_delta_h: number; otd_delta: number; tardiness_delta_h: number }
  /** На тех же N сценариях (CRN): доля прогонов, где пакет лучше, и бутстреп-ДИ выигрыша CVaR(Π). */
  win_share: number
  ci95: [number, number]
}
export interface MoveJustification {
  regime: { id: string; label: string; share: number }
  scenarios: Array<{ idx: number; key_rate?: number; fx?: number; price_shock?: number; lead_delay_h?: number; gain: number }>
  map_nodes: string[]
  text?: string
}
export interface StructuralMove {
  id: string
  kind: MoveKind
  status: MoveStatus
  targets: { order_idx?: number[]; op_ids?: string[]; machine_ids?: string[]; product_ids?: string[]; org_unit_ids?: string[] }
  before: Record<string, unknown>
  after: Record<string, unknown>
  impact: MoveImpact
  justification: MoveJustification
  depends_on?: string[]
  masks_checked: string[]
  proposed_at: string
  agent: { level: 'L0' | 'L2'; policy_version: string; seed: number }
  week?: number
}
export interface AgentGuardrails {
  alpha: number
  objective: 'cvar_profit' | 'cvar_profit_cash' | 'cvar_cash'
  allowed: Record<string, boolean>
  limits: { max_moves: number; max_orders_share: number; max_shift_days: number; max_outsource_share: number }
  frozen: Array<{ op_id?: string; order_idx?: number; machine_id?: string; reason?: string }>
  rejected_masks: Array<{ kind: MoveKind; targets: StructuralMove['targets']; reason: string }>
  owner: 'project' | 'run'
}
export interface MovesResult {
  run_id: string
  baseline_run_id: string
  moves: StructuralMove[]
  totals: MoveImpact
  guardrails: AgentGuardrails
  n_scenarios?: number
  l2_makespan_h?: number
}
export interface RlPolicyInfo { ok: boolean; path: string; sha256: string; obs_size: number; act_size: number; meta: Record<string, unknown> }
export interface RlStatus { available: boolean; onnxruntime: boolean; dir: string; error: string; l0: RlPolicyInfo; l2: RlPolicyInfo; note: string }
/** Сводка правила RL в событийной среде (по средним длительностям). */
export interface RlEval { makespan_h: number; tardiness_h: number; n_decisions: number; n_wait: number; policy_sha256: string }
export interface RlInstanceParams { program?: Array<{ product_id: string; qty: number; due_hours?: number }>; use_calendar?: boolean }

export interface ScheduleResult {
  rule: string; samples: number; alpha: number
  weights: { time: number; cost: number; risk: number }
  n_orders: number; n_jobs: number; n_machines: number; n_workers: number
  program: Array<{ product_id: string; product_name: string; qty: number; due_hours: number }>
  gantt: GanttJob[]; machine_load: SchedLoad[]; wc_load: SchedLoad[]; worker_plan: WorkerPlan[]
  queue_timeline?: Array<{ t: number; queued: number; top_wc: string; top_wc_n: number }>
  queue_by_wc?: Array<{ wc_type_id: string; wc_name: string; peak: number; points: Array<{ t: number; queued: number }> }>
  bottleneck: { wc_type_id: string; wc_name: string; utilization: number }
  idle: { machine_idle_hours: number; machine_utilization: number }
  calendar: { enabled: boolean; work_fond_hours: number }
  kpi: SchedKpi; rules: SchedRule[]; warnings: string[]
  portfolio_horizon_hours?: number
  improver?: SchedImprover | null
  /** Волна A: структурные ходы агента L2 (rule='RL'); null без RL. */
  moves?: MovesResult | null
  rl?: RlEval | null
  plan_id?: string; error_soft?: boolean
}
export interface ScheduleParams {
  /** R5: писать stage1_feedback (поправку мощности для Стадии 2) — только явно. */
  apply_feedback?: boolean
  run_id?: string; rule?: string; w_time?: number; w_cost?: number; w_risk?: number
  samples?: number; alpha?: number; tail_weight?: number; use_calendar?: boolean
  program?: Array<{ product_id: string; qty: number; due_hours?: number }>
  pins?: SchedPin[]; improve_iters?: number
  /** Конструктор эвристики: критерии с весами (знак = направление, меньший key — раньше). */
  custom_rule?: Array<{ criterion: 'duration' | 'due' | 'rem' | 'inputs' | 'setup'; weight: number }>
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
  planned_qty?: number; level?: number
  need_by_hours?: number; place_by_hours?: number; late?: boolean
}
export interface MrpResult { feasible: boolean; materials: MrpMaterial[]; n_orders: number }

/* ── Производственная программа (заказы) ─────────────────────────────────── */
export interface DemandOrder {
  id: string; plan_id: string; product_id: string; quantity: string; due_hours: string
  release_hours: string; priority: string; status: string; created_at: string
}
export interface ProductionPlan { id: string; name: string; description: string; created_at: string }

/* ── Имитационный режим (3D-плеер плана + калибровка НСИ) ─────────────────── */
export interface SimTaskDto {
  machine_id: string; product_id: string; product_name: string
  op_id: string; op_name: string; order_idx: number
  worker_id?: string; worker_name?: string
  start: number; end: number   // часы от начала плана
}
export interface SimPlanSummary { id: string; created_at: string; n_tasks: string; makespan: string }
export interface SimResults {
  plan_id: string | null; makespan: number
  n_machines: number; n_workers: number
  required_operators: number; avg_operators: number; avg_utilization: number
  throughput_per_day: number; n_orders: number
  util_series: Array<{ t: number; util: number; busy: number }>
  workers_series: Array<{ t: number; workers: number }>
  per_machine: Array<{ machine_id: string; name: string; busy_hours: number; utilization: number }>
}
export interface SimPlan {
  plan_id: string | null; created_at?: string; makespan: number; tasks: SimTaskDto[]
}
export interface KpiBundle {
  plan_id: string | null; created_at?: string
  kpi: Record<string, number>   // makespan/otd/tardiness/utilization/cost/setup/wait/wip/…
  wc_load?: Array<{ wc_type_id: string; wc_name?: string; utilization: number; busy_hours: number; idle_hours: number }>
  bottleneck?: { wc_type_id?: string; wc_name?: string; utilization?: number }
  queue_by_wc?: Array<{ wc_type_id?: string; wc_name?: string; peak?: number }>
}
export interface InvestmentResult {
  wc_type_id: string; add_machines: number
  capex: number; plan_months: number; life_months: number; discount_annual: number
  profit_before: number; profit_after: number
  delta_profit_horizon: number; delta_cf_month: number
  payback_months: number      // -1 = не окупается
  npv: number; irr_annual: number; roi: number
  util_before: number; util_after: number
  next_bottleneck: { wc_type_id: string; wc_name: string; utilization: number }
}
export interface CalibRow {
  op_id: string; op_name: string; product_name: string
  t_norm: number; realized_mean: number; n: number; delta_pct: number
}

/* ── API surface ─────────────────────────────────────────────────────────── */
// Стадия E+: прогноз цен во времени под макрофакторами.
export interface ForecastParams {
  months?: number; inflation?: number; fx?: number; demand?: number
  volatility?: number; corr?: number; runs?: number; scenario_id?: string
  backtest?: number   // k месяцев истории для out-of-sample проверки (0 = выкл)
  /** Волна M: стресс/опора для веера ключевой ставки (MacroSampler). */
  macro_stress?: MacroStress; macro_ref?: MacroRef
}
export interface ForecastFit {
  data_driven: boolean; dist: 'normal' | 'laplace' | 't' | 'stable'; n_obs: number
  mu: number; sigma: number; nu?: number; alpha?: number
  aic_normal: number; aic_laplace: number; aic_t?: number; aic_stable?: number
}
export interface ForecastBacktest {
  k: number; mape: number; mape_naive: number; skill: number
  pinball10: number; pinball90: number; coverage80: number
}
export interface ForecastContrib {
  hist_trend: number; inflation: number; risk_drift: number
  fx: number; demand: number; macro: number; total: number
}
export interface ForecastProduct {
  id: string; name: string; role: 'product' | 'raw' | 'rate'; base: number
  p10: number[]; p50: number[]; p90: number[]; mean: number[]
  history?: number[]; trend?: number[]
  fit?: ForecastFit
  backtest?: ForecastBacktest
  contrib?: ForecastContrib
  /** Волна M: веер ставки — из обученного генератора (synthetic=false) или синтетического macro_ts. */
  synthetic?: boolean; source?: string; regimes?: number; stress?: MacroStress
}
export interface ForecastResult {
  months: number; inflation_monthly: number; fx: number; demand: number
  volatility: number; corr: number; mode?: string; scenario_id?: string
  inflation_index: number[]
  rate?: ForecastProduct | null
  products: ForecastProduct[]
  /** Волна M (§3.3, R7): истории цен ts_data синтетические → бейдж «демонстрационные данные». */
  synthetic: boolean; demo: boolean; note?: string
  /** @deprecated поля-ползунки, которые больше не участвуют в расчёте. */
  deprecated_fields: string[]
  macro: { available: boolean; error: string }
}

export const api = {
  health: () => get<{ status: string; version: string; project?: string }>('/health'),

  auth: {
    login: (login: string, password: string, db?: string) =>
      post<{ token: string; login: string; role: string; permissions: string[]; org_unit_id?: string }>(
        '/auth/login', { login, password, db }),
  },

  projects: {
    list: () => get<{ projects: string[]; current: string }>('/projects'),
  },

  /** Волна A: политика RL (правило «RL» Стадии 1) и экспорт экземпляра для стенда rl/. */
  rl: {
    status: () => get<RlStatus>('/rl/status'),
    instance: (p: RlInstanceParams = {}) => post<Record<string, unknown> & { name: string; n_orders: number }>('/rl/instance', p),
  },

  simulation: {
    plans: () => get<SimPlanSummary[]>('/simulation/plans'),
    plan: (planId?: string) => get<SimPlan>(planId ? `/simulation/plan?plan_id=${planId}` : '/simulation/plan'),
    results: (planId?: string) => get<SimResults>(planId ? `/simulation/results?plan_id=${planId}` : '/simulation/results'),
    calibration: () => get<{ plan_id: string | null; rows: CalibRow[] }>('/simulation/calibration'),
    calibrate: (items: Array<{ op_id: string; t_norm: number }>) =>
      post<{ updated: number }>('/simulation/calibrate', { items }),
  },

  analytics: {
    /** Полный KPI-блок плана (persisted при построении расписания). */
    kpi: (planId?: string) => get<KpiBundle>(planId ? `/analytics/kpi?plan_id=${planId}` : '/analytics/kpi'),
    /** KPI по всем построенным планам (по возрастанию времени) — ряд для настраиваемых графиков. */
    kpiSeries: () => get<KpiBundle[]>('/analytics/kpi_series'),
    /** Инвестпроект: докупка N станков типа → окупаемость/NPV/IRR через рынок+мощность. */
    investment: (p: {
      wc_type_id: string; add_machines: number; machine_capex: number
      discount_rate?: number; life_months?: number; scenario_id?: string
      samples?: number; demand?: number; horizon_hours?: number
    }) => post<InvestmentResult>('/analytics/investment', p),
  },

  /** KV-настройки на уровне проекта-БД (дашборд «Аналитики» и т.п.). */
  prefs: {
    get: <T>(key: string) => get<{ key: string; value: T | null }>(`/prefs/${encodeURIComponent(key)}`).then((r) => r.value),
    set: (key: string, value: unknown) => put<{ key: string; ok: boolean }>(`/prefs/${encodeURIComponent(key)}`, { value }),
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
    createUser: (u: UserCreate) => post<{ id: string; login: string }>('/users', u),
    updateUser: (id: string, patch: UserPatch) => put<Record<string, never>>(`/users/${id}`, patch),
  },

  orgUnits: {
    list:   ()                          => get<OrgUnit[]>('/org_units'),
    create: (d: { name: string; parent_id?: string; kind?: string }) => post<OrgUnit>('/org_units', d),
    update: (id: string, d: Partial<OrgUnit>) => put<OrgUnit>(`/org_units/${id}`, d),
    delete: (id: string)                => del<object>(`/org_units/${id}`),
  },

  scheme: {
    get: () => get<SchemeAggregate>('/scheme'),
    processFlows: () => get<Array<{ from_id: string; to_id: string }>>('/scheme/process_flows'),
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
    runCash: (p: OptimizeParams) => post<OptResult>('/optimize/cash', p),
    runs: ()                   => get<OptRunSummary[]>('/optimize/runs'),
    run_get: (id: string)      => get<OptResult>(`/optimize/runs/${id}`),
    savePlan: (runId: string, planName: string) =>
      post<{ id: string; name: string; orders: number }>('/optimize/save-plan', { run_id: runId, plan_name: planName }),
  },

  finance: {
    params: ()                        => get<FinParams>('/fin_params'),
    saveParams: (p: Partial<FinParams>) => put<FinParams>('/fin_params', p),
    passport: ()                      => get<PassportList>('/passport'),
    updatePassport: (code: string, p: Partial<PassportParam> & { n_obs?: number }) =>
      put<PassportParam>(`/passport/${encodeURIComponent(code)}`, p),
  },

  schedule: {
    run: (p: ScheduleParams) => post<ScheduleResult>('/schedule', p),
  },

  forecast: (p: ForecastParams) => post<ForecastResult>('/forecast', p),

  /** Волна M: обученный макро-генератор (режимы вместо ползунков; §2.6б). */
  macro: {
    regimes: ()                      => get<MacroRegimes>('/macro/regimes'),
    summary: ()                      => get<MacroSummary>('/macro/summary'),
    sample:  (p: MacroSampleParams)  => post<MacroSampleResult>('/macro/sample', p),
  },

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
