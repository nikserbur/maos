/**
 * `deriveState()` — живое состояние карты из того, что фронтенд уже знает
 * (UX-V2 §3.9, §3.11: «бэкенд не отдаёт state → карта работает по deriveState()»).
 * Чистая функция: вход `DeriveInput` → `MethodMapState` с тем же контрактом,
 * что будущий `GET /api/method-map/state`. Ничего не запрашивает и не мутирует.
 */
import type { DeriveInput } from './deriveInput'
import { deriveSubblocks } from './deriveNodes'
import { derivePassports } from './derivePassports'
import { deriveValuesByMetric } from './deriveValues'
import { DATASET_PASSPORT } from './params'
import { NODES, childrenOf, getNode, subblocksOf } from './registry'
import { STATE_META, stateFromProvenance, worstState } from './stateMeta'
import { BLOCK_IDS, type MapNode, type MethodMapState, type NodeLive, type ParameterPassport } from './types'

const PLANNED: NodeLive = { state: 'planned' }

/**
 * Лист (параметр / формула / датасет / экран) — по паспорту или по родителю. Статус паспорта не
 * становится бейджем («паспорт НОРМ»): его показывает бейдж происхождения в панели (X2 P-124).
 */
function leafLive(node: MapNode, parent: NodeLive, passports: Record<string, ParameterPassport>, hasValues: boolean, input: DeriveInput): NodeLive {
  if (node.stage && node.stage !== 'done') return { ...PLANNED, badge: STATE_META.planned.label }
  if (node.kind === 'dataset' && DATASET_PASSPORT[node.id] && input.passport?.[DATASET_PASSPORT[node.id]]) {
    const sp = input.passport[DATASET_PASSPORT[node.id]]
    if (sp.status === 'синтетика') return { state: 'stale', badge: 'синтетика', status: sp.status, reason: sp.note || 'синтетические данные: обучение и проверка на них запрещены (R7)', updatedAt: parent.updatedAt }
    return { state: parent.state, status: sp.status, detail: sp.source || undefined, updatedAt: parent.updatedAt }
  }
  if (node.kind === 'parameter' && node.paramId) {
    const p = passports[node.paramId]
    if (!p) return { state: 'default' }
    if (p.stage && p.stage !== 'done') return { ...PLANNED, badge: STATE_META.planned.label }
    return {
      state: p.deprecated ? 'default' : stateFromProvenance(p.provenance),
      badge: p.deprecated ? 'не используется' : undefined,
      value: p.value ?? undefined,
      unit: p.unit,
      reason: p.outOfRange ? 'вне разумного диапазона' : p.deprecated ? 'ползунок принят сервером, но в расчёте не участвует' : undefined,
      updatedAt: p.estimatedAt,
    }
  }
  if (node.kind === 'formula') {
    if (parent.state === 'planned') return PLANNED
    return hasValues
      ? { state: 'estimated', badge: 'значения последнего расчёта', updatedAt: parent.updatedAt }
      : { state: parent.state === 'error' ? 'error' : 'default', badge: 'нет расчёта' }
  }
  return { state: parent.state, updatedAt: parent.updatedAt }
}

/**
 * Блок: состояние = худшее из подблоков (`planned` не ухудшает), бейдж — контекст первого
 * реализованного подблока (имя сценария, портфель, станки…, UX-V2 §3.7), вторая строка — какой
 * подблок тянет блок вниз («Транши…: касса: не решено за 30 с»), либо счётчики «рассчитано · в плане».
 */
function blockLive(block: string, live: Record<string, NodeLive>): NodeLive {
  const subs = subblocksOf(block as MapNode['block'])
  const states = subs.map((s) => live[s.id]?.state ?? 'unconfigured')
  const state = worstState(states)
  const planned = states.filter((s) => s === 'planned').length
  const ready = states.filter((s) => s === 'estimated' || s === 'calibrated').length
  const primary = subs.find((s) => live[s.id]?.state !== 'planned') ?? subs[0]
  const primaryLive = primary ? live[primary.id] : undefined
  const worst = subs.find((s) => live[s.id]?.state === state)
  const worstLive = worst ? live[worst.id] : undefined
  const counts = [ready ? `рассчитано ${ready}` : null, planned ? `${planned} в плане` : null].filter(Boolean).join(' · ')
  const detail = state === 'planned'
    ? 'ещё не реализовано'
    : worst && worst !== primary && worstLive?.badge
      ? `${worst.title}: ${worstLive.badge}`
      : primaryLive?.detail ?? counts
  return {
    state,
    badge: primaryLive?.badge,
    detail: detail || undefined,
    reason: worstLive?.reason,
    updatedAt: subs.map((s) => live[s.id]?.updatedAt).filter(Boolean).sort().pop(),
  }
}

/** Подблок, который определяет состояние блока (первый с худшим состоянием) — для первой строки панели. */
export function worstSubblock(state: MethodMapState, block: MapNode['block']): MapNode | undefined {
  const own = state.nodes[block]?.state
  return subblocksOf(block).find((s) => state.nodes[s.id]?.state === own)
}

export function deriveState(input: DeriveInput): MethodMapState {
  const passports = derivePassports(input)
  const byMetric = deriveValuesByMetric(input.opt.result, input.plan.result, input.forecast, input.cash.result, input.fin, input.macro)
  const subblocks = deriveSubblocks(input, passports)

  const nodes: Record<string, NodeLive> = { ...subblocks }
  const values: MethodMapState['values'] = {}

  // Листья наследуют от подблока; формулы получают живые значения последнего прогона.
  for (const node of NODES) {
    if (node.kind === 'block' || node.kind === 'subblock') continue
    const parent = nodes[node.parent ?? ''] ?? PLANNED
    const metricValues = node.metricId ? byMetric[node.metricId] : undefined
    if (metricValues) values[node.id] = metricValues
    nodes[node.id] = leafLive(node, parent, passports, Boolean(metricValues), input)
  }
  // Подблоки без явного правила (их не должно быть — тест проверяет) считаются по детям.
  for (const node of NODES) {
    if (node.kind !== 'subblock' || nodes[node.id]) continue
    const kids = childrenOf(node.id).map((k) => nodes[k.id]?.state ?? 'default')
    nodes[node.id] = { state: kids.length ? worstState(kids) : node.stage && node.stage !== 'done' ? 'planned' : 'default' }
  }
  for (const block of BLOCK_IDS) nodes[block] = blockLive(block, nodes)

  return {
    context: input.context,
    computedAt: new Date(input.now).toISOString(),
    source: 'derived',
    nodes,
    params: passports,
    values,
  }
}

/** Состояние узла с безопасным откатом (узел неизвестен → `unconfigured`). */
export function liveOf(state: MethodMapState | null, id: string): NodeLive {
  return state?.nodes[id] ?? { state: getNode(id)?.stage && getNode(id)?.stage !== 'done' ? 'planned' : 'unconfigured' }
}
