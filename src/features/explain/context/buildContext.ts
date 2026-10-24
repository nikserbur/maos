/**
 * Сборщик контекста MENTAT: текущее состояние карты (DecisionContext → deriveState) + ответы API →
 * компактный граф вокруг узла вопроса. Узлы берутся по пути объяснения (explainPath: против рёбер от
 * результата к входам), к подблокам пути добавляются их формулы и параметры, затем факты (вклады,
 * двойственные, гейт, ходы, инвестпроект) и разности прогонов. Порядок и усечение детерминированы:
 * расстояние от узла вопроса → род узла → id. Чистая функция — без запросов и времени.
 */
import { getMetric } from '../../../explain/metrics'
import { ALL_EDGES } from '../../method-map/edges'
import { childrenOf, getNode } from '../../method-map/registry'
import { STATE_META } from '../../method-map/stateMeta'
import type { MapNode, MethodMapState, Provenance } from '../../method-map/types'
import type { OptResultExt } from '../../optimization/optTypes'
import { explainPath } from '../explainPath'
import { byRelevance, estimateTokens, truncateByBudget } from './budget'
import { diffRuns } from './diff'
import { buildFacts, type FactNode, type FactSources } from './facts'
import { promptNode } from './serialize'
import { CONTEXT_VERSION, type CtxEdge, type CtxNode, type CtxValue, type MentatContext } from './types'
import { compactValues, ctxValue } from './values'

export interface BuildContextInput extends FactSources {
  state: MethodMapState
  /** Узел вопроса: узел карты или id факта (`ag.rl.move.1`). */
  asked: string
  /** Прогон портфеля для сравнения (шаблон «сравни два прогона»). */
  compare?: OptResultExt | null
  scenarioName?: string
  /** Бюджет токенов на контекст (узлы + рёбра). */
  budgetTokens?: number
  /** Глубина пути объяснения. */
  depth?: number
}

export const DEFAULT_BUDGET_TOKENS = 3000
export const DEFAULT_DEPTH = 3
/** Доля бюджета под рёбра (не больше EDGE_RESERVE_MAX токенов). */
const EDGE_RESERVE_SHARE = 0.15
const EDGE_RESERVE_MAX = 400
/** Справка «что это» — только у ближних узлов (экономия бюджета). */
const NOTE_MAX_DISTANCE = 1
const NOTE_MAX_CHARS = 200

const PROVENANCE_STATUS: Readonly<Record<Provenance, string>> = {
  observed: 'Н', estimated: 'О', calibrated: 'К', normative: 'НОРМ', manual: 'вручную', default: 'по умолчанию', ui: 'UI', synthetic: 'синтетика',
}

const clip = (s: string | undefined): string | undefined => (s && s.length > NOTE_MAX_CHARS ? `${s.slice(0, NOTE_MAX_CHARS - 1)}…` : s)

/** Значения формулы: живые плейсхолдеры «i» с подписями и единицами реестра. */
function formulaValues(node: MapNode, state: MethodMapState): CtxValue[] {
  const raw = state.values[node.id]
  if (!raw) return []
  const metric = node.metricId ? getMetric(node.metricId) : undefined
  const vars = new Map((metric?.variables ?? []).map((v) => [v.key, v]))
  return compactValues(Object.keys(raw).sort().map((key) => {
    const v = vars.get(key)
    if (v) return ctxValue(key, v.label, raw[key], v.unit)
    // Ключ вне обозначений реестра: n — число сценариев/наблюдений, прочие — величина самой формулы.
    if (key === 'n' || key.startsWith('n_')) return ctxValue(key, key === 'n' ? 'Число сценариев N' : key, raw[key])
    return ctxValue(key, `${metric?.title ?? node.title} (${key})`, raw[key], metric?.unit)
  }))
}

function mapCtxNode(node: MapNode, distance: number, state: MethodMapState): CtxNode {
  const live = state.nodes[node.id]
  const base: CtxNode = {
    id: node.id, title: node.title, kind: node.kind, block: node.block, mapNode: node.id, distance,
    ...(node.parent ? { parent: node.parent } : {}),
    ...(live ? { state: live.state } : {}),
  }
  const metric = node.metricId ? getMetric(node.metricId) : undefined
  const note = distance <= NOTE_MAX_DISTANCE ? clip(metric?.short ?? node.short) : undefined
  const withNote = note ? { ...base, note } : base
  if (live?.state === 'planned') return { ...withNote, status: 'в плане' }
  if (node.kind === 'parameter' && node.paramId) {
    const p = state.params[node.paramId]
    if (!p) return withNote
    const values = compactValues([ctxValue('value', p.label, p.value, p.unit)])
    return { ...withNote, status: p.status || PROVENANCE_STATUS[p.provenance], ...(values.length ? { values } : {}) }
  }
  if (node.kind === 'formula') {
    const values = formulaValues(node, state)
    return { ...withNote, formula: node.metricId, status: values.length ? 'расчёт' : 'нет прогона', ...(values.length ? { values } : {}) }
  }
  if (node.kind === 'dataset') {
    // Статус серверного паспорта датасета — поле `status` живого состояния (бейджа «паспорт …» больше нет).
    const status = live?.status ?? (live?.badge === 'синтетика' ? 'синтетика' : undefined)
    return status ? { ...withNote, status } : withNote
  }
  // Подблок/блок: состояние расчёта, а не статус паспорта (иначе «оценено» читается как [О]).
  if (!live) return withNote
  const done = live.state === 'estimated' || live.state === 'calibrated'
  return { ...withNote, status: done ? 'рассчитано' : STATE_META[live.state].label }
}

/** Узлы карты на пути объяснения с расстояниями от узла вопроса. */
function pathDistances(asked: MapNode, depth: number): Map<string, number> {
  const isRoot = asked.kind === 'block' || asked.kind === 'subblock'
  const root = isRoot ? asked : getNode(asked.parent ?? '') ?? asked
  const offset = root.id === asked.id ? 0 : 1
  const dist = new Map<string, number>([[asked.id, 0]])
  for (const step of explainPath(root.id, depth)) {
    if (!dist.has(step.id)) dist.set(step.id, step.depth + offset)
  }
  // Листья подблоков пути: формулы (там живые числа), параметры, датасеты.
  for (const [id, d] of [...dist.entries()]) {
    const n = getNode(id)
    if (!n || (n.kind !== 'subblock' && n.kind !== 'block')) continue
    for (const child of childrenOf(id)) {
      if (child.kind === 'screen' || child.kind === 'subblock' || dist.has(child.id)) continue
      dist.set(child.id, d + 1)
    }
  }
  return dist
}

function factDistance(f: FactNode, dist: ReadonlyMap<string, number>, far: number): number {
  const anchor = dist.get(f.mapNode) ?? dist.get(getNode(f.mapNode)?.parent ?? '')
  return anchor === undefined ? far : anchor + 1
}

function buildEdges(kept: readonly CtxNode[], budget: number): { edges: CtxEdge[]; tokens: number } {
  const ids = new Map(kept.map((n) => [n.id, n.distance]))
  const all = ALL_EDGES
    .filter((e) => e.kind !== 'explain' && e.from !== e.to && ids.has(e.from) && ids.has(e.to))
    .map((e): CtxEdge => ({ from: e.from, to: e.to, kind: e.kind, ...(e.label ? { label: e.label } : {}) }))
    .sort((a, b) => Math.max(ids.get(a.from)!, ids.get(a.to)!) - Math.max(ids.get(b.from)!, ids.get(b.to)!)
      || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  const t = truncateByBudget(all, (e) => estimateTokens(JSON.stringify(e)), budget, false)
  return { edges: t.kept, tokens: t.usedTokens }
}

function safeDiff(input: BuildContextInput): FactNode[] {
  try {
    return diffRuns(input.opt, input.compare)
  } catch (e) {
    console.warn('MENTAT: разности прогонов пропущены —', e)
    return []
  }
}

/** Контекст для вопроса об узле `asked`. Неизвестный узел → пустой контекст (модель ответит «нет данных»). */
export function buildContext(input: BuildContextInput): MentatContext {
  const budget = input.budgetTokens ?? DEFAULT_BUDGET_TOKENS
  const depth = input.depth ?? DEFAULT_DEPTH
  // Факты и разности — под предохранителем (buildFacts — по каждому построителю): неполный ответ API не роняет панель.
  const facts = [...buildFacts(input), ...safeDiff(input)]
  const askedFact = facts.find((f) => f.id === input.asked)
  const askedNode = getNode(askedFact ? askedFact.mapNode : input.asked)
  const scope = {
    ...input.state.context,
    ...(input.scenarioName ? { scenarioName: input.scenarioName } : {}),
    ...(input.compare?.run_id ? { compareRunId: input.compare.run_id } : {}),
    computedAt: input.state.computedAt,
  }
  if (!askedNode) {
    return { version: CONTEXT_VERSION, asked: input.asked, scope, nodes: [], edges: [], truncated: { kept: 0, dropped: 0, budgetTokens: budget, usedTokens: 0 } }
  }
  const dist = pathDistances(askedNode, depth)
  if (askedFact) {
    // Вопрос о факте: факт — центр (0), его узел карты — на шаг дальше.
    for (const [id, d] of [...dist.entries()]) dist.set(id, d + 1)
  }
  const far = depth + 3
  const mapNodes = [...dist.entries()]
    .map(([id, d]) => ({ n: getNode(id), d }))
    .filter((x): x is { n: MapNode; d: number } => Boolean(x.n) && x.n!.kind !== 'screen' && (x.n!.kind !== 'block' || x.n!.id === askedNode.id))
    .map(({ n, d }) => mapCtxNode(n, d, input.state))
  const factNodes: CtxNode[] = facts.map((f) => ({ ...f, distance: f.id === input.asked ? 0 : factDistance(f, dist, far) }))
  const ordered = [...mapNodes, ...factNodes].sort(byRelevance(askedFact ? askedFact.id : askedNode.id))

  const edgeReserve = Math.min(EDGE_RESERVE_MAX, Math.floor(budget * EDGE_RESERVE_SHARE))
  const t = truncateByBudget(ordered, (n) => estimateTokens(JSON.stringify(promptNode(n))), budget - edgeReserve)
  const { edges, tokens } = buildEdges(t.kept, budget - t.usedTokens)
  return {
    version: CONTEXT_VERSION,
    asked: askedFact ? askedFact.id : askedNode.id,
    scope,
    nodes: t.kept,
    edges,
    truncated: { kept: t.kept.length, dropped: t.dropped, budgetTokens: budget, usedTokens: t.usedTokens + tokens },
  }
}
