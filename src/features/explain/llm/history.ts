/**
 * История вопросов MENTAT по проекту (localStorage этой машины, ключ по проекту-БД): вопрос, узел, версия
 * промпта, ответ модели и вердикт проверки верности. Пишутся настоящие ответы модели и запросы, которые
 * пользователь остановил («остановлено»); «модель не подключена» в историю не попадает.
 * Чистые функции + тонкая обёртка хранилища.
 */
import type { ClaimVerdict, VerifyReport } from '../verify'

export type HistoryOutcome = 'answered' | 'stopped'

export interface HistoryEntry {
  id: string
  /** ISO-время вопроса. */
  at: string
  templateId: string
  question: string
  asked: string
  promptVersion: string
  model: string
  answer: string
  report: VerifyReport
  /** Подписи и узлы карты процитированных узлов — чтобы чипы ссылок работали без контекста. */
  cited?: Readonly<Record<string, { title: string; mapNode: string }>>
  /** Итог запроса; нет поля — ответ (записи до X2 P-130). */
  outcome?: HistoryOutcome
}

/** Пустой отчёт проверки — для остановленного запроса (ответа нет). */
export const EMPTY_REPORT: VerifyReport = {
  claims: [], pass: false,
  counts: { verified: 0, cited: 0, mismatch: 0, uncited: 0, unknown_node: 0, free: 0 },
}

export const HISTORY_MAX = 50
const PREFIX = 'maos.mentat.history.'

export const historyKey = (project: string): string => `${PREFIX}${project || 'default'}`

const isEntry = (x: unknown): x is HistoryEntry => {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return ['id', 'at', 'templateId', 'question', 'asked', 'promptVersion', 'model', 'answer'].every((k) => typeof o[k] === 'string')
    && Boolean(o.report) && typeof o.report === 'object' && Array.isArray((o.report as VerifyReport).claims)
}

/** Разбор сохранённой истории; мусор и чужие форматы отбрасываются. */
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(isEntry).slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

/** Новая запись — первой; не больше HISTORY_MAX. */
export function appendHistory(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, HISTORY_MAX)
}

const VERDICT_MARK: Readonly<Record<ClaimVerdict, string>> = {
  verified: '✓', cited: '✓', mismatch: '⚠', uncited: '✕', unknown_node: '✕', free: '·',
}

/** Экспорт в Markdown: вопрос, узел, версия промпта, ответ и сверка по утверждениям. */
export function exportMarkdown(entries: readonly HistoryEntry[]): string {
  return entries.map((e) => [
    `## ${e.question}`,
    `- время: ${e.at}; узел: \`${e.asked}\`; шаблон: ${e.templateId}; модель: ${e.model}; промпт: ${e.promptVersion}`,
    e.outcome === 'stopped' ? '- запрос остановлен пользователем, ответа нет' : `- проверка верности: ${e.report.pass ? 'пройдена' : 'не пройдена'}`,
    '',
    e.answer,
    '',
    '### Сверка утверждений',
    ...e.report.claims.map((c) => `- ${VERDICT_MARK[c.verdict]} ${c.text}`),
  ].join('\n')).join('\n\n---\n\n')
}

export function loadHistory(project: string): HistoryEntry[] {
  try { return parseHistory(localStorage.getItem(historyKey(project))) } catch { return [] }
}

export function saveHistory(project: string, list: readonly HistoryEntry[]): void {
  try { localStorage.setItem(historyKey(project), JSON.stringify(list)) } catch { /* приватный режим — история до перезагрузки */ }
}
