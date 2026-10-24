/**
 * Примеры few-shot: настоящая форма графа (id узлов карты, факты, статусы паспорта), но ВЫМЫШЛЕННЫЕ
 * значения — это помечено в самом промпте, а пользователю как ответ не показывается никогда (только в
 * «Показать промпт» как часть запроса). Ответы примеров проходят ту же проверку верности, что и ответы
 * модели (prompts.test.ts), — пример не может учить нарушать правила.
 */
import type { CtxValue, MentatContext } from '../context/types'
import { CONTEXT_VERSION } from '../context/types'
import { cite, NO_DATA } from './system'

const v = (key: string, label: string, value: number | string, unitKind: CtxValue['unitKind'], text: string): CtxValue =>
  ({ key, label, value, unitKind, text })

const NB = ' '

export interface FewShot {
  id: string
  question: string
  task: string
  context: MentatContext
  answer: string
}

const cvarContext: MentatContext = {
  version: CONTEXT_VERSION, asked: 'crit.profit.f.cvar', scope: { scenarioName: 'ПРИМЕР' },
  nodes: [
    { id: 'crit.profit.f.cvar', title: 'CVaR прибыли', kind: 'formula', block: 'criteria', mapNode: 'crit.profit.f.cvar', parent: 'crit.profit', distance: 0, status: 'расчёт', formula: 'opt.cvar',
      values: [v('cvar', 'CVaR прибыли', -12_400_000, 'money', `−12,4${NB}млн${NB}₽`), v('alpha', 'Уровень хвоста α', 0.05, 'pct', `5${NB}%`), v('n', 'Число сценариев N', 1000, 'plain', `1${NB}000`)] },
    { id: 'crit.profit', title: 'CVaR прибыли (критерий)', kind: 'subblock', block: 'criteria', mapNode: 'crit.profit', distance: 1, status: 'рассчитано' },
    { id: 'crit.profit.alpha', title: 'α хвоста', kind: 'parameter', block: 'criteria', mapNode: 'crit.profit.alpha', parent: 'crit.profit', distance: 2, status: 'К',
      values: [v('value', 'α хвоста', 0.05, 'pct', `5${NB}%`)] },
    { id: 'crit.profit.risk_contrib', title: 'Вклады изделий робастного портфеля в риск и прибыль', kind: 'fact', block: 'criteria', mapNode: 'crit.profit', parent: 'crit.profit', distance: 2, status: 'расчёт',
      values: [v('risk_1', 'Доля в дисперсии прибыли (вклад в риск): Изделие А', 0.61, 'pct', `61${NB}%`), v('risk_2', 'Доля в дисперсии прибыли (вклад в риск): Изделие Б', 0.24, 'pct', `24${NB}%`)] },
    { id: 'dist.prices', title: 'Распределения цен', kind: 'subblock', block: 'distributions', mapNode: 'dist.prices', distance: 2, status: 'по умолчанию' },
    { id: 'dist.prices.ds', title: 'ts_data (история цен)', kind: 'dataset', block: 'distributions', mapNode: 'dist.prices.ds', parent: 'dist.prices', distance: 3, status: 'синтетика' },
  ],
  edges: [{ from: 'dec.portfolio', to: 'crit.profit', kind: 'data' }, { from: 'dist.prices', to: 'dec.portfolio', kind: 'data', label: 'сценарии цен' }],
  truncated: { kept: 6, dropped: 0, budgetTokens: 3000, usedTokens: 0 },
}

const crisisContext: MentatContext = {
  version: CONTEXT_VERSION, asked: 'ext.regimes', scope: { scenarioName: 'ПРИМЕР' },
  nodes: [
    { id: 'ext.regimes', title: 'Режимы генератора', kind: 'subblock', block: 'external', mapNode: 'ext.regimes', distance: 0, status: 'рассчитано' },
    { id: 'ext.regimes.run', title: 'Режим макро-генератора в прогоне портфеля', kind: 'fact', block: 'external', mapNode: 'ext.regimes', parent: 'ext.regimes', distance: 1, status: 'расчёт',
      values: [v('on', 'Генератор включён', 'да', 'text', 'да'), v('mode', 'Режим', 'базовый (прогноз)', 'text', 'базовый (прогноз)')] },
  ],
  edges: [],
  truncated: { kept: 2, dropped: 0, budgetTokens: 3000, usedTokens: 0 },
}

export const FEW_SHOTS: readonly FewShot[] = [
  {
    id: 'example_cvar',
    question: 'Что определило CVaR прибыли портфеля?',
    task: 'Назови узлы, которые формируют хвост прибыли.',
    context: cvarContext,
    answer: [
      `Вывод: CVaR прибыли равен −12,4${NB}млн${NB}₽ — это средняя прибыль худших 5${NB}% из 1${NB}000 сценариев ${cite('crit.profit.f.cvar')}.`,
      'Почему:',
      `- Больше всего разброса прибыли даёт Изделие А — 61${NB}% дисперсии; это разложение σ, а не CVaR ${cite('crit.profit.risk_contrib')}.`,
      `- Второй вклад — Изделие Б, 24${NB}% ${cite('crit.profit.risk_contrib')}.`,
      `- Сценарии цен приходят из распределений цен в решение портфеля ${cite('dist.prices')}.`,
      'Что проверить:',
      `- Уровень хвоста α = 5${NB}% принят калибровкой, а не оценён по данным ${cite('crit.profit.alpha')}.`,
      `- История цен синтетическая — выводы на реальное предприятие не переносить ${cite('dist.prices.ds')}.`,
    ].join('\n'),
  },
  {
    id: 'example_no_data',
    question: 'Что будет с решением в кризисном режиме?',
    task: 'Отвечай только по уже посчитанному прогону.',
    context: crisisContext,
    answer: [
      `Вывод: ${NO_DATA}: прогон посчитан в режиме «базовый (прогноз)», стресс-прогон в кризисном режиме не считался ${cite('ext.regimes.run')}.`,
      `Что проверить: запустите расчёт портфеля с навязанным кризисным режимом на экране «Сценарии» ${cite('ext.regimes')}.`,
    ].join('\n'),
  },
]
