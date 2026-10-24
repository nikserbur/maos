/**
 * Строки панели узла (X2 P-128): узел-строка показывает живое значение (параметр — значение паспорта,
 * формула — главное число последнего расчёта, подблок — его бейдж), а не общий бейдж; заголовок
 * переносится до двух строк. Ребро — вид связи по-русски (EDGE_KIND_LABEL), а не `data/feedback`.
 */
import type { ReactNode } from 'react'
import { fmtValue } from '../../explain/format'
import { getMetric } from '../../explain/metrics'
import { blockTag } from './blocks'
import { liveOf } from './deriveState'
import { valueText } from './PassportTable'
import { getNode } from './registry'
import { StateGlyph } from './StateGlyph'
import type { MapEdge, MapEdgeKind, MapNode, MethodMapState } from './types'

export const KIND_LABEL: Readonly<Record<MapNode['kind'], string>> = {
  block: 'блок', subblock: 'подблок', parameter: 'параметр', formula: 'формула', dataset: 'данные', screen: 'экран',
}

export const EDGE_KIND_LABEL: Readonly<Record<MapEdgeKind, string>> = {
  data: 'данные', param: 'параметр', feedback: 'обратная связь', control: 'управление', explain: 'объяснение',
}

/** Главное число формулы: переменная в единице показателя (или первая) из живых значений. */
function formulaValue(node: MapNode, state: MethodMapState): string | undefined {
  const metric = node.metricId ? getMetric(node.metricId) : undefined
  const vals = state.values[node.id]
  if (!metric || !vals) return undefined
  const v = metric.variables.find((x) => x.unit === metric.unit && vals[x.key] != null) ?? metric.variables.find((x) => vals[x.key] != null)
  return v ? fmtValue(vals[v.key] ?? null, v.unit) : undefined
}

/** Что показать справа в строке узла: живое значение, иначе бейдж состояния. */
export function rowValue(node: MapNode, state: MethodMapState): string | undefined {
  if (node.kind === 'parameter' && node.paramId && state.params[node.paramId]) return valueText(state.params[node.paramId])
  if (node.kind === 'formula') return formulaValue(node, state) ?? liveOf(state, node.id).badge
  return liveOf(state, node.id).badge
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mm-panel__sec">
      <h3 className="mm-panel__label text-caps">{title}</h3>
      {children}
    </section>
  )
}

export function NodeRow({ node, live, onSelect }: { node: MapNode; live: MethodMapState; onSelect: (id: string) => void }) {
  const l = liveOf(live, node.id)
  const value = rowValue(node, live)
  return (
    <li>
      <button type="button" className={`mm-row${l.state === 'planned' ? ' is-planned' : ''}`} onClick={() => onSelect(node.id)}>
        <StateGlyph state={l.state} />
        <span className="mm-row__title">{node.title}</span>
        {value && <span className="mm-row__badge num">{value}</span>}
      </button>
    </li>
  )
}

export function EdgeRow({ edge, dir, onSelect }: { edge: MapEdge; dir: 'in' | 'out'; onSelect: (id: string) => void }) {
  const otherId = dir === 'in' ? edge.from : edge.to
  const other = getNode(otherId)
  if (!other) return null
  return (
    <li>
      <button type="button" className={`mm-row mm-row--edge mm-row--${edge.kind}`} onClick={() => onSelect(otherId)}
        title={`${EDGE_KIND_LABEL[edge.kind]}${edge.label ? `: ${edge.label}` : ''}`}>
        <span className="mm-row__arrow" aria-hidden="true">{dir === 'in' ? '←' : '→'}</span>
        <span className="mm-row__title">{blockTag(other.block)} {other.title}</span>
        <span className="mm-row__badge">{EDGE_KIND_LABEL[edge.kind]}{edge.label ? ` · ${edge.label}` : ''}</span>
      </button>
    </li>
  )
}
