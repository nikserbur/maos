/**
 * Узлы петель карты: [6] Агенты (RL/игры — волна 3), [7] Прогноз и мониторинг,
 * [8] LLM (MENTAT). Честная граница: что реализовано — `done`, остальное `w1…w3`.
 */
import type { MapNode } from './types'

function formulas(parent: string, block: MapNode['block'], ids: readonly string[]): MapNode[] {
  return ids.map((metricId) => ({
    id: `${parent}.f.${metricId.split('.').pop()}`, kind: 'formula', block, parent, metricId,
    title: metricId, shape: 'point',
  }))
}

export const LOOP_NODES: readonly MapNode[] = [
  /* ── [6] Агенты ───────────────────────────────────────────────────────── */
  { id: 'ag.rl', kind: 'subblock', block: 'agents', parent: 'agents', shape: 'disc',
    title: 'Агент RL L0/L2 со структурными ходами', short: 'Перестраивает план: маршрут, станок, партии, цех, аутсорсинг, сдвиг, отказ; каждый ход — Монте-Карло по CVaR прибыли и кассы.',
    screen: { id: 'agents' }, diagram: 'agent-layers', learnMore: 'rl', stage: 'w3', action: 'train' },
  { id: 'ag.rl.policy', kind: 'parameter', block: 'agents', parent: 'ag.rl', paramId: 'agent.policy_version',
    title: 'agent.policy_version', shape: 'square', stage: 'w3' },
  { id: 'ag.rl.screen', kind: 'screen', block: 'agents', parent: 'ag.rl', title: 'План · правило «RL»',
    screen: { id: 'plan', anchor: 'objective' }, stage: 'w3' },

  { id: 'ag.guardrails', kind: 'subblock', block: 'agents', parent: 'agents', shape: 'square',
    title: 'Полномочия агента (guardrails)', short: 'Разрешённые ходы с масками, лимиты пакета, заморозки, единый α — «агент предлагает, человек утверждает».',
    screen: { id: 'agents' }, learnMore: 'rl', stage: 'w3' },
  { id: 'ag.guardrails.max_moves', kind: 'parameter', block: 'agents', parent: 'ag.guardrails', paramId: 'agent.max_moves',
    title: 'agent.max_moves', shape: 'square', stage: 'w3' },

  { id: 'ag.games', kind: 'subblock', block: 'agents', parent: 'agents', shape: 'disc',
    title: 'Игры: цена анархии, Штакельберг', short: 'Игра цехов против кооператива; «банк/поставщик → предприятие»; выученные цены планировщика против двойственных LP.',
    screen: { id: 'agents' }, learnMore: 'agent-layers', stage: 'w3' },

  /* ── [7] Прогноз и мониторинг ─────────────────────────────────────────── */
  { id: 'mon.forecast', kind: 'subblock', block: 'monitoring', parent: 'monitoring', shape: 'disc',
    title: 'Прогноз цен и бэктест', short: 'Веер по сценарию и проверка против наивного прогноза: MAPE, pinball, покрытие 80 %-интервала.',
    screen: { id: 'monitoring' }, diagram: 'forecast-decomposition', learnMore: 'forecast-decomposition', stage: 'done', action: 'forecast' },
  ...formulas('mon.forecast', 'monitoring', ['forecast.backtest']),

  { id: 'mon.quality', kind: 'subblock', block: 'monitoring', parent: 'monitoring', shape: 'disc',
    title: 'CRPS / MASE / покрытие', short: 'Качество прогноза как сигнал: CRPS относительно наивного, MASE, калибровка PIT — статусы по изделиям.',
    screen: { id: 'monitoring' }, learnMore: 'validation', stage: 'w1' },

  { id: 'mon.planfact', kind: 'subblock', block: 'monitoring', parent: 'monitoring', shape: 'disc',
    title: 'План-факт и KPI', short: 'KPI последнего плана, узкие места, рекомендации, поток изделий (Санкей), сравнение A/B.',
    screen: { id: 'analytics' }, diagram: 'toc', learnMore: 'kpi-definitions', stage: 'done' },
  ...formulas('mon.planfact', 'monitoring', ['analytics.bottleneck_rank', 'analytics.recommendations', 'analytics.sankey',
    'analytics.ab_delta', 'sim.avg_utilization', 'sim.orders_per_day', 'sim.live']),
  { id: 'mon.planfact.ds', kind: 'dataset', block: 'monitoring', parent: 'mon.planfact', title: 'analytics.kpi (KpiBundle)',
    dataset: { table: 'kpi_series' }, screen: { id: 'analytics' } },

  { id: 'mon.early', kind: 'subblock', block: 'monitoring', parent: 'monitoring', shape: 'disc',
    title: 'Раннее предупреждение', short: 'Мониторинг кассы и срывов: сигналы, когда факт выходит за веер плана.',
    screen: { id: 'monitoring' }, learnMore: 'overview', stage: 'w2' },

  /* ── [8] LLM ──────────────────────────────────────────────────────────── */
  { id: 'llm.explain', kind: 'subblock', block: 'llm', parent: 'llm', shape: 'point',
    title: 'Реестр «i»: как считается число', short: '56 формул с живой подстановкой, обозначениями, методом и оговорками; якоря в «Методику».',
    screen: { id: 'methodology' }, learnMore: 'overview', stage: 'done' },
  { id: 'llm.explain.screen', kind: 'screen', block: 'llm', parent: 'llm.explain', title: 'Методика (лонгрид)',
    screen: { id: 'methodology' } },

  { id: 'llm.mentat', kind: 'subblock', block: 'llm', parent: 'llm', shape: 'point',
    title: 'MENTAT: объяснение по графу расчёта', short: 'Боковая панель «почему так»: путь по рёбрам карты от результата к параметрам, со ссылками на узлы.',
    screen: { id: 'aiflow' }, learnMore: 'overview', stage: 'w2' },
]
