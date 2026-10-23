/**
 * Вход `deriveState()` — всё, что фронтенд уже знает о текущем контексте:
 * активный сценарий, размеры справочников, последние ответы Стадии 2 / Стадии 1,
 * KPI и прогноз. Поля необязательные: чего нет — считается неизвестным, а не нулём.
 */
import type { AgentGuardrails, CashLpResult, FinParams, ForecastResult, KpiBundle, MacroSummary, PassportParam, PriceScenario, RlStatus, ScheduleResult, WorkCalendar } from '../../lib/api'
import type { OptForm } from '../optimization/optStore'
import type { OptResultExt } from '../optimization/optTypes'
import type { PlanParams } from '../plan/planStore'
import type { DecisionContextRef } from './types'

export interface RefCounts {
  products: number
  sellable: number
  purchased: number
  machines: number
  wcTypes: number
  /** Типы РЦ с заданным MTBF (поломки). */
  wcTypesWithMtbf: number
  workers: number
  routings: number
  operations: number
  scenarios: number
}

export interface DeriveInput {
  context: DecisionContextRef
  scenario: PriceScenario | null
  counts: RefCounts
  calendar: WorkCalendar | null
  opt: { result: OptResultExt | null; ranAt: number | null; running: boolean; form: OptForm }
  plan: { result: ScheduleResult | null; builtAt: number | null; running: boolean; params: PlanParams }
  kpi: KpiBundle | null
  forecast: ForecastResult | null
  /** Волна G2: серверный паспорт по коду (GET /api/passport); null — недоступен, бейджи по умолчаниям кода. */
  passport: Readonly<Record<string, PassportParam>> | null
  /** Волна F: финансовые параметры водопада (GET /api/fin_params). */
  fin: FinParams | null
  /** Волна M: сводка обученного макро-генератора (GET /api/macro/summary). */
  macro: MacroSummary | null
  /** Волна F: последний результат CVaR-LP с кассой (POST /api/optimize/cash) и когда он получен. */
  cash: { result: CashLpResult | null; ranAt: number | null; running: boolean }
  /** Волна A: статус политики RL (GET /api/rl/status); undefined — ещё не получен. */
  rl?: RlStatus | null
  /** Полномочия агента (prefs agent_guardrails или локально); undefined — не загружены. */
  guardrails?: AgentGuardrails | null
  /** Момент расчёта (мс); для тестов — детерминированный. */
  now: number
}

export const EMPTY_COUNTS: RefCounts = {
  products: 0, sellable: 0, purchased: 0, machines: 0, wcTypes: 0, wcTypesWithMtbf: 0,
  workers: 0, routings: 0, operations: 0, scenarios: 0,
}

export const EMPTY_OPT_FORM: OptForm = {
  scenarioId: '', objective: 'cvar', samples: '3000', alpha: '0.10', maxShare: '0.35', horizonMonths: '12', exact: false,
}

export const EMPTY_PLAN_PARAMS: PlanParams = { rule: 'auto', samples: '500', wRisk: '0.5', runId: '', useCalendar: true }

/** Пустой вход: нет проекта и справочников — карта рисуется полностью, все блоки `unconfigured`. */
export function emptyInput(now = 0): DeriveInput {
  return {
    context: {},
    scenario: null,
    counts: EMPTY_COUNTS,
    calendar: null,
    opt: { result: null, ranAt: null, running: false, form: EMPTY_OPT_FORM },
    plan: { result: null, builtAt: null, running: false, params: EMPTY_PLAN_PARAMS },
    kpi: null,
    forecast: null,
    passport: null,
    fin: null,
    macro: null,
    cash: { result: null, ranAt: null, running: false },
    now,
  }
}
