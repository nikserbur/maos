/**
 * Допустимые идентификаторы схем и якоря «Методики» во время выполнения
 * (DiagramId — только тип, поэтому список задаётся здесь). Record по объединению
 * типов заставляет tsc сообщить, если в src/diagrams появится или исчезнет id.
 */
import type { DiagramId } from '../diagrams'
import { METHODOLOGY_SECTIONS, type MethodologyAnchor } from './types'

const DIAGRAM_ID_SET: Record<DiagramId, true> = {
  'two-stages': true,
  'cvar-tail': true,
  'price-of-robustness': true,
  pareto: true,
  'correlation-diversification': true,
  'heavy-tail': true,
  'lot-streaming': true,
  'dispatch-rules': true,
  toc: true,
  'little-law': true,
  idef0: true,
  'forecast-decomposition': true,
  mrp: true,
  npv: true,
  'agent-layers': true,
}

export const DIAGRAM_IDS: readonly DiagramId[] = Object.keys(DIAGRAM_ID_SET) as DiagramId[]

export const METHODOLOGY_ANCHORS: readonly MethodologyAnchor[] = [...DIAGRAM_IDS, ...METHODOLOGY_SECTIONS]

export function isDiagramId(s: string): s is DiagramId {
  return Object.prototype.hasOwnProperty.call(DIAGRAM_ID_SET, s)
}

export function isMethodologyAnchor(s: string): s is MethodologyAnchor {
  return (METHODOLOGY_ANCHORS as readonly string[]).includes(s)
}

/** Ссылка на раздел экрана «Методика». */
export function methodologyHref(anchor: MethodologyAnchor): string {
  return `#/methodology/${anchor}`
}
