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
import { NODES, childrenOf, getNode, subblocksOf } from './registry'
import { STATE_META, stateFromProvenance, worstState } from './stateMeta'
import { BLOCK_IDS, type MapNode, type MethodMapState, type NodeLive, type ParameterPassport } from './types'

const PLANNED: NodeLive = { state: 'planned' }

/** Лист (параметр / формула / датасет / экран) — по паспорту или по родителю. */
function leafLive(node: MapNode, parent: NodeLive, passports: Record<string, ParameterPassport>, hasValues: boolean): NodeLive {
  if (node.stage && node.stage !== 'done') return { ...PLANNED, badge: 'в плане' }
  if (node.kind === 'parameter' && node.paramId) {
    const p = passports[node.paramId]
    if (!p) return { state: 'default' }
    if (p.stage && p.stage !== 'done') return { ...PLANNED, badge: 'в плане' }
    return {
      state: stateFromProvenance(p.provenance),
      value: p.value ?? undefined,
      unit: p.unit,
      reason: p.outOfRange ? 'вне разумного диапазона' : undefined,
    }
  }
  if (node.kind === 'formula') {
    if (parent.state === 'planned') return PLANNED
    return hasValues
      ? { state: 'estimated', badge: 'значения последнего прогона', updatedAt: parent.updatedAt }
      : { state: parent.state === 'error' ? 'error' : 'default', badge: 'нет прогона' }
  }
  return { state: parent.state, updatedAt: parent.updatedAt }
}

/**
 * Блок: состояние = худшее из подблоков (`planned` не ухудшает), бейдж — контекст
 * первого реализованного подблока (имя сценария, портфель, станки…, UX-V2 §3.7),
 * вторая строка — что именно тянет блок вниз, либо счётчики «рассчитано · в плане».
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
      ? `${STATE_META[state].label}: ${worstLive.badge}`
      : primaryLive?.detail ?? counts
  return {
    state,
    badge: primaryLive?.badge,
    detail: detail || undefined,
    reason: worstLive?.reason,
    updatedAt: subs.map((s) => live[s.id]?.updatedAt).filter(Boolean).sort().pop(),
  }
}

export function deriveState(input: DeriveInput): MethodMapState {
  const passports = derivePassports(input)
  const byMetric = deriveValuesByMetric(input.opt.result, input.plan.result, input.forecast)
  const subblocks = deriveSubblocks(input, passports)

  const nodes: Record<string, NodeLive> = { ...subblocks }
  const values: MethodMapState['values'] = {}

  // Листья наследуют от подблока; формулы получают живые значения последнего прогона.
  for (const node of NODES) {
    if (node.kind === 'block' || node.kind === 'subblock') continue
    const parent = nodes[node.parent ?? ''] ?? PLANNED
    const metricValues = node.metricId ? byMetric[node.metricId] : undefined
    if (metricValues) values[node.id] = metricValues
    nodes[node.id] = leafLive(node, parent, passports, Boolean(metricValues))
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
