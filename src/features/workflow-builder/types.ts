/*
 * Модель данных визуального редактора AI-воркфлоу.
 * Это спец-инструмент: описываем будущую «мини-ChatGPT с диалогами и
 * возможностью строить воркфлоу» как граф связанных узлов.
 */

/** Тип узла диалог/агент-воркфлоу. */
export type NodeType =
  | 'start'
  | 'userMessage'
  | 'aiReply'
  | 'clarify'
  | 'tool'
  | 'condition'
  | 'context'
  | 'subflow'
  | 'end'

/** Один шаг воркфлоу на канвасе. */
export interface WorkflowNode {
  id: string
  type: NodeType
  x: number
  y: number
  title: string
  /** Требования / промпт для этого шага — суть спецификации. */
  notes: string
}

/** Направленная связь: из выхода `from` во вход `to`. */
export interface WorkflowEdge {
  id: string
  from: string
  to: string
}

/** Полный сохраняемый граф. */
export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** Метаданные типа узла — цвет заголовка и подпись в палитре. */
export interface NodeTypeMeta {
  label: string
  color: string
}

/** Палитра типов — порядок совпадает с боковой панелью. */
export const NODE_TYPES: NodeType[] = [
  'start',
  'userMessage',
  'aiReply',
  'clarify',
  'tool',
  'condition',
  'context',
  'subflow',
  'end',
]

export const NODE_META: Record<NodeType, NodeTypeMeta> = {
  start: { label: 'Старт', color: '#238551' },
  userMessage: { label: 'Сообщение пользователя', color: '#2d72d2' },
  aiReply: { label: 'Ответ AI (LLM)', color: '#9179f2' },
  clarify: { label: 'Уточняющий вопрос', color: '#c87619' },
  tool: { label: 'Инструмент/действие', color: '#00a396' },
  condition: { label: 'Условие/ветвление', color: '#d1980b' },
  context: { label: 'Данные/контекст', color: '#7961db' },
  subflow: { label: 'Под-воркфлоу', color: '#c22762' },
  end: { label: 'Конец', color: '#cd4246' },
}

/** Размер карточки узла в координатах канваса. */
export const NODE_W = 190
export const NODE_H = 76

/** Ключ localStorage для персистентности графа. */
export const STORAGE_KEY = 'maos.aiWorkflow.v1'

/** Детерминированный id с фолбэком, если crypto недоступен (SSR/старые среды). */
export const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wf-${Math.random().toString(36).slice(2)}`

/** Стартовый пример-граф — показываем концепцию на пустом localStorage. */
export function seedGraph(): WorkflowGraph {
  const start: WorkflowNode = { id: makeId(), type: 'start', x: 360, y: 40, title: 'Старт диалога', notes: 'Пользователь открыл чат.' }
  const userMsg: WorkflowNode = { id: makeId(), type: 'userMessage', x: 360, y: 170, title: 'Запрос пользователя', notes: 'Свободный текст: что хочет пользователь.' }
  const aiReply: WorkflowNode = { id: makeId(), type: 'aiReply', x: 360, y: 300, title: 'Ответ AI', notes: 'LLM формирует ответ по контексту диалога.' }
  const cond: WorkflowNode = { id: makeId(), type: 'condition', x: 360, y: 430, title: 'Достаточно данных?', notes: 'Ветвление: хватает ли информации для действия.' }
  const tool: WorkflowNode = { id: makeId(), type: 'tool', x: 140, y: 560, title: 'Вызов инструмента', notes: 'Запуск действия/API, если данных достаточно.' }
  const clarify: WorkflowNode = { id: makeId(), type: 'clarify', x: 560, y: 560, title: 'Уточнить у пользователя', notes: 'Задать уточняющий вопрос, вернуться к диалогу.' }
  const end: WorkflowNode = { id: makeId(), type: 'end', x: 360, y: 690, title: 'Конец', notes: 'Итог выдан пользователю.' }

  return {
    nodes: [start, userMsg, aiReply, cond, tool, clarify, end],
    edges: [
      { id: makeId(), from: start.id, to: userMsg.id },
      { id: makeId(), from: userMsg.id, to: aiReply.id },
      { id: makeId(), from: aiReply.id, to: cond.id },
      { id: makeId(), from: cond.id, to: tool.id },
      { id: makeId(), from: cond.id, to: clarify.id },
      { id: makeId(), from: tool.id, to: end.id },
      { id: makeId(), from: clarify.id, to: userMsg.id },
    ],
  }
}
