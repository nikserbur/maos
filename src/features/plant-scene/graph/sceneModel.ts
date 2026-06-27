/**
 * Сцена-граф: презентационная модель схемы (узлы + связи), пригодная для
 * редактирования и иерархии (drill-down). Это вью-модель поверх доменного
 * `src/domain/graph.ts`; на следующих фазах она будет синхронизироваться с
 * C++-ядром через Action layer.
 */
import type { ObjectKind, StageKpi, StageStatus } from '../types'
import { FLOWS, STAGES } from '../layout'

export interface SceneNode {
  id: string
  /** Родительский узел (null = верхний уровень). */
  parentId: string | null
  kind: ObjectKind
  title: string
  subtitle: string
  position: [number, number]
  rotationY?: number
  scale: number
  status: StageStatus
  kpis: StageKpi[]
  /** ID записи из реестра «Оборудование» (НСИ), с которой связан узел. */
  linkedMachineId?: string
}

/** Физическая связь между узлами (конвейер, трубопровод, кабель). */
export interface SceneEdge {
  id: string
  parentId: string | null
  from: string
  to: string
}

export interface SceneGraph {
  nodes: SceneNode[]
  edges: SceneEdge[]
}

export interface KindMeta {
  label: string
  scale: number
  rotationY?: number
}

/** Палитра типов узлов (каждый тип = 3D-модель). */
export const KIND_META: Record<ObjectKind, KindMeta> = {
  feedstock: { label: 'Двор сырья', scale: 1 / 6 },
  cleaningarea: { label: 'Обработка', scale: 1 / 6, rotationY: -Math.PI / 2 },
  dryer: { label: 'Большой цех', scale: 1 / 10, rotationY: Math.PI },
  boiler: { label: 'Энергоблок', scale: 1 / 10, rotationY: Math.PI },
  finecleaning: { label: 'Печь', scale: 1 / 11 },
  briquettes: { label: 'Агрегат A', scale: 1 / 6 },
  pileizer: { label: 'Агрегат B', scale: 1 / 6 },
  transformer: { label: 'Подстанция', scale: 1 / 6 },
  wirehouse: { label: 'Склад', scale: 1 / 6 },
  sale: { label: 'Отгрузка', scale: 1 / 6, rotationY: -Math.PI / 2 },
  marketing: { label: 'Корпус', scale: 1 / 6, rotationY: -Math.PI / 2 },
}

export const PALETTE: ObjectKind[] = [
  'feedstock',
  'cleaningarea',
  'dryer',
  'boiler',
  'finecleaning',
  'briquettes',
  'pileizer',
  'transformer',
  'wirehouse',
  'sale',
  'marketing',
]

const topNodes: SceneNode[] = STAGES.map((s) => ({
  id: s.id,
  parentId: null,
  kind: s.kind,
  title: s.title,
  subtitle: s.subtitle,
  position: s.position,
  rotationY: s.rotationY,
  scale: s.scale,
  status: s.status,
  kpis: s.kpis,
}))

const topEdges: SceneEdge[] = FLOWS.map((f, i) => ({
  id: `top-${i}`,
  parentId: null,
  from: f.from,
  to: f.to,
}))

// Демо-иерархия: внутренняя подсхема узла «converter» (drill-down).
const converterChildren: SceneNode[] = [
  {
    id: 'conv-charge',
    parentId: 'converter',
    kind: 'feedstock',
    title: 'Завалка',
    subtitle: 'Лом и чугун',
    position: [-8, 0],
    scale: 1 / 6,
    status: 'running',
    kpis: [{ label: 'Завалка', value: '120 т/пл' }],
  },
  {
    id: 'conv-vessel',
    parentId: 'converter',
    kind: 'finecleaning',
    title: 'Конвертер',
    subtitle: 'Кислородная продувка',
    position: [0, 0],
    scale: 1 / 11,
    status: 'setup',
    kpis: [{ label: 'Продувка', value: '18 мин' }],
  },
  {
    id: 'conv-cast',
    parentId: 'converter',
    kind: 'pileizer',
    title: 'Разливка',
    subtitle: 'Ковш / МНЛЗ',
    position: [8, 0],
    scale: 1 / 6,
    status: 'running',
    kpis: [{ label: 'Серия', value: '6 плавок' }],
  },
]

const converterEdges: SceneEdge[] = [
  { id: 'conv-e0', parentId: 'converter', from: 'conv-charge', to: 'conv-vessel' },
  { id: 'conv-e1', parentId: 'converter', from: 'conv-vessel', to: 'conv-cast' },
]

export const INITIAL_GRAPH: SceneGraph = {
  nodes: [...topNodes, ...converterChildren],
  edges: [...topEdges, ...converterEdges],
}

/** Есть ли у узла вложенная подсхема (для drill-down). */
export const hasChildren = (graph: SceneGraph, id: string): boolean =>
  graph.nodes.some((n) => n.parentId === id)
