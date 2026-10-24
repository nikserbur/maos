/**
 * Контекст MENTAT (METHODOLOGY-V2 §9, блок [8]): единственный вход LLM — (а) узлы графа расчёта со
 * значениями и статусами паспорта, (б) двойственные оценки и вклады, (в) разности между прогонами.
 * У каждого элемента есть id — на него обязана ссылаться каждая фраза ответа (⟦node:id⟧), а проверка
 * верности (verify/) сверяет числа ответа со значениями именно этого узла.
 */
import type { BlockId, MapEdgeKind, MapNodeKind, NodeState } from '../../method-map/types'

/**
 * Род единицы для сверки чисел: money — рубли; pct — доля (0,1 → «10 %»); pp — уже в процентах
 * (16 → «16 %/год», IQM «+1,46 %»); hours — часы; plain — безразмерное/прочие единицы; text — строка.
 */
export type UnitKind = 'money' | 'pct' | 'pp' | 'hours' | 'plain' | 'text'

export interface CtxValue {
  key: string
  label: string
  /** Сырое значение — только для проверки верности; в промпт не попадает. */
  value: number | string
  unitKind: UnitKind
  /** Готовый текст по src/explain/format.ts — именно его модель копирует дословно. */
  text: string
}

/** Узел контекста: реальный узел карты или «факт» (вклад, двойственная оценка, ход агента, разность). */
export interface CtxNode {
  id: string
  title: string
  kind: MapNodeKind | 'fact' | 'diff'
  block: BlockId
  /** Узел карты, куда ведёт чип ссылки (для реального узла — он сам). */
  mapNode: string
  parent?: string
  /** Расстояние по графу от узла вопроса (0 — сам узел); основа усечения по бюджету. */
  distance: number
  /** Статус паспорта: Н / О / К / НОРМ / UI / техн. / синтетика / «расчёт» / «вручную» / «по умолчанию». */
  status?: string
  state?: NodeState
  /** id формулы реестра «i» (src/explain/metrics.*). */
  formula?: string
  values?: readonly CtxValue[]
  /** Короткое «что это» без чисел (из реестра). */
  note?: string
}

export interface CtxEdge {
  from: string
  to: string
  kind: MapEdgeKind
  label?: string
}

export interface CtxScope {
  scenarioId?: string
  scenarioName?: string
  portfolioRunId?: string
  compareRunId?: string
  planId?: string
  cashRunId?: string
  computedAt?: string
}

export interface MentatContext {
  version: string
  /** Узел, о котором вопрос. */
  asked: string
  scope: CtxScope
  nodes: readonly CtxNode[]
  edges: readonly CtxEdge[]
  truncated: { kept: number; dropped: number; budgetTokens: number; usedTokens: number }
}

export const CONTEXT_VERSION = 'mentat-ctx/1'
