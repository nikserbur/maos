/**
 * Проверка верности ответа MENTAT (METHODOLOGY-V2 §9): каждое числовое утверждение должно совпадать со
 * значением узла, на который оно ссылается (в пределах округления показанного формата), утверждение с
 * числом без ссылки и ссылка на узел вне контекста — ошибки. Вердикт по каждому утверждению — для бейджей
 * UI (✓ сверено / ⚠ число не совпало / ✕ нет ссылки / ✕ неизвестный узел).
 */
import type { CtxNode, CtxValue, MentatContext } from '../context/types'
import { splitClaims } from './claims'
import { parseNumbers, toleranceOf, type ParsedNumber } from './numbers'

export type ClaimVerdict = 'verified' | 'cited' | 'mismatch' | 'uncited' | 'unknown_node' | 'free'

export interface NumberMatch {
  nodeId: string
  key: string
  text: string
  /** Совпало только по модулю (знак в тексте не указан, значение отрицательное). */
  absOnly: boolean
}

export interface NumberCheck {
  raw: string
  match: NumberMatch | null
}

export interface ClaimCheck {
  index: number
  text: string
  citations: string[]
  unknown: string[]
  numbers: NumberCheck[]
  verdict: ClaimVerdict
}

export interface VerifyReport {
  claims: ClaimCheck[]
  counts: Record<ClaimVerdict, number>
  /** Нет ни одного несовпадения, утверждения с числом без ссылки и ссылки на неизвестный узел. */
  pass: boolean
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol

/** Числа внутри текстовых значений («режим 2», «Токарный 16») — тоже допустимые цели сверки. */
function textNumbers(v: CtxValue): ParsedNumber[] {
  return v.unitKind === 'text' ? parseNumbers(String(v.value)) : []
}

/** Совпадает ли число текста со значением узла (с учётом единиц и формата). Возвращает 'abs' при совпадении по модулю. */
export function matchesValue(n: ParsedNumber, v: CtxValue): false | 'exact' | 'abs' {
  if (v.unitKind === 'text') {
    return textNumbers(v).some((t) => near(Math.abs(n.value), Math.abs(t.value), Math.max(toleranceOf(n), toleranceOf(t)))) ? 'exact' : false
  }
  const target = Number(v.value)
  const tol = toleranceOf(n)
  const candidates: Array<{ x: number; t: number }> = []
  switch (n.unit) {
    case 'percent':
      if (v.unitKind === 'pct') candidates.push({ x: n.value / 100, t: tol / 100 })
      if (v.unitKind === 'pp' || v.unitKind === 'plain') candidates.push({ x: n.value, t: tol })
      break
    case 'money':
      if (v.unitKind === 'money' || n.scale === 1) candidates.push({ x: n.value, t: tol })
      break
    case 'hours':
      if (v.unitKind === 'hours' || v.unitKind === 'plain') candidates.push({ x: n.value, t: tol })
      break
    default:
      if (v.unitKind !== 'money' || n.scale === 1) candidates.push({ x: n.value, t: tol })
      if (v.unitKind === 'pct') candidates.push({ x: n.value / 100, t: tol / 100 })
  }
  for (const c of candidates) {
    if (near(c.x, target, c.t)) return n.sign === '+' && target < 0 ? false : 'exact'
    if (n.sign === null && near(c.x, Math.abs(target), c.t)) return 'abs'
  }
  return false
}

function findMatch(n: ParsedNumber, nodes: readonly CtxNode[]): NumberMatch | null {
  let absHit: NumberMatch | null = null
  for (const node of nodes) {
    for (const v of node.values ?? []) {
      const r = matchesValue(n, v)
      if (r === 'exact') return { nodeId: node.id, key: v.key, text: v.text, absOnly: false }
      if (r === 'abs' && !absHit) absHit = { nodeId: node.id, key: v.key, text: v.text, absOnly: true }
    }
  }
  return absHit
}

const EMPTY_COUNTS: Record<ClaimVerdict, number> = { verified: 0, cited: 0, mismatch: 0, uncited: 0, unknown_node: 0, free: 0 }

/** Проверить ответ против контекста, по которому он получен. */
export function verifyAnswer(answer: string, ctx: MentatContext): VerifyReport {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]))
  const claims = splitClaims(answer).map((c): ClaimCheck => {
    const known = c.citations.filter((id) => byId.has(id)).map((id) => byId.get(id)!)
    const unknown = c.citations.filter((id) => !byId.has(id))
    const numbers = c.numbers.map((n): NumberCheck => ({ raw: n.raw, match: findMatch(n, known) }))
    const verdict: ClaimVerdict = unknown.length ? 'unknown_node'
      : !c.citations.length ? (numbers.length ? 'uncited' : 'free')
        : numbers.some((n) => !n.match) ? 'mismatch'
          : numbers.length ? 'verified' : 'cited'
    return { index: c.index, text: c.text, citations: c.citations, unknown, numbers, verdict }
  })
  const counts = claims.reduce((acc, c) => ({ ...acc, [c.verdict]: acc[c.verdict] + 1 }), EMPTY_COUNTS)
  return { claims, counts, pass: counts.mismatch + counts.uncited + counts.unknown_node === 0 }
}
