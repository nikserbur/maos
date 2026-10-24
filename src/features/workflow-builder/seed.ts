/*
 * Стартовый граф — реальный конвейер MENTAT (блок [8], X2 P-136): вопрос или шаблон → сборка
 * контекста графа → промпт → локальная LLM → проверка чисел → ответ со ссылками на узлы.
 * Заметки узлов ссылаются на модули, где шаг реализован. Плюс отпечаток прежнего стартового
 * графа v1 — его заменяем новым, только если пользователь его не трогал.
 */
import { makeId, type NodeType, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from './types'

type SeedNode = Omit<WorkflowNode, 'id'> & { key: string }

const COL = 360
const ROW = 124

const SEED_NODES: readonly SeedNode[] = [
  { key: 'ask', type: 'start', x: COL, y: 40, title: 'Вопрос или шаблон',
    notes: 'Свой вопрос в панели MENTAT (⌘J) или шаблон из библиотеки: «Почему это решение», «Что определило CVaR»… (src/features/explain/prompts/templates.ts). Фокус вопроса — узел карты, с которого спросили.' },
  { key: 'ctx', type: 'context', x: COL, y: 40 + ROW, title: 'Сборка контекста графа',
    notes: 'buildContext (src/features/explain/context): узлы DecisionContext и карты методологии вокруг фокуса, числа дословно с единицами и статусом паспорта; бюджет токенов — context/budget.ts.' },
  { key: 'prompt', type: 'context', x: COL, y: 40 + ROW * 2, title: 'Промпт v1.0',
    notes: 'Системный промпт mentat-sys/1.0.0 (src/features/explain/prompts/system.ts): только контекст графа, ссылка ⟦node:…⟧ после каждого утверждения, числа дословно, «в контексте нет данных» вместо догадок. Версия пишется в журнал.' },
  { key: 'online', type: 'condition', x: COL, y: 40 + ROW * 3, title: 'Локальная LLM подключена?',
    notes: 'GET /api/mentat/status: адрес из окружения сервера или настроек проекта; только localhost или разрешённые хосты.' },
  { key: 'llm', type: 'aiReply', x: COL, y: 40 + ROW * 4, title: 'Локальная LLM',
    notes: 'POST /api/mentat/ask → OpenAI-совместимый сервер или Ollama (backend/src/MentatRoutes.cpp). В журнал — вопрос, шаблон, версия промпта, время ответа; текст ответа — только если включено.' },
  { key: 'verify', type: 'tool', x: COL, y: 40 + ROW * 5, title: 'Проверка чисел ✓/⚠/✕',
    notes: 'verify (src/features/explain/verify): каждое число сверяется со значением узла, на который ссылается утверждение; ✓ сверено · ⚠ не совпало · ✕ нет ссылки или неизвестный узел.' },
  { key: 'answer', type: 'end', x: COL, y: 40 + ROW * 6, title: 'Ответ со ссылками ⟦node⟧ или «в контексте нет данных»',
    notes: 'Ответ с переходами на узлы карты и пометками проверки. MENTAT только объясняет и предлагает — решение применяет человек.' },
  { key: 'offline', type: 'end', x: COL + 280, y: 40 + ROW * 4, title: 'LLM не подключена — ответа нет',
    notes: '503 «LLM не подключена»: панель показывает честное пустое состояние и настройки соединения, ответов нигде нет.' },
]

const SEED_EDGES: ReadonlyArray<readonly [string, string, string?]> = [
  ['ask', 'ctx'], ['ctx', 'prompt'], ['prompt', 'online'], ['online', 'llm', 'да'], ['online', 'offline', 'нет'],
  ['llm', 'verify'], ['verify', 'answer'],
]

/** Стартовый граф MENTAT с новыми id. */
export function seedGraph(): WorkflowGraph {
  const ids = new Map(SEED_NODES.map((n) => [n.key, makeId()]))
  const nodes: WorkflowNode[] = SEED_NODES.map(({ key, ...n }) => ({ ...n, id: ids.get(key) ?? makeId() }))
  const edges: WorkflowEdge[] = SEED_EDGES.map(([from, to, label]) => ({
    id: makeId(), from: ids.get(from) ?? '', to: ids.get(to) ?? '', ...(label ? { label } : {}),
  }))
  return { nodes, edges }
}

/* ── Прежний стартовый граф v1 («черновик требований к мини-ChatGPT») ─────── */

const LEGACY_SEED: ReadonlyArray<readonly [NodeType, number, number, string, string]> = [
  ['start', 360, 40, 'Старт диалога', 'Пользователь открыл чат.'],
  ['userMessage', 360, 170, 'Запрос пользователя', 'Свободный текст: что хочет пользователь.'],
  ['aiReply', 360, 300, 'Ответ AI', 'LLM формирует ответ по контексту диалога.'],
  ['condition', 360, 430, 'Достаточно данных?', 'Ветвление: хватает ли информации для действия.'],
  ['tool', 140, 560, 'Вызов инструмента', 'Запуск действия/API, если данных достаточно.'],
  ['clarify', 560, 560, 'Уточнить у пользователя', 'Задать уточняющий вопрос, вернуться к диалогу.'],
  ['end', 360, 690, 'Конец', 'Итог выдан пользователю.'],
]
const LEGACY_EDGE_COUNT = 7

const nodeSig = (type: string, x: number, y: number, title: string, notes: string): string => `${type}|${x}|${y}|${title}|${notes}`
const LEGACY_SIG = LEGACY_SEED.map((n) => nodeSig(...n)).sort().join('\n')

/** Граф v1 — нетронутый прежний стартовый пример (те же шаги на тех же местах, те же 7 связей). */
export function isUntouchedLegacySeed(g: WorkflowGraph): boolean {
  if (g.nodes.length !== LEGACY_SEED.length || g.edges.length !== LEGACY_EDGE_COUNT) return false
  return g.nodes.map((n) => nodeSig(n.type, n.x, n.y, n.title, n.notes)).sort().join('\n') === LEGACY_SIG
}
