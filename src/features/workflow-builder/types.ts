/*
 * Модель данных конструктора AI-воркфлоу — схемы диалога MENTAT (блок [8] карты методологии):
 * шаги-узлы и направленные связи с подписью ветки («да»/«нет»). Вид узла — общий язык графов
 * (.gc-node): нейтральная карточка, тип — глифом и словом, полоса блока [8] — только у шагов LLM.
 */

/** Тип шага. */
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

/** Направленная связь: из выхода `from` во вход `to`; `label` — подпись ветки («да», «нет»). */
export interface WorkflowEdge {
  id: string
  from: string
  to: string
  label?: string
}

/** Полный сохраняемый граф. */
export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** Тип шага: подпись в палитре и инспекторе, глиф и короткое слово на карточке, тон полосы. */
export interface NodeTypeMeta {
  label: string
  caption: string
  glyph: string
  /** llm — шаг блока [8] (полоса --block-8); neutral — остальные (полоса --text-muted). */
  tone: 'neutral' | 'llm'
}

/** Палитра типов — порядок совпадает с боковой панелью. */
export const NODE_TYPES: NodeType[] = [
  'start',
  'userMessage',
  'context',
  'aiReply',
  'condition',
  'tool',
  'clarify',
  'subflow',
  'end',
]

export const NODE_META: Readonly<Record<NodeType, NodeTypeMeta>> = {
  start: { label: 'Старт', caption: 'старт', glyph: '●', tone: 'neutral' },
  userMessage: { label: 'Сообщение пользователя', caption: 'сообщение', glyph: '○', tone: 'neutral' },
  context: { label: 'Данные и контекст', caption: 'контекст', glyph: '≡', tone: 'llm' },
  aiReply: { label: 'Ответ LLM', caption: 'ответ LLM', glyph: '◇', tone: 'llm' },
  condition: { label: 'Условие или ветвление', caption: 'условие', glyph: '◆', tone: 'neutral' },
  tool: { label: 'Инструмент или действие', caption: 'инструмент', glyph: '▲', tone: 'neutral' },
  clarify: { label: 'Уточняющий вопрос', caption: 'уточнение', glyph: '?', tone: 'neutral' },
  subflow: { label: 'Под-воркфлоу', caption: 'под-воркфлоу', glyph: '↳', tone: 'neutral' },
  end: { label: 'Конец', caption: 'конец', glyph: '■', tone: 'neutral' },
}

export const isNodeType = (v: unknown): v is NodeType => typeof v === 'string' && Object.prototype.hasOwnProperty.call(NODE_META, v)

/** Размер карточки узла в координатах канваса (рёбра и порты считаются от него). */
export const NODE_W = 200
export const NODE_H = 80

/** Ключ localStorage для персистентности графа (v2 — схема MENTAT и подписи веток). */
export const STORAGE_KEY = 'maos.aiWorkflow.v2'
/** Прежний ключ: стартовый «мини-ChatGPT»-граф без подписей веток. */
export const LEGACY_STORAGE_KEY = 'maos.aiWorkflow.v1'

/** Уникальный id с фолбэком, если crypto недоступен (SSR/старые среды). */
export const makeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wf-${Math.random().toString(36).slice(2)}`
