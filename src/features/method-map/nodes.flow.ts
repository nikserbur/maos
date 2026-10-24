/**
 * Узлы основного потока карты: [1] Внешние условия → [2] Распределения →
 * [3] Внутренние условия → [4] Решения → [5] Критерии (METHODOLOGY-V2 §2–§6).
 * Подблоки и их дети: параметры (паспорт), формулы (реестр «i»), датасеты, экраны.
 */
import type { MapNode } from './types'

/** Параметры-дети подблока: id узла = `<parent>.<param>`. */
function params(parent: string, block: MapNode['block'], ids: readonly string[]): MapNode[] {
  return ids.map((paramId) => ({
    id: `${parent}.${paramId.split('.').pop()}`, kind: 'parameter', block, parent, paramId,
    title: paramId, shape: 'square',
  }))
}

/** Формулы-дети подблока: id узла = `<parent>.f.<metric>`. */
function formulas(parent: string, block: MapNode['block'], ids: readonly string[]): MapNode[] {
  return ids.map((metricId) => ({
    id: `${parent}.f.${metricId.split('.').pop()}`, kind: 'formula', block, parent, metricId,
    title: metricId, shape: 'point',
  }))
}

export const FLOW_NODES: readonly MapNode[] = [
  /* ── [1] Внешние условия ──────────────────────────────────────────────── */
  { id: 'ext.macro', kind: 'subblock', block: 'external', parent: 'external', shape: 'point',
    title: 'Макро-условия сценария', short: 'Инфляция, волатильность, корреляция, курс и спрос прогноза цен — поля сценария с паспортом; ползунки санкций/энергии/логистики/ставки приняты API, но с волны M не используются.',
    screen: { id: 'scenarios', anchor: 'conditions' }, learnMore: 'overview', stage: 'done' },
  ...params('ext.macro', 'external', ['scenario.inflation', 'scenario.volatility', 'scenario.market_corr', 'scenario.fx', 'scenario.demand',
    'scenario.months', 'scenario.key_rate', 'scenario.energy', 'scenario.logistics', 'scenario.sanctions', 'scenario.tax_change']),
  { id: 'ext.macro.screen', kind: 'screen', block: 'external', parent: 'ext.macro', title: 'Сценарии · условия',
    screen: { id: 'scenarios', anchor: 'conditions' } },

  { id: 'ext.prices', kind: 'subblock', block: 'external', parent: 'external', shape: 'point',
    title: 'Цены сбыта и сырья', short: 'История цен → тренд (EMD) + гармоники + случайный остаток; веер P10/P50/P90 под макрофакторами.',
    screen: { id: 'monitoring' }, diagram: 'forecast-decomposition', learnMore: 'forecast-decomposition', stage: 'done', action: 'forecast' },
  ...formulas('ext.prices', 'external', ['forecast.fan', 'forecast.trend', 'forecast.inflation', 'forecast.factors']),
  { id: 'ext.prices.ds', kind: 'dataset', block: 'external', parent: 'ext.prices', title: 'История цен (ts_data)',
    dataset: { table: 'ts_data', registry: 'products' }, screen: { id: 'nsi', anchor: 'products' } },

  { id: 'ext.generator', kind: 'subblock', block: 'external', parent: 'external', shape: 'disc',
    title: 'Макро-генератор VAR → SVD → HMM → блоки', short: 'Совместный процесс «ставка–курс–инфляция» по рядам Банка России 2013-09…2026-09 (волна M): 2 режима, блок 4 мес, выбор по CRPS; pass-through на цены и сырьё [К].',
    screen: { id: 'scenarios', anchor: 'conditions' }, learnMore: 'overview', stage: 'done' },
  ...params('ext.generator', 'external', ['macro.generator', 'macro.selection_crps', 'macro.holdout_coverage80', 'macro.pt_cpi', 'macro.pt_fx_product', 'macro.pt_fx_raw']),
  ...formulas('ext.generator', 'external', ['forecast.crps']),
  { id: 'ext.generator.ds', kind: 'dataset', block: 'external', parent: 'ext.generator', title: 'Ряды ЦБ РФ (macro_series, synthetic = 0)',
    dataset: { table: 'macro_series' } },
  { id: 'ext.regimes', kind: 'subblock', block: 'external', parent: 'external', shape: 'point',
    title: 'Режимы и стрессы', short: 'Меню «Базовый (прогноз) / режим навязан / квантильный стресс / исторический эпизод / опора» вместо ползунков (METHODOLOGY-V2 §2.6б); каждый выбор — в манифест прогона.',
    screen: { id: 'scenarios', anchor: 'conditions' }, learnMore: 'overview', stage: 'done' },
  ...params('ext.regimes', 'external', ['macro.mode', 'macro.ref_key']),

  /* ── [2] Распределения ────────────────────────────────────────────────── */
  { id: 'dist.prices', kind: 'subblock', block: 'distributions', parent: 'distributions', shape: 'disc',
    title: 'Распределения цен', short: 'Тип (normal/lognormal/t/Pareto), центр, σ, β к рыночному фактору — по изделию; семейство подбирается по AIC.',
    screen: { id: 'scenarios', anchor: 'distributions' }, diagram: 'correlation-diversification',
    learnMore: 'correlation-diversification', stage: 'done', action: 'estimate' },
  ...params('dist.prices', 'distributions', ['dist.sigma_default', 'dist.beta_default']),
  ...formulas('dist.prices', 'distributions', ['forecast.aic']),
  { id: 'dist.prices.ds', kind: 'dataset', block: 'distributions', parent: 'dist.prices', title: 'price_distributions',
    dataset: { table: 'price_distributions', registry: 'scenarios' }, screen: { id: 'scenarios', anchor: 'distributions' } },

  { id: 'dist.durations', kind: 'subblock', block: 'distributions', parent: 'distributions', shape: 'disc',
    title: 'Хвосты длительностей', short: 'PERT (t_opt/t_norm/t_pess) → lognormal + примесь Парето; вес и индекс хвоста по операции.',
    screen: { id: 'nsi', anchor: 'operations' }, diagram: 'heavy-tail', learnMore: 'heavy-tail', stage: 'done' },
  ...params('dist.durations', 'distributions', ['op.tail_weight', 'op.tail_index']),
  { id: 'dist.durations.ds', kind: 'dataset', block: 'distributions', parent: 'dist.durations', title: 'operations · time_norms',
    dataset: { table: 'operations', registry: 'operations' }, screen: { id: 'nsi', anchor: 'operations' } },

  { id: 'dist.breakdowns', kind: 'subblock', block: 'distributions', parent: 'distributions', shape: 'disc',
    title: 'Поломки и ремонт', short: 'Интенсивность отказов от загрузки (MTBF), лог-нормальный ремонт, плановое ТО по типам РЦ.',
    screen: { id: 'nsi', anchor: 'work_center_types' }, learnMore: 'kpi-definitions', stage: 'done' },
  ...formulas('dist.breakdowns', 'distributions', ['plan.maintenance', 'plan.availability']),
  { id: 'dist.breakdowns.ds', kind: 'dataset', block: 'distributions', parent: 'dist.breakdowns', title: 'work_center_types · mtbf/repair',
    dataset: { table: 'work_center_types', registry: 'work_center_types' }, screen: { id: 'nsi', anchor: 'work_center_types' } },

  { id: 'dist.identify', kind: 'subblock', block: 'distributions', parent: 'distributions', shape: 'disc',
    title: 'Идентификация по план-факту', short: 'Калибровка норм по факту симуляции/цеха; байесовское обновление и паспорт — волна 1.',
    screen: { id: 'scheme' }, learnMore: 'validation', feature: 'identify', action: 'estimate' },
  ...formulas('dist.identify', 'distributions', ['sim.calibration']),

  /* ── [3] Внутренние условия ───────────────────────────────────────────── */
  { id: 'int.capacity', kind: 'subblock', block: 'internal', parent: 'internal', shape: 'square',
    title: 'Мощности и календарь', short: 'Станки × типы РЦ × календарь смен = фонд рабочего времени; загрузка и узкое место.',
    screen: { id: 'nsi', anchor: 'machines' }, learnMore: 'toc', stage: 'done' },
  ...params('int.capacity', 'internal', ['cal.enabled', 'cal.work_fond']),
  ...formulas('int.capacity', 'internal', ['plan.utilization', 'opt.resource_load']),
  { id: 'int.capacity.ds', kind: 'dataset', block: 'internal', parent: 'int.capacity', title: 'machines · work_center_types · calendar',
    dataset: { table: 'machines', registry: 'machines' }, screen: { id: 'nsi', anchor: 'machines' } },
  { id: 'int.capacity.screen', kind: 'screen', block: 'internal', parent: 'int.capacity', title: 'Схема предприятия',
    screen: { id: 'scheme' } },

  { id: 'int.labor', kind: 'subblock', block: 'internal', parent: 'internal', shape: 'square',
    title: 'Персонал и допуски', short: 'Рабочие с навыками по типам РЦ; параллельно работает не больше станков, чем операторов.',
    screen: { id: 'nsi', anchor: 'workers' }, learnMore: 'kpi-definitions', stage: 'done' },
  ...formulas('int.labor', 'internal', ['analytics.labor_constraint', 'sim.required_operators']),
  { id: 'int.labor.ds', kind: 'dataset', block: 'internal', parent: 'int.labor', title: 'workers · skills',
    dataset: { table: 'workers', registry: 'workers' }, screen: { id: 'nsi', anchor: 'workers' } },

  { id: 'int.routes', kind: 'subblock', block: 'internal', parent: 'internal', shape: 'square',
    title: 'Техкарты и маршруты', short: 'Операции по порядку, допустимые типы РЦ (FJSP), входы изделий — граф процесса как IDEF0.',
    screen: { id: 'nsi', anchor: 'routings' }, diagram: 'idef0', learnMore: 'idef0', stage: 'done' },
  { id: 'int.routes.ds', kind: 'dataset', block: 'internal', parent: 'int.routes', title: 'routings · operations · operation_inputs',
    dataset: { table: 'routings', registry: 'routings' }, screen: { id: 'nsi', anchor: 'routings' } },

  { id: 'int.mrp', kind: 'subblock', block: 'internal', parent: 'internal', shape: 'square',
    title: 'MRP: материалы и запуск', short: 'Потребность по цепочке изделий, остатки, страховой запас, партии, сроки поставки → дата запуска.',
    screen: { id: 'plan', anchor: 'mrp' }, diagram: 'mrp', learnMore: 'mrp', stage: 'done' },
  ...formulas('int.mrp', 'internal', ['plan.mrp']),

  { id: 'int.finance', kind: 'subblock', block: 'internal', parent: 'internal', shape: 'square',
    title: 'Деньги: касса, кредитная линия, отсрочки', short: 'Водопад кассы по неделям (волна F): выручка с отсрочкой → закупки → зарплата → проценты → налоги (METHODOLOGY-V2 §4); параметры — fin_params с паспортом [К]/[НОРМ].',
    screen: { id: 'plan', anchor: 'new/constraints' }, learnMore: 'overview', stage: 'done', action: 'cash' },
  ...params('int.finance', 'internal', ['fin.cash0', 'fin.credit_limit', 'fin.credit_rate', 'fin.spread', 'fin.dso', 'fin.dpo', 'fin.pd',
    'fin.repair_budget', 'fin.tau_v', 'fin.tau_p', 'fin.dscr_covenant']),
  { id: 'int.finance.ds', kind: 'dataset', block: 'internal', parent: 'int.finance', title: 'fin_params · param_passport',
    dataset: { table: 'fin_params' }, screen: { id: 'plan', anchor: 'new/constraints' } },

  /* ── [4] Решения ──────────────────────────────────────────────────────── */
  { id: 'dec.portfolio', kind: 'subblock', block: 'decisions', parent: 'decisions', shape: 'triangle',
    title: 'Стадия 2 · портфель (CVaR-LP)', short: 'Что выпускать: робастный портфель по N сценариям цен — эвристика + точная LP Рокафеллара–Урясева (HiGHS).',
    screen: { id: 'optimization' }, diagram: 'two-stages', learnMore: 'two-stages', feature: 'exact-cvar', action: 'optimize' },
  ...params('dec.portfolio', 'decisions', ['scenario.objective', 'scenario.max_share', 'opt.samples', 'opt.horizon_months']),
  ...formulas('dec.portfolio', 'decisions', ['opt.expected', 'opt.hhi', 'opt.effective_n', 'opt.max_share', 'opt.pareto', 'opt.risk_contribution']),
  { id: 'dec.portfolio.ds', kind: 'dataset', block: 'decisions', parent: 'dec.portfolio', title: 'optimization_runs',
    dataset: { table: 'optimization_runs' }, screen: { id: 'optimization' } },

  { id: 'dec.schedule', kind: 'subblock', block: 'decisions', parent: 'decisions', shape: 'triangle',
    title: 'Стадия 1 · расписание (7 правил + ГА)', short: 'Как выпускать: порядок операций под F = w_time·E + w_risk·(CVaR − E); ГА с проверкой вне выборки.',
    screen: { id: 'plan' }, diagram: 'dispatch-rules', learnMore: 'dispatch-rules', feature: 'cpsat', action: 'schedule' },
  ...params('dec.schedule', 'decisions', ['plan.rule', 'plan.samples', 'plan.w_risk', 'plan.w_time', 'plan.w_cost', 'plan.improve_iters']),
  ...formulas('dec.schedule', 'decisions', ['plan.rule_score', 'plan.ga', 'plan.makespan', 'plan.bottleneck', 'plan.queue_peak']),
  { id: 'dec.schedule.ds', kind: 'dataset', block: 'decisions', parent: 'dec.schedule', title: 'plans · plan_tasks',
    dataset: { table: 'plans' }, screen: { id: 'plan' } },

  { id: 'dec.lots', kind: 'subblock', block: 'decisions', parent: 'decisions', shape: 'triangle',
    title: 'Партии и транспортные партии', short: 'Размер партии изделия и дробление на транспортные партии — перекрытие операций.',
    screen: { id: 'nsi', anchor: 'products' }, diagram: 'lot-streaming', learnMore: 'lot-streaming', stage: 'done' },

  { id: 'dec.invest', kind: 'subblock', block: 'decisions', parent: 'decisions', shape: 'triangle',
    title: 'Инвестиции в мощности', short: 'Добавить станок в узкое место: ΔCF, ЧДД, ВНД, окупаемость; следующее узкое место.',
    screen: { id: 'analytics', anchor: 'invest' }, diagram: 'npv', learnMore: 'npv', stage: 'done' },
  ...formulas('dec.invest', 'decisions', ['invest.capex', 'invest.delta_cf', 'invest.npv', 'invest.irr', 'invest.dpp', 'invest.roi', 'invest.next_bottleneck']),

  { id: 'dec.cash', kind: 'subblock', block: 'decisions', parent: 'decisions', shape: 'triangle',
    title: 'Транши кредитной линии (CVaR-LP с кассой)', short: 'Когда и сколько брать транш: рекурс d_i,t или «график заранее» d_t внутри одной CVaR-LP с потоком денег (HiGHS, §5.2); запасы как решение — волна 1.',
    screen: { id: 'plan', runSection: 'cash' }, learnMore: 'overview', stage: 'done', action: 'cash' },
  ...params('dec.cash', 'decisions', ['fin.l_min', 'fin.beta', 'fin.auto_repay', 'fin.tax_cumulative']),
  ...formulas('dec.cash', 'decisions', ['cash.pol', 'cash.debt_peak', 'cash.int_cost']),

  /* ── [5] Критерии ─────────────────────────────────────────────────────── */
  { id: 'crit.profit', kind: 'subblock', block: 'criteria', parent: 'criteria', shape: 'triangle',
    title: 'CVaR прибыли и цена робастности', short: 'Среднее худших α сценариев прибыли; VaR, худший случай, P(убыток), цена робастности, проверка вне выборки.',
    screen: { id: 'optimization', anchor: 'result' }, diagram: 'cvar-tail', learnMore: 'cvar-tail', stage: 'done' },
  ...params('crit.profit', 'criteria', ['scenario.alpha']),
  ...formulas('crit.profit', 'criteria', ['opt.cvar', 'opt.var', 'opt.worst', 'opt.p_loss', 'opt.sigma', 'opt.max_regret', 'opt.price_of_robustness', 'opt.oos_gap']),

  { id: 'crit.schedule', kind: 'subblock', block: 'criteria', parent: 'criteria', shape: 'triangle',
    title: 'Критерии расписания', short: 'CVaR длины расписания, просрочка, OTD, загрузка, стоимость, поток — KPI Стадии 1 (ГОСТ Р ИСО 22400).',
    screen: { id: 'plan', anchor: 'kpi' }, diagram: 'little-law', learnMore: 'kpi-definitions', stage: 'done' },
  ...formulas('crit.schedule', 'criteria', ['plan.makespan_cvar', 'plan.tardiness', 'plan.otd', 'plan.cost', 'plan.labor_cost',
    'plan.flow_time', 'plan.wip', 'plan.throughput', 'plan.setup_share', 'plan.wait_share', 'plan.machine_load']),

  { id: 'crit.cash', kind: 'subblock', block: 'criteria', parent: 'criteria', shape: 'triangle',
    title: 'CVaR кассы (CFaR), DSCR, цена ликвидности', short: 'CVaR минимального остатка кассы, вероятность разрыва (ДИ Уилсона), DSCR, ЧДД собственника и банка — KPI §6.0 по водопаду на решении LP.',
    screen: { id: 'plan', runSection: 'cash' }, learnMore: 'overview', stage: 'done' },
  ...formulas('crit.cash', 'criteria', ['cash.cfar', 'cash.p_breach', 'cash.t_breach_p10', 'cash.dscr_min_p05', 'cash.cash_min_p50', 'cash.wc_avg', 'cash.npv', 'cash.tax_paid']),

  { id: 'crit.ci', kind: 'subblock', block: 'criteria', parent: 'criteria', shape: 'point',
    title: 'ДИ и протокол доказательности', short: 'Общие случайные числа, holdout, бутстреп-ДИ, Уилкоксон, бенчмарки — METHODOLOGY-V2 §10.',
    screen: { id: 'methodology', anchor: 'validation' }, learnMore: 'validation', feature: 'ci' },
]
