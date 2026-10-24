/**
 * Сериализация контекста в промпт: только то, что нужно модели, — id, подпись, род, статус паспорта,
 * значения ТЕКСТОМ (сырые числа остаются в объекте для проверки верности и в промпт не попадают),
 * рёбра и рамка решения. Ключи стабильны — промпт воспроизводим байт в байт.
 */
import type { CtxNode, MentatContext } from './types'

export interface PromptNode {
  id: string
  title: string
  kind: string
  d: number
  status?: string
  formula?: string
  parent?: string
  values?: Record<string, string>
  note?: string
}

export function promptNode(n: CtxNode): PromptNode {
  const values = n.values?.length ? Object.fromEntries(n.values.map((v) => [v.label, v.text])) : undefined
  return {
    id: n.id, title: n.title, kind: n.kind, d: n.distance,
    ...(n.status ? { status: n.status } : {}),
    ...(n.formula ? { formula: n.formula } : {}),
    ...(n.parent ? { parent: n.parent } : {}),
    ...(values ? { values } : {}),
    ...(n.note ? { note: n.note } : {}),
  }
}

/** JSON контекста для промпта (с отступом в 1 пробел — читаемо в «Показать промпт», дёшево по токенам). */
export function serializeContext(ctx: MentatContext): string {
  const payload = {
    version: ctx.version,
    asked: ctx.asked,
    scope: ctx.scope,
    nodes: ctx.nodes.map(promptNode),
    edges: ctx.edges.map((e) => [e.from, e.to, e.kind, e.label ?? '']),
    ...(ctx.truncated.dropped ? { truncated: `${ctx.truncated.dropped} дальних узлов не вошли в бюджет` } : {}),
  }
  return JSON.stringify(payload, null, 1)
}
