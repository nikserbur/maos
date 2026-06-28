/**
 * Сцена-граф: презентационная модель схемы (узлы + связи), пригодная для
 * редактирования и иерархии (drill-down). Это вью-модель поверх доменного
 * `src/domain/graph.ts`; на следующих фазах она будет синхронизироваться с
 * C++-ядром через Action layer.
 */
import type { ObjectKind, StageKpi, StageStatus } from '../types'
import type { Machine, WorkCenterType, Flow } from '../../../lib/api'

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
// Масштабы увеличены (~×1.5) для более крупных и читаемых объектов схемы.
export const KIND_META: Record<ObjectKind, KindMeta> = {
  feedstock: { label: 'Двор сырья', scale: 1 / 4 },
  cleaningarea: { label: 'Обработка', scale: 1 / 4, rotationY: -Math.PI / 2 },
  dryer: { label: 'Большой цех', scale: 1 / 6.5, rotationY: Math.PI },
  boiler: { label: 'Энергоблок', scale: 1 / 6.5, rotationY: Math.PI },
  finecleaning: { label: 'Печь', scale: 1 / 7.5 },
  briquettes: { label: 'Агрегат A', scale: 1 / 4 },
  pileizer: { label: 'Агрегат B', scale: 1 / 4 },
  transformer: { label: 'Подстанция', scale: 1 / 4 },
  wirehouse: { label: 'Склад', scale: 1 / 4 },
  sale: { label: 'Отгрузка', scale: 1 / 4, rotationY: -Math.PI / 2 },
  marketing: { label: 'Корпус', scale: 1 / 4, rotationY: -Math.PI / 2 },
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

/** Пустой граф — схема всегда строится из БД (источник истины — НСИ). */
export const INITIAL_GRAPH: SceneGraph = { nodes: [], edges: [] }

/** Операционный статус машины (НСИ) → статус узла на схеме. */
function mapStatus(machineStatus: string): StageStatus {
  switch (machineStatus) {
    case 'maintenance':    return 'down'
    case 'decommissioned': return 'idle'
    default:               return 'running'
  }
}

/** Безопасный парс JSON-характеристик типа в массив KPI. */
function parseCharacteristics(raw: string): StageKpi[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x) => x && typeof x.label === 'string')
      .map((x) => ({ label: String(x.label), value: String(x.value ?? '') }))
  } catch {
    return []
  }
}

/**
 * Сборка сцены-графа из реестров НСИ. Узел сцены = единица оборудования;
 * 3D-вид, масштаб и характеристики наследуются от типа оборудования.
 */
export function buildGraphFromDb(
  machines: Machine[],
  wcTypes: WorkCenterType[],
  flows: Flow[],
): SceneGraph {
  const typeById = new Map(wcTypes.map((t) => [t.id, t]))

  const nodes: SceneNode[] = machines.map((m) => {
    const type = m.wc_type_id ? typeById.get(m.wc_type_id) : undefined
    const kind = (type && (PALETTE as string[]).includes(type.kind)
      ? type.kind
      : 'marketing') as ObjectKind
    const meta = KIND_META[kind]
    return {
      id: m.id,
      parentId: m.parent_machine_id || null,
      kind,
      title: m.name,
      subtitle: m.subtitle || type?.name || '',
      position: [Number(m.pos_x) || 0, Number(m.pos_z) || 0],
      rotationY: Number(m.rotation_y) || meta.rotationY || 0,
      scale: meta.scale,
      status: mapStatus(m.status),
      kpis: parseCharacteristics(type?.characteristics ?? ''),
      linkedMachineId: m.id,
    }
  })

  const edges: SceneEdge[] = flows.map((f) => ({
    id: f.id,
    parentId: f.parent_id || null,
    from: f.from_id,
    to: f.to_id,
  }))

  return { nodes, edges }
}

/** Есть ли у узла вложенная подсхема (для drill-down). */
export const hasChildren = (graph: SceneGraph, id: string): boolean =>
  graph.nodes.some((n) => n.parentId === id)
