/**
 * Планирование, сценарии и результат (ТЗ «Производственный план»,
 * «Оптимизация», «Эвристики», «Сценарии моделирования»; REQUIREMENTS.md §1).
 */
import type { Id } from './nsi'

/* ── Производственная программа ──────────────────────────────────────── */

export interface DemandOrder {
  id: Id
  assembly: Id
  plannedFinishDate: string
  quantity: number
  priority?: number
  releaseDate?: string
}

/* ── Сценарий ────────────────────────────────────────────────────────── */

export type ScenarioMode = 'детерминированный' | 'стохастический'
export type SchedulingMethod = 'rule' | 'metaheuristic' | 'cp-sat'

/** Веса целевой функции F = w_time·ВРЕМЯ + w_cost·СТОИМОСТЬ + w_risk·РИСК. */
export interface ObjectiveWeights {
  time: number
  cost: number
  risk: number
}

export type ScenarioOverride =
  | { kind: 'extraShift'; resourceId: Id; date: string; startTime: string; endTime: string }
  | { kind: 'machineDown'; machineId: Id; from: string; to: string }
  | { kind: 'orderPriority'; orderId: Id; priority: number }
  | { kind: 'stockLevel'; itemId: Id; onHand: number }

export interface Scenario {
  id: Id
  name: string
  beginDate: string
  endDate: string
  mode: ScenarioMode
  objectiveWeights: ObjectiveWeights
  method: SchedulingMethod
  methodParams?: { timeBudgetSec?: number; seed?: number }
  dataVersion?: string
  overrides?: ScenarioOverride[]
}

/* ── Результат планирования ──────────────────────────────────────────── */

export type PlanTaskStatus = 'план' | 'в работе' | 'выполнено'

export interface PlanTask {
  operationId: Id
  productOrderId: Id
  machineId: Id
  workerId?: Id
  start: string
  end: string
  batchId?: Id
  status: PlanTaskStatus
}

/** Сводные KPI плана (время/стоимость/риск). */
export interface PlanKpi {
  makespan: number
  tardiness: number
  utilization: number
  wip: number
  setups: number
  /** On-Time Delivery, доля. */
  otd: number
}

export interface Plan {
  id: Id
  scenarioId: Id
  tasks: PlanTask[]
  kpi: PlanKpi
}

/** Диспетчерские правила-генераторы порядка (ТЗ «Эвристики»). */
export type DispatchRule =
  | 'SPT'
  | 'LPT'
  | 'EDD'
  | 'CR'
  | 'MWKR'
  | 'LWKR'
  | 'MS'
  | 'FIFO'
