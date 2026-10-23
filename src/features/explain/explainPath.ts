/**
 * Объяснение = путь по рёбрам карты от результата к параметрам (UX-V2 §7 G4, `explainPath.ts`):
 * обход в ширину ПРОТИВ рёбер данных / параметров / управления / обратной связи от узла-результата
 * (рёбра «объяснение» — сам MENTAT — пропускаются), с глубиной и подписью ребра, затем параметры
 * посещённых подблоков. Это и есть «почему так»: какие входы и с какими весами дошли до числа.
 * Чистая функция; LLM лишь пересказывает этот путь (подключится позже), не выдумывая связей.
 */
import { ALL_EDGES } from '../method-map/edges'
import { childrenOf, getNode } from '../method-map/registry'
import type { MapEdgeKind, MapNode } from '../method-map/types'

export interface ExplainStep {
  id: string
  title: string
  kind: MapNode['kind']
  /** Расстояние от результата (0 — сам результат). */
  depth: number
  /** Ребро, по которому узел влияет на предыдущий шаг. */
  via?: { label: string; kind: MapEdgeKind; to: string }
}

const SKIP: ReadonlySet<MapEdgeKind> = new Set(['explain'])

export function explainPath(target: string, maxDepth = 3): ExplainStep[] {
  const root = getNode(target)
  if (!root) return []
  const out: ExplainStep[] = [{ id: root.id, title: root.title, kind: root.kind, depth: 0 }]
  const seen = new Set<string>([root.id])
  let frontier = [root.id]
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = []
    for (const to of frontier) {
      for (const e of ALL_EDGES) {
        if (e.to !== to || e.from === to || SKIP.has(e.kind) || seen.has(e.from)) continue
        const n = getNode(e.from)
        if (!n || n.kind === 'block') continue
        seen.add(n.id)
        next.push(n.id)
        out.push({ id: n.id, title: n.title, kind: n.kind, depth, via: { label: e.label ?? e.kind, kind: e.kind, to } })
      }
    }
    frontier = next
  }
  // Параметры посещённых подблоков — «ручки», которыми пользователь меняет результат.
  for (const step of [...out]) {
    for (const p of childrenOf(step.id)) {
      if (p.kind !== 'parameter' || seen.has(p.id)) continue
      seen.add(p.id)
      out.push({ id: p.id, title: p.title, kind: p.kind, depth: step.depth + 1, via: { label: 'параметр', kind: 'param', to: step.id } })
    }
  }
  return out
}

export interface MentatTemplate {
  id: string
  question: string
  /** Узел-результат, от которого строится путь. */
  target: string
  /** Экраны, где вопрос уместен первым. */
  screens: readonly string[]
}

export const MENTAT_TEMPLATES: readonly MentatTemplate[] = [
  { id: 'cmax', question: 'Почему E[Cmax] плана именно такой и что его удлиняет?', target: 'crit.schedule', screens: ['plan', 'analytics'] },
  { id: 'bottleneck', question: 'Почему узкое место — этот тип станков?', target: 'dec.schedule', screens: ['plan', 'scheme'] },
  { id: 'cvar', question: 'Что определило CVaR прибыли портфеля?', target: 'crit.profit', screens: ['optimization', 'scenarios'] },
  { id: 'cash', question: 'Почему касса может уйти в разрыв и при каком α?', target: 'crit.cash', screens: ['plan', 'optimization'] },
  { id: 'rl', question: 'Почему агент RL не предлагает ходов и чемпион — правило?', target: 'ag.rl', screens: ['agents', 'plan', 'map'] },
  { id: 'prices', question: 'Откуда берутся сценарии цен и насколько им верить?', target: 'dist.prices', screens: ['scenarios', 'monitoring'] },
  { id: 'planfact', question: 'Почему факт разошёлся с планом?', target: 'mon.planfact', screens: ['analytics', 'monitoring'] },
]

/** Шаблоны в порядке уместности для экрана (сначала свои, затем остальные). */
export function templatesFor(screenId: string): MentatTemplate[] {
  const own = MENTAT_TEMPLATES.filter((t) => t.screens.includes(screenId))
  return [...own, ...MENTAT_TEMPLATES.filter((t) => !t.screens.includes(screenId))]
}
