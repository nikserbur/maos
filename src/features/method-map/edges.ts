/**
 * Рёбра карты (UX-V2 §3.3): data — поток данных/сценариев; param — формула ← параметр;
 * feedback — обратная связь против потока; control — управляющее воздействие
 * (сверху, как C в IDEF0); explain — объяснение. `payload` — имя поля API.
 */
import type { MapEdge } from './types'

/** Рёбра уровня L0 — между блоками. Петля RL: [6] потребляет [1]–[3], пишет обратно в [4]. */
export const L0_EDGES: readonly MapEdge[] = [
  { id: 'e.1-2', from: 'external', to: 'distributions', kind: 'data', label: 'макро-факторы', payload: 'inflation, fx, key_rate, demand, volatility' },
  { id: 'e.2-3', from: 'distributions', to: 'internal', kind: 'data', label: 'хвосты и сроки', payload: 'tail_weight, tail_index, lead_time' },
  { id: 'e.3-4', from: 'internal', to: 'decisions', kind: 'data', label: 'мощности · MRP · маски', payload: 'capacity_hours, feasible, operation_wc_types' },
  { id: 'e.4-5', from: 'decisions', to: 'criteria', kind: 'data', label: 'распределения прибыли и Cmax', payload: 'histogram, kpi' },
  { id: 'e.2-4', from: 'distributions', to: 'decisions', kind: 'data', label: 'N сценариев цен', payload: 'price_distributions → samples' },
  { id: 'e.5-4', from: 'criteria', to: 'decisions', kind: 'control', label: 'критерий поиска', payload: 'objective, alpha, w_risk' },
  /* Петля агента */
  { id: 'e.1-6', from: 'external', to: 'agents', kind: 'data', label: 'режимы', payload: 'regime[]' },
  { id: 'e.2-6', from: 'distributions', to: 'agents', kind: 'data', label: 'тяжёлые хвосты', payload: 'samples' },
  { id: 'e.3-6', from: 'internal', to: 'agents', kind: 'data', label: 'маски допустимости', payload: 'masks' },
  { id: 'e.6-4', from: 'agents', to: 'decisions', kind: 'feedback', label: 'структурные ходы', payload: 'moves[]' },
  { id: 'e.5-6', from: 'criteria', to: 'agents', kind: 'control', label: 'α, веса, CFaR', payload: 'agent_guardrails' },
  /* Стадия 1 → Стадия 2 — уточнённые мощности (петля внутри [4]) */
  { id: 'e.4-4', from: 'decisions', to: 'decisions', kind: 'feedback', label: 'Стадия 1 → Стадия 2', payload: 'stage1_calibrated, calendar_factor' },
  /* Мониторинг */
  { id: 'e.4-7', from: 'decisions', to: 'monitoring', kind: 'data', label: 'план → план-факт', payload: 'plan_id, kpi_json' },
  { id: 'e.1-7', from: 'external', to: 'monitoring', kind: 'data', label: 'прогноз · бэктест', payload: 'backtest' },
  { id: 'e.7-2', from: 'monitoring', to: 'distributions', kind: 'feedback', label: 'план-факт → нормы', payload: 'calibration' },
  /* LLM */
  { id: 'e.8-4', from: 'llm', to: 'decisions', kind: 'explain', label: 'почему так', payload: 'explain(nodeId)' },
  { id: 'e.8-5', from: 'llm', to: 'criteria', kind: 'explain', label: 'что определило результат' },
]

/** Рёбра уровня подблоков и параметров (показываются в панели узла). */
export const DETAIL_EDGES: readonly MapEdge[] = [
  { id: 'e.ext.macro-prices', from: 'ext.macro', to: 'ext.prices', kind: 'data', label: 'инфляция, курс, спрос', payload: 'ForecastParams' },
  { id: 'e.ext.prices-dist', from: 'ext.prices', to: 'dist.prices', kind: 'data', label: 'центр и σ по истории', payload: 'fit' },
  { id: 'e.dist.prices-portfolio', from: 'dist.prices', to: 'dec.portfolio', kind: 'data', label: 'сценарии цен', payload: 'price_distributions' },
  { id: 'e.dist.dur-schedule', from: 'dist.durations', to: 'dec.schedule', kind: 'data', label: 'длительности Монте-Карло', payload: 'samples, tail_weight' },
  { id: 'e.dist.break-schedule', from: 'dist.breakdowns', to: 'dec.schedule', kind: 'data', label: 'поломки и ТО', payload: 'mtbf_hours, repair_hours' },
  { id: 'e.int.cap-portfolio', from: 'int.capacity', to: 'dec.portfolio', kind: 'data', label: 'фонд мощностей', payload: 'capacity_hours' },
  { id: 'e.int.cap-schedule', from: 'int.capacity', to: 'dec.schedule', kind: 'data', label: 'станки × календарь', payload: 'machines, calendar' },
  { id: 'e.int.labor-schedule', from: 'int.labor', to: 'dec.schedule', kind: 'data', label: 'операторы', payload: 'workers' },
  { id: 'e.int.routes-schedule', from: 'int.routes', to: 'dec.schedule', kind: 'data', label: 'граф операций', payload: 'routings, operation_wc_types' },
  { id: 'e.int.mrp-schedule', from: 'int.mrp', to: 'dec.schedule', kind: 'data', label: 'дата запуска', payload: 'release_hours' },
  { id: 'e.portfolio-schedule', from: 'dec.portfolio', to: 'dec.schedule', kind: 'data', label: 'программа', payload: 'portfolio_items, horizon_hours' },
  { id: 'e.schedule-portfolio', from: 'dec.schedule', to: 'dec.portfolio', kind: 'feedback', label: 'уточнённые мощности', payload: 'stage1_calibrated, calendar_factor' },
  { id: 'e.portfolio-profit', from: 'dec.portfolio', to: 'crit.profit', kind: 'data', label: 'распределение прибыли', payload: 'histogram, metrics' },
  { id: 'e.schedule-crit', from: 'dec.schedule', to: 'crit.schedule', kind: 'data', label: 'KPI расписания', payload: 'kpi' },
  { id: 'e.alpha-cvar', from: 'crit.profit.alpha', to: 'crit.profit.f.cvar', kind: 'param', label: 'α' },
  { id: 'e.alpha-var', from: 'crit.profit.alpha', to: 'crit.profit.f.var', kind: 'param', label: 'α' },
  { id: 'e.alpha-mcvar', from: 'crit.profit.alpha', to: 'crit.schedule.f.makespan_cvar', kind: 'param', label: 'α' },
  { id: 'e.wrisk-score', from: 'dec.schedule.w_risk', to: 'dec.schedule.f.rule_score', kind: 'param', label: 'w_risk' },
  { id: 'e.tail-makespan', from: 'dist.durations.tail_weight', to: 'dec.schedule.f.makespan', kind: 'param', label: 'tail_weight' },
  { id: 'e.beta-aic', from: 'dist.prices.beta_default', to: 'dist.prices.f.aic', kind: 'param', label: 'β' },
  { id: 'e.rl-schedule', from: 'ag.rl', to: 'dec.schedule', kind: 'feedback', label: 'ходы агента', payload: 'moves[]' },
  { id: 'e.guard-rl', from: 'ag.guardrails', to: 'ag.rl', kind: 'control', label: 'маски и лимиты', payload: 'agent_guardrails' },
  { id: 'e.profit-rl', from: 'crit.profit', to: 'ag.rl', kind: 'control', label: 'цель агента = цель пользователя', payload: 'alpha, objective' },
  { id: 'e.schedule-planfact', from: 'dec.schedule', to: 'mon.planfact', kind: 'data', label: 'план', payload: 'plan_id' },
  { id: 'e.prices-forecast', from: 'ext.prices', to: 'mon.forecast', kind: 'data', label: 'веер', payload: 'ForecastResult' },
  { id: 'e.planfact-identify', from: 'mon.planfact', to: 'dist.identify', kind: 'feedback', label: 'факт по операциям', payload: 'CalibRow[]' },
  { id: 'e.explain-crit', from: 'llm.explain', to: 'crit.profit', kind: 'explain', label: '«i» → формула' },
  { id: 'e.mentat-schedule', from: 'llm.mentat', to: 'dec.schedule', kind: 'explain', label: 'почему так', payload: 'explain(nodeId)' },
]

export const ALL_EDGES: readonly MapEdge[] = [...L0_EDGES, ...DETAIL_EDGES]
