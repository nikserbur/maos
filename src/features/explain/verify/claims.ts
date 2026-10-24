/**
 * Разбиение ответа на утверждения: строки → предложения (граница — «. ! ? …» перед заглавной, цифрой,
 * кавычкой или ссылкой), маркеры списков и разметка снимаются. Ссылки ⟦node:id⟧ у каждого утверждения;
 * ссылки, стоящие в начале фрагмента (модель поставила их после точки), относятся к предыдущему.
 */
import { parseNumbers, type ParsedNumber } from './numbers'

export interface Claim {
  index: number
  /** Текст без ссылок — для показа. */
  text: string
  citations: string[]
  numbers: ParsedNumber[]
}

/** ⟦node:id⟧ — основная форма; [[node:id]] — запасная (модель без «⟦⟧» в словаре). */
const CITE = /⟦\s*node\s*:\s*([^⟧\s,;]+)\s*⟧|\[\[\s*node\s*:\s*([^\]\s,;]+)\s*\]\]/g
const LEADING_CITES = /^(?:\s*(?:⟦\s*node\s*:[^⟧]*⟧|\[\[\s*node\s*:[^\]]*\]\]))+/
const BULLET = /^\s*(?:#{1,6}\s+|[-*•–—]\s+|\d{1,2}[.)]\s+)/
const SENTENCE_END = /([.!?…])\s+(?=[A-ZА-ЯЁ«"(⟦[\d+\-−–])/g

export function citationsOf(text: string): string[] {
  return Array.from(text.matchAll(CITE), (m) => (m[1] ?? m[2]).replace(/[.,;:]+$/, ''))
}

export function stripCitations(text: string): string {
  return text.replace(CITE, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

function sentences(line: string): string[] {
  const out: string[] = []
  let last = 0
  for (const m of line.matchAll(SENTENCE_END)) {
    const cut = (m.index ?? 0) + m[1].length
    out.push(line.slice(last, cut))
    last = cut
  }
  out.push(line.slice(last))
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Утверждения ответа в порядке текста. */
export function splitClaims(answer: string): Claim[] {
  const frags = answer
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(BULLET, '').replace(/\*\*|__/g, '').trim())
    .filter(Boolean)
    .flatMap(sentences)
  const claims: Claim[] = []
  for (const frag of frags) {
    const lead = frag.match(LEADING_CITES)?.[0] ?? ''
    const prev = claims[claims.length - 1]
    if (lead && prev) prev.citations.push(...citationsOf(lead))
    const body = lead && prev ? frag.slice(lead.length) : frag
    const text = stripCitations(body)
    if (!/[\p{L}\p{N}]/u.test(text)) continue
    claims.push({ index: claims.length, text, citations: citationsOf(body), numbers: parseNumbers(text) })
  }
  return claims.map((c) => ({ ...c, citations: [...new Set(c.citations)] }))
}
