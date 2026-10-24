/**
 * Бюджет токенов контекста и детерминированное усечение по релевантности: узлы упорядочиваются по
 * расстоянию от узла вопроса, затем по роду (числа важнее справочных узлов), затем по id; берутся
 * жадно, пока помещаются. Оценка токенов — консервативная по длине JSON (кириллица ≈ 3 символа на токен
 * у распространённых токенизаторов); точный счёт зависит от модели и делается не здесь.
 */
import type { CtxNode } from './types'

/** Символов на токен — консервативно для русского текста и JSON. */
export const CHARS_PER_TOKEN = 3

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

const KIND_RANK: Readonly<Record<CtxNode['kind'], number>> = {
  formula: 0, diff: 0, fact: 1, parameter: 2, subblock: 3, dataset: 4, block: 5, screen: 6,
}

/** Порядок релевантности: узел вопроса → ближние → числовые → по id. */
export function byRelevance(asked: string) {
  return (a: CtxNode, b: CtxNode): number => {
    if (a.id === asked) return -1
    if (b.id === asked) return 1
    return a.distance - b.distance || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id)
  }
}

export interface TruncateResult<T> {
  kept: T[]
  dropped: number
  usedTokens: number
}

/**
 * Жадное усечение уже упорядоченных элементов по бюджету. Первый элемент (узел вопроса) при
 * `keepFirst` берётся всегда; элемент, который не помещается, пропускается — следующие (меньшие) ещё
 * могут войти. Порядок входа сохраняется.
 */
export function truncateByBudget<T>(ordered: readonly T[], cost: (item: T) => number, budget: number, keepFirst = true): TruncateResult<T> {
  const kept: T[] = []
  let used = 0
  let dropped = 0
  ordered.forEach((item, i) => {
    const c = cost(item)
    if ((keepFirst && i === 0) || used + c <= budget) {
      kept.push(item)
      used += c
    } else {
      dropped += 1
    }
  })
  return { kept, dropped, usedTokens: used }
}
