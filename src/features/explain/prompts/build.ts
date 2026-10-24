/**
 * Сборка запроса к модели: system (правила) → примеры few-shot (user/assistant, помечены как ПРИМЕР с
 * вымышленными значениями) → user (задание шаблона, узел вопроса, КОНТЕКСТ, ВОПРОС). Ровно эти сообщения
 * уходят в POST /api/mentat/ask и ровно их показывает «Показать промпт» — валидация промптов до
 * подключения модели. Чистые функции.
 */
import { estimateTokens } from '../context/budget'
import { serializeContext } from '../context/serialize'
import type { MentatContext } from '../context/types'
import { FEW_SHOTS, type FewShot } from './fewshot'
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from './system'
import type { TaskTemplate } from './templates'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface BuiltPrompt {
  messages: ChatMessage[]
  /** «mentat-sys/1.0.0+why_decision@1.0+mentat-ctx/1» — в аудит и историю. */
  version: string
  templateId: string
  asked: string
  question: string
  /** Оценка размера запроса (консервативная). */
  tokens: number
}

export interface BuildPromptInput {
  template: TaskTemplate
  question: string
  context: MentatContext
  /** Примеры few-shot (по умолчанию да; без них — короче, для малых окон контекста). */
  withExamples?: boolean
}

const EXAMPLE_BANNER = 'ПРИМЕР ФОРМАТА — значения вымышлены; в настоящем ответе не использовать ни одного числа из примера.'

function userMessage(task: string, asked: string, contextJson: string, question: string, banner?: string): string {
  return [
    ...(banner ? [banner, ''] : []),
    `ЗАДАНИЕ: ${task}`,
    `УЗЕЛ ВОПРОСА: ${asked}`,
    'КОНТЕКСТ:',
    contextJson,
    `ВОПРОС: ${question}`,
  ].join('\n')
}

function exampleMessages(ex: FewShot): ChatMessage[] {
  return [
    { role: 'user', content: userMessage(ex.task, ex.context.asked, serializeContext(ex.context), ex.question, EXAMPLE_BANNER) },
    { role: 'assistant', content: ex.answer },
  ]
}

export function promptVersion(template: TaskTemplate, context: MentatContext): string {
  return `${SYSTEM_PROMPT_VERSION}+${template.id}@${template.version}+${context.version}`
}

export function buildPrompt({ template, question, context, withExamples = true }: BuildPromptInput): BuiltPrompt {
  const q = question.trim() || template.question
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(withExamples ? FEW_SHOTS.flatMap(exampleMessages) : []),
    { role: 'user', content: userMessage(template.task, context.asked, serializeContext(context), q) },
  ]
  return {
    messages,
    version: promptVersion(template, context),
    templateId: template.id,
    asked: context.asked,
    question: q,
    tokens: messages.reduce((s, m) => s + estimateTokens(m.content), 0),
  }
}

const ROLE_TITLE: Readonly<Record<ChatRole, string>> = { system: 'SYSTEM', user: 'USER', assistant: 'ASSISTANT (пример)' }

/** Текст запроса целиком — для «Показать промпт» и «Копировать». */
export function renderPrompt(p: BuiltPrompt): string {
  const head = `# MENTAT · ${p.version} · ≈ ${p.tokens} токенов`
  return [head, ...p.messages.map((m) => `## ${ROLE_TITLE[m.role]}\n${m.content}`)].join('\n\n')
}
