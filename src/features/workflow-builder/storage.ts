/*
 * Черновик воркфлоу в localStorage (только этот браузер) и экспорт в .json.
 * Содержимому хранилища не доверяем: узлы и связи проверяются поле за полем, мусор отбрасывается.
 * Версия 2: прежний стартовый граф v1 заменяется схемой MENTAT, только если его не трогали;
 * свой граф пользователя переносится как есть.
 */
import { LEGACY_STORAGE_KEY, STORAGE_KEY, isNodeType, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from './types'
import { isUntouchedLegacySeed, seedGraph } from './seed'

const hasLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function toNode(v: unknown): WorkflowNode | null {
  if (!isObj(v) || typeof v.id !== 'string' || !isNodeType(v.type)) return null
  const x = finite(v.x)
  const y = finite(v.y)
  if (x === null || y === null) return null
  return { id: v.id, type: v.type, x: Math.round(x), y: Math.round(y), title: typeof v.title === 'string' ? v.title : '', notes: typeof v.notes === 'string' ? v.notes : '' }
}

function toEdge(v: unknown, ids: ReadonlySet<string>): WorkflowEdge | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.from !== 'string' || typeof v.to !== 'string') return null
  if (!ids.has(v.from) || !ids.has(v.to) || v.from === v.to) return null
  const label = typeof v.label === 'string' && v.label.trim() ? v.label : undefined
  return { id: v.id, from: v.from, to: v.to, ...(label ? { label } : {}) }
}

/** Проверенный граф из произвольного значения или null. */
export function sanitizeGraph(value: unknown): WorkflowGraph | null {
  if (!isObj(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null
  const nodes = value.nodes.map(toNode).filter((n): n is WorkflowNode => n !== null)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = value.edges.map((e) => toEdge(e, ids)).filter((e): e is WorkflowEdge => e !== null)
  return { nodes, edges }
}

function read(key: string): WorkflowGraph | null {
  const raw = window.localStorage.getItem(key)
  return raw ? sanitizeGraph(JSON.parse(raw)) : null
}

/** Загрузка при монтировании: черновик v2 → перенос v1 (нетронутый пример — заменяется) → схема MENTAT. */
export function loadGraph(): WorkflowGraph {
  if (!hasLocalStorage()) return seedGraph()
  try {
    const current = read(STORAGE_KEY)
    if (current) return current
    const legacy = read(LEGACY_STORAGE_KEY)
    if (legacy && !isUntouchedLegacySeed(legacy)) return legacy
  } catch {
    // Повреждённый черновик или закрытое хранилище — начинаем со схемы MENTAT.
  }
  return seedGraph()
}

/** Автосохранение; false — браузер не дал записать (квота, приватный режим). */
export function saveGraph(graph: WorkflowGraph): boolean {
  if (!hasLocalStorage()) return false
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
    return true
  } catch {
    return false
  }
}

/** Файл экспорта: версия формата, время и сам граф. */
export function exportJson(graph: WorkflowGraph, now: Date = new Date()): string {
  return JSON.stringify({ format: 'maos.aiWorkflow', version: 2, exportedAt: now.toISOString(), ...graph }, null, 2)
}

/** Скачать граф как .json (Blob + временная ссылка). */
export function downloadJson(graph: WorkflowGraph, filename = 'ai-workflow-mentat.json'): void {
  const url = URL.createObjectURL(new Blob([exportJson(graph)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
