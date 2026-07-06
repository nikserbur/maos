/*
 * Персистентность графа воркфлоу в localStorage.
 * SSR-безопасно: любые обращения к window/localStorage под typeof-гардом.
 */
import { STORAGE_KEY, seedGraph, type WorkflowGraph } from './types'

const hasLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

/** Валидация загруженного объекта — не доверяем содержимому storage. */
function isGraph(value: unknown): value is WorkflowGraph {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return Array.isArray(g.nodes) && Array.isArray(g.edges)
}

/** Загрузка при монтировании: сохранённый граф или стартовый пример. */
export function loadGraph(): WorkflowGraph {
  if (!hasLocalStorage()) return seedGraph()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedGraph()
    const parsed: unknown = JSON.parse(raw)
    return isGraph(parsed) ? parsed : seedGraph()
  } catch {
    return seedGraph()
  }
}

/** Автосохранение графа. Ошибки квоты/приватного режима не пробрасываем. */
export function saveGraph(graph: WorkflowGraph): void {
  if (!hasLocalStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
  } catch {
    /* noop — квота или приватный режим */
  }
}
