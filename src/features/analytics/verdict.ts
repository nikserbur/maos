/**
 * Строка-вердикт «Аналитики» (X2 «ответ сначала»): «План №28 · 618 оп.: все заказы в срок; узкое место —
 * «Резьбонарезной» 63 %; 73 % времени потока — ожидание → [Инвестпроект]». Факты — те же пороги, что у
 * рекомендаций (REC_THRESHOLDS) и узких мест (LOAD_THRESHOLDS); глиф — только у отклонения.
 * Без DOM — vitest.
 */
import type { KpiBundle } from '../../lib/api'
import { NBSP, countText, num, pct } from '../../explain/format'
import { LOAD_MARK, REC_THRESHOLDS, loadLevel, type TypeLoad } from './analyticsModel'
import { kpiField } from './kpiCatalog'
import { planTitle } from './planRuns'

export interface VerdictFact {
  key: 'otd' | 'bottleneck' | 'wait' | 'none'
  text: string
  /** Глиф отклонения (glyphs.css); норма — без глифа. */
  glyph?: 'glyph-setup' | 'glyph-down'
  /** Слово отклонения для экранного диктора. */
  word?: string
}

export interface Verdict {
  head: string
  facts: VerdictFact[]
  /** Узкое место — цель перехода «Инвестпроект». */
  bottleneck: { typeId: string; name: string; util: number } | null
}

export interface VerdictInput {
  seq: number | null
  nTasks: number
  bundle: KpiBundle | null
  loads: ReadonlyArray<TypeLoad>
}

const ORDERS = ['заказ', 'заказа', 'заказов'] as const

function otdFact(b: KpiBundle): VerdictFact | null {
  const nLate = kpiField(b, 'n_late')
  const otd = kpiField(b, 'otd')
  const low = Number.isFinite(otd) && otd < REC_THRESHOLDS.otd
  const dev = low ? { glyph: 'glyph-setup' as const, word: 'внимание' } : {}
  if (Number.isFinite(nLate)) {
    return nLate <= 0
      ? { key: 'otd', text: 'все заказы в срок' }
      : { key: 'otd', text: `просрочено ${countText(nLate, ORDERS)}${Number.isFinite(otd) ? ` (OTD ${pct(otd, 0)})` : ''}`, ...dev }
  }
  return Number.isFinite(otd) ? { key: 'otd', text: `в срок ${pct(otd, 0)} заказов`, ...dev } : null
}

function bottleneckOf(b: KpiBundle | null, loads: ReadonlyArray<TypeLoad>): Verdict['bottleneck'] {
  // Ранжир по результатам симуляции — тот же, что во вкладке «Узкие места»; иначе — блок KPI плана.
  const top = loads[0]
  if (top && top.utilization > 0) return { typeId: top.typeId, name: top.name, util: top.utilization }
  const bn = b?.bottleneck
  if (bn?.wc_type_id && typeof bn.utilization === 'number') return { typeId: bn.wc_type_id, name: bn.wc_name ?? bn.wc_type_id, util: bn.utilization }
  return null
}

export function buildVerdict({ seq, nTasks, bundle, loads }: VerdictInput): Verdict {
  const head = [planTitle(seq), nTasks > 0 ? `${num(nTasks, 0)}${NBSP}оп.` : ''].filter(Boolean).join(' · ')
  const facts: VerdictFact[] = []
  const otd = bundle ? otdFact(bundle) : null
  if (otd) facts.push(otd)
  const bn = bottleneckOf(bundle, loads)
  if (bn) {
    const level = loadLevel(bn.util)
    const mark = level === 'ok' ? {} : LOAD_MARK[level]
    facts.push({ key: 'bottleneck', text: `узкое место — «${bn.name}» ${pct(bn.util, 0)}`, ...mark })
  }
  const wait = bundle ? kpiField(bundle, 'wait_share') : Number.NaN
  if (Number.isFinite(wait) && wait > REC_THRESHOLDS.wait) {
    facts.push({ key: 'wait', text: `${pct(wait, 0)} времени потока — ожидание` })
  }
  if (facts.length === 0) facts.push({ key: 'none', text: 'показатели этого построения не сохранены — перестройте план' })
  return { head, facts, bottleneck: bn }
}

/** Вердикт одной строкой (aria-label, заголовок вкладки). */
export function verdictText(v: Verdict): string {
  return `${v.head}: ${v.facts.map((f) => (f.word ? `${f.text} (${f.word})` : f.text)).join('; ')}`
}
