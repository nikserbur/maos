/**
 * Граф схемы предприятия — иерархическая, редактируемая модель визуализации
 * (ТЗ «Модель данных и хранение», §граф; REQUIREMENTS.md §1).
 * Поддерживает drill-down (parentId/level) и типизированные связи-потоки.
 */
import type { Id } from './nsi'

/** Класс узла → 3D-модель и поведение. */
export interface NodeClass {
  id: Id
  name: string
  /** Идентификатор 3D-модели (ассет). */
  modelId: string
}

export type GraphNodeRef = 'product' | 'operation' | 'machine' | 'orgUnit'

export interface GraphNode {
  id: Id
  graphId: Id
  /** Иерархия: родительский узел (null = верхний уровень). Drill-down. */
  parentId: Id | null
  level: number
  classId: Id
  title: string
  /** Положение на полу [x, z]. */
  position: [number, number]
  rotationY?: number
  /** Привязка к доменной сущности (опц.). */
  refType?: GraphNodeRef
  refId?: Id
}

/** Тип потока на связи (материал/энергия/газ/информация). */
export type ConnectorKind = 'material' | 'energy' | 'gas' | 'info'

export interface GraphEdge {
  id: Id
  graphId: Id
  from: Id
  to: Id
  kind: ConnectorKind
  /** Уровень запаса на конце связи (атрибут потока). */
  stockAtEnd?: number
}

export interface SchemeGraph {
  id: Id
  name: string
  rootLevel: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}
