/**
 * Сцена-граф: презентационная модель схемы (узлы + связи), пригодная для
 * редактирования и иерархии (drill-down). Это вью-модель поверх доменного
 * `src/domain/graph.ts`; на следующих фазах она будет синхронизироваться с
 * C++-ядром через Action layer.
 */
import type { ObjectKind, StageKpi, StageStatus } from '../types'
import type { Machine, WorkCenterType, Flow, OrgUnit } from '../../../lib/api'

/** Тип узла схемы: цех-контейнер (уровень площадки) или станок (внутри цеха). */
export type NodeRef = 'shop' | 'machine'

export interface SceneNode {
  id: string
  /** Родительский узел (null = верхний уровень = площадка). */
  parentId: string | null
  refType: NodeRef
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
  /** Для узла-цеха — id записи org_units. */
  orgUnitId?: string
}

/** Префикс id узла-цеха (чтобы не пересекался с id машины). */
export const SHOP_PREFIX = 'shop:'
export const shopNodeId = (orgUnitId: string): string => SHOP_PREFIX + orgUnitId

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
const SYNTHETIC_SHOP = SHOP_PREFIX + '__none__'   // «Без цеха» — для станков без подразделения

/**
 * Двухуровневая иерархия: Площадка (корень) → Цеха (org_units) → Станки (machines).
 * Станок ВСЕГДА внутри цеха; цех НЕ может быть внутри цеха (parentId цеха всегда null).
 * Привязка станок→цех — по org_unit_id (FK), иначе по имени org_unit.
 */
export function buildGraphFromDb(
  machines: Machine[],
  wcTypes: WorkCenterType[],
  flows: Flow[],
  orgUnits: OrgUnit[],
): SceneGraph {
  const typeById = new Map(wcTypes.map((t) => [t.id, t]))
  const shopByOu = new Map<string, string>()   // org_unit.id → shop node id
  const shopByName = new Map<string, string>()  // org_unit.name → shop node id

  // Силуэт цеха — по РОЛИ (по названию), а не случайно: иначе сборочный цех
  // выглядел домной. Спец-виды (домна / энергоблок с градирней) появляются ТОЛЬКО
  // там, где осмысленны; прочие цеха — чистые промышленные корпуса (без «леденцов»).
  const roleKind = (name: string): ObjectKind => {
    const n = name.toLowerCase()
    if (/склад|снабж|сырь|мтр|отгруз|сбыт/.test(n))            return 'wirehouse'   // Warehouse — ангар
    if (/литейн|плавильн|домн|металлург/.test(n))               return 'dryer'       // BlastFurnace
    if (/термическ|энерг|котельн|обжиг|печн|гальван/.test(n))   return 'boiler'      // PowerPlant
    if (/сварочн|кузнечн|штампов/.test(n))                      return 'briquettes'  // SteelShop — высокий пролёт
    if (/прокат|конвейер/.test(n))                              return 'pileizer'    // RollingMill — длинный пролёт
    // прочее (механообработка, сборка, шлифовка, окраска, ОТК…) — разные чистые
    // корпуса по хешу для разнообразия (домны/энергоблока среди них НЕТ).
    const HALLS: ObjectKind[] = ['pileizer', 'briquettes', 'marketing', 'wirehouse']
    const hh = [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
    return HALLS[hh % HALLS.length]
  }
  const SHOP_SUB: Record<string, string> = {
    dryer: 'Литейный / металлург. цех', boiler: 'Термический / энергоцех',
    briquettes: 'Заготовительно-сварочный', pileizer: 'Механосборочный цех',
    wirehouse: 'Складской комплекс', marketing: 'Производственный корпус',
    cleaningarea: 'Обрабатывающий цех',
  }

  // ── Узлы-цеха (уровень площадки) ──
  const cols = Math.max(1, Math.ceil(Math.sqrt(orgUnits.length || 1)))
  const SP = 34
  const shopNodes: SceneNode[] = orgUnits.map((o, i) => {
    const id = shopNodeId(o.id)
    shopByOu.set(o.id, id)
    shopByName.set(o.name, id)
    const cx = (i % cols) * SP - ((cols - 1) * SP) / 2
    const cz = Math.floor(i / cols) * SP - ((Math.ceil((orgUnits.length || 1) / cols) - 1) * SP) / 2
    // Вид: явный выбор пользователя (org_units.kind из редактора) → приоритет;
    // иначе — по роли из названия. Поворот — детерминированно по имени.
    const h = [...o.name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
    const kind = (o.kind && (PALETTE as string[]).includes(o.kind))
      ? (o.kind as ObjectKind)
      : roleKind(o.name)
    const meta = KIND_META[kind]
    return {
      id, parentId: null, refType: 'shop', kind,
      title: o.name, subtitle: SHOP_SUB[kind] ?? 'Цех / подразделение',
      position: [cx, cz], rotationY: (meta.rotationY ?? 0) + (h % 4) * (Math.PI / 2),
      scale: meta.scale * 1.15, status: 'running', kpis: [], orgUnitId: o.id,
    }
  })

  // ── Узлы-станки (внутри цеха), сгруппированы по org_unit ──
  const shopOf = (m: Machine): string => {
    if (m.org_unit_id && shopByOu.has(m.org_unit_id)) return shopByOu.get(m.org_unit_id)!
    if (m.org_unit && shopByName.has(m.org_unit)) return shopByName.get(m.org_unit)!
    return SYNTHETIC_SHOP
  }
  const machineNodes: SceneNode[] = machines.map((m) => {
    const type = m.wc_type_id ? typeById.get(m.wc_type_id) : undefined
    const kind = (type && (PALETTE as string[]).includes(type.kind)
      ? type.kind : 'marketing') as ObjectKind
    const meta = KIND_META[kind]
    return {
      id: m.id, parentId: shopOf(m), refType: 'machine', kind,
      title: m.name,
      subtitle: type?.name ? `Тип: ${type.name}` : (m.subtitle || ''),
      position: [Number(m.pos_x) || 0, Number(m.pos_z) || 0],
      rotationY: Number(m.rotation_y) || meta.rotationY || 0,
      scale: meta.scale, status: mapStatus(m.status),
      kpis: parseCharacteristics(type?.characteristics ?? ''),
      linkedMachineId: m.id,
    }
  })

  // Синтетический цех «Без цеха» — только если есть станки-сироты (не оставляем на улице).
  const hasOrphans = machineNodes.some((n) => n.parentId === SYNTHETIC_SHOP)
  if (hasOrphans) {
    shopNodes.push({
      id: SYNTHETIC_SHOP, parentId: null, refType: 'shop', kind: 'marketing',
      title: 'Без цеха', subtitle: 'Станки без подразделения — назначьте цех',
      position: [0, (Math.ceil((orgUnits.length || 1) / cols)) * SP], rotationY: 0,
      scale: KIND_META.marketing.scale, status: 'idle', kpis: [],
    })
  }

  // Центрируем станки каждого цеха вокруг локального нуля (drill-down смотрит в центр).
  const byShop = new Map<string, SceneNode[]>()
  for (const n of machineNodes) {
    if (!byShop.has(n.parentId!)) byShop.set(n.parentId!, [])
    byShop.get(n.parentId!)!.push(n)
  }
  byShop.forEach((arr) => {
    const cx = arr.reduce((s, n) => s + n.position[0], 0) / arr.length
    const cz = arr.reduce((s, n) => s + n.position[1], 0) / arr.length
    arr.forEach((n) => { n.position = [n.position[0] - cx, n.position[1] - cz] })
  })

  // ── Дороги/потоки, согласованные с иерархией ──
  // Поток машина A→B: если A и B в одном цехе — ребро ВНУТРИ цеха (дорога в цехе);
  // если в разных — межцеховая дорога на уровне площадки (цех→цех, дедуп).
  // Дороги, нарисованные МЕЖДУ ЦЕХАМИ на площадке, хранятся с id узла-цеха
  // (`shop:<org_unit_id>`) — раньше они отбрасывались при загрузке и «пропадали».
  const machineShop = new Map<string, string>()
  for (const m of machines) machineShop.set(m.id, shopOf(m))
  const shopIds = new Set(shopNodes.map((n) => n.id))
  const endpointShop = (id: string): string | undefined =>
    id.startsWith(SHOP_PREFIX) ? (shopIds.has(id) ? id : undefined) : machineShop.get(id)
  const edges: SceneEdge[] = []
  const seenInter = new Set<string>()
  for (const f of flows) {
    const shopEnds = f.from_id.startsWith(SHOP_PREFIX) || f.to_id.startsWith(SHOP_PREFIX)
    const sa = endpointShop(f.from_id), sb = endpointShop(f.to_id)
    if (!sa || !sb) continue
    if (!shopEnds && sa === sb) {
      edges.push({ id: f.id, parentId: sa, from: f.from_id, to: f.to_id })  // внутри цеха
    } else if (sa !== sb) {
      const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`
      if (seenInter.has(key)) continue
      seenInter.add(key)
      edges.push({ id: `inter-${f.id}`, parentId: null, from: sa, to: sb })  // межцеховая дорога
    }
  }

  return { nodes: [...shopNodes, ...machineNodes], edges }
}

/** Есть ли у узла вложенная подсхема (для drill-down). */
export const hasChildren = (graph: SceneGraph, id: string): boolean =>
  graph.nodes.some((n) => n.parentId === id)
