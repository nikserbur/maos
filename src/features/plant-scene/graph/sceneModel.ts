/**
 * Сцена-граф: презентационная модель схемы (узлы + связи), пригодная для
 * редактирования и иерархии (drill-down). Это вью-модель поверх доменного
 * `src/domain/graph.ts`; на следующих фазах она будет синхронизироваться с
 * C++-ядром через Action layer.
 */
import type { ObjectKind, StageKpi, StageStatus } from '../types'
import type { Machine, WorkCenterType, Flow, OrgUnit } from '../../../lib/api'
import { inferMachineArch, type MachineArch } from '../objects/machines'

/**
 * Тип узла схемы:
 *  - 'factory'  — завод / склад на МИРОВОЙ КАРТЕ (макро-уровень, parentId=null);
 *  - 'shop'     — цех на площадке завода (parentId = узел-завод);
 *  - 'machine'  — станок внутри цеха (лист, parentId = узел-цех).
 */
export type NodeRef = 'shop' | 'machine' | 'factory'

export interface SceneNode {
  id: string
  /** Родительский узел (null = верхний уровень = площадка). */
  parentId: string | null
  refType: NodeRef
  kind: ObjectKind
  /** Архетип станка (для machine): узнаваемая процедурная модель вместо GLB-блока. */
  machineArch?: MachineArch
  title: string
  subtitle: string
  position: [number, number]
  rotationY?: number
  scale: number
  status: StageStatus
  kpis: StageKpi[]
  /** ID записи из реестра «Оборудование» (НСИ), с которой связан узел. */
  linkedMachineId?: string
  /** Для узла-цеха И узла-завода — id записи org_units. */
  orgUnitId?: string
}

/** Префикс id узла-цеха (чтобы не пересекался с id машины). */
export const SHOP_PREFIX = 'shop:'
export const shopNodeId = (orgUnitId: string): string => SHOP_PREFIX + orgUnitId

/** Префикс id узла-завода/склада (мировая карта). */
export const FACTORY_PREFIX = 'factory:'
export const factoryNodeId = (orgUnitId: string): string => FACTORY_PREFIX + orgUnitId
/** Виртуальный завод для legacy-БД (плоские цеха без заводов) — «одно предприятие». */
export const DEFAULT_FACTORY_ID = FACTORY_PREFIX + '__default__'

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

/** Является ли org_unit заводом/складом (живёт на мировой карте). */
const isFactoryUnit = (o: OrgUnit): boolean =>
  o.unit_type === 'factory' || o.unit_type === 'warehouse'

/**
 * Трёхуровневая иерархия:
 *   Мир (корень) → Заводы/Склад (org_units unit_type=factory|warehouse) →
 *   Цеха (org_units unit_type=shop, parent_id=завод) → Станки (machines).
 *
 * LEGACY: если заводов/складов НЕТ — синтезируем ОДИН виртуальный завод
 * (DEFAULT_FACTORY_ID) и вешаем на него все цеха, чтобы одно-заводская БД
 * показывала один завод на карте, а вход в него открывал сегодняшнюю площадку.
 *
 * Станок ВСЕГДА внутри цеха; привязка станок→цех — по org_unit_id (FK),
 * иначе по имени org_unit.
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

  // ── Разделение org_units на заводы/склады (мировая карта) и цеха (площадка) ──
  const factoryUnits = orgUnits.filter(isFactoryUnit)
  const shopUnits = orgUnits.filter((o) => !isFactoryUnit(o))
  const legacy = factoryUnits.length === 0   // плоская одно-заводская БД

  // Узел-завод по id org_unit-завода — для парентинга цехов и мировых дорог.
  const factoryNodeByOu = new Map<string, string>()   // factory org_unit.id → factory node id
  for (const f of factoryUnits) factoryNodeByOu.set(f.id, factoryNodeId(f.id))

  // Завод-родитель для цеха: по parent_id (chain), иначе (legacy или потеряшка) —
  // виртуальный завод по умолчанию.
  const factoryOfShop = (o: OrgUnit): string => {
    if (!legacy && o.parent_id && factoryNodeByOu.has(o.parent_id))
      return factoryNodeByOu.get(o.parent_id)!
    return DEFAULT_FACTORY_ID
  }

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

  // ── Узлы-цеха (уровень площадки завода) ──
  // Сетка позиций внутри площадки СВОЯ для каждого завода (индекс i в рамках завода).
  const shopIdxByFactory = new Map<string, number>()
  const shopCountByFactory = new Map<string, number>()
  for (const o of shopUnits) {
    const fid = factoryOfShop(o)
    shopCountByFactory.set(fid, (shopCountByFactory.get(fid) ?? 0) + 1)
  }
  const shopNodes: SceneNode[] = shopUnits.map((o) => {
    const id = shopNodeId(o.id)
    shopByOu.set(o.id, id)
    shopByName.set(o.name, id)
    const factoryParent = factoryOfShop(o)
    const total = shopCountByFactory.get(factoryParent) ?? 1
    const i = shopIdxByFactory.get(factoryParent) ?? 0
    shopIdxByFactory.set(factoryParent, i + 1)
    const cols = Math.max(1, Math.ceil(Math.sqrt(total)))
    const SP = 34
    const gx = (i % cols) * SP - ((cols - 1) * SP) / 2
    const gz = Math.floor(i / cols) * SP - ((Math.ceil(total / cols) - 1) * SP) / 2
    // Сохранённая позиция цеха (org_units.pos_x/pos_z) имеет приоритет над авто-сеткой.
    const hasPos = o.pos_x != null && String(o.pos_x) !== '' && !Number.isNaN(Number(o.pos_x))
    const cx = hasPos ? Number(o.pos_x) : gx
    const cz = hasPos ? Number(o.pos_z) : gz
    // Вид: явный выбор пользователя (org_units.kind из редактора) → приоритет;
    // иначе — по роли из названия. Поворот — детерминированно по имени.
    const h = [...o.name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
    const kind = (o.kind && (PALETTE as string[]).includes(o.kind))
      ? (o.kind as ObjectKind)
      : roleKind(o.name)
    const meta = KIND_META[kind]
    return {
      id, parentId: factoryParent, refType: 'shop', kind,
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
      machineArch: inferMachineArch(type?.name || m.name),
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
  // Он живёт под виртуальным заводом по умолчанию (гарантируем его существование ниже).
  const hasOrphans = machineNodes.some((n) => n.parentId === SYNTHETIC_SHOP)
  if (hasOrphans) {
    const defTotal = (shopCountByFactory.get(DEFAULT_FACTORY_ID) ?? 0)
    const defCols = Math.max(1, Math.ceil(Math.sqrt(defTotal || 1)))
    shopNodes.push({
      id: SYNTHETIC_SHOP, parentId: DEFAULT_FACTORY_ID, refType: 'shop', kind: 'marketing',
      title: 'Без цеха', subtitle: 'Станки без подразделения — назначьте цех',
      position: [0, (Math.ceil((defTotal || 1) / defCols)) * 34], rotationY: 0,
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

  // ── Узлы-заводы/склад (мировая карта) ──
  // Позиция — MAP-координаты (org_units.pos_x/pos_z), иначе разложенная сетка.
  const FSP = 60   // шаг мировой сетки (заводы крупнее цехов — простор больше)
  const fCols = Math.max(1, Math.ceil(Math.sqrt(factoryUnits.length || 1)))
  const factoryNodes: SceneNode[] = factoryUnits.map((o, i) => {
    const gx = (i % fCols) * FSP - ((fCols - 1) * FSP) / 2
    const gz = Math.floor(i / fCols) * FSP - ((Math.ceil((factoryUnits.length || 1) / fCols) - 1) * FSP) / 2
    const hasPos = o.pos_x != null && String(o.pos_x) !== '' && !Number.isNaN(Number(o.pos_x))
    const cx = hasPos ? Number(o.pos_x) : gx
    const cz = hasPos ? Number(o.pos_z) : gz
    const warehouse = o.unit_type === 'warehouse'
    return {
      id: factoryNodeId(o.id), parentId: null, refType: 'factory',
      kind: warehouse ? 'wirehouse' : 'marketing',
      title: o.name, subtitle: warehouse ? 'Склад / логистика' : 'Завод / производственная площадка',
      position: [cx, cz], rotationY: 0, scale: 1, status: 'running', kpis: [], orgUnitId: o.id,
    }
  })
  // Виртуальный завод (legacy или для «Без цеха») — если на него кто-то ссылается.
  const needsDefault = shopNodes.some((n) => n.parentId === DEFAULT_FACTORY_ID)
  if (needsDefault) {
    factoryNodes.push({
      id: DEFAULT_FACTORY_ID, parentId: null, refType: 'factory', kind: 'marketing',
      title: 'Предприятие', subtitle: 'Производственная площадка',
      position: [0, 0], rotationY: 0, scale: 1, status: 'running', kpis: [],
      // orgUnitId НЕ задаём — виртуальный завод не персистится в НСИ.
    })
  }

  // Мировой узел-эндпоинт для `shop:<factory_org_unit_id>` (контрактная нотация дорог).
  const factoryNodeIds = new Set(factoryNodes.map((n) => n.id))

  // ── Дороги/потоки, согласованные с ТРЁХУРОВНЕВОЙ иерархией ──
  //  • машина↔машина в одном цехе       → ребро ВНУТРИ цеха     (parentId = shop);
  //  • машина↔машина в разных цехах      → межцеховая дорога     (parentId = factory);
  //  • shop:<factory_ou>↔shop:<factory_ou> (parent_id='') → МИРОВАЯ дорога (parentId = null).
  const machineShop = new Map<string, string>()   // machine id → shop node id
  for (const m of machines) machineShop.set(m.id, shopOf(m))
  const shopIds = new Set(shopNodes.map((n) => n.id))
  const shopToFactory = new Map<string, string>() // shop node id → factory node id
  for (const n of shopNodes) shopToFactory.set(n.id, n.parentId!)

  // Эндпоинт `shop:<ou>` может указывать на ЦЕХ (площадка) ИЛИ на ЗАВОД (мир):
  //  - если это узел-цех → возвращаем shop node id;
  //  - если org_unit — завод/склад → возвращаем factory node id (мировая дорога).
  const resolveEndpoint = (id: string): { world: false; shop: string } | { world: true; factory: string } | undefined => {
    if (id.startsWith(SHOP_PREFIX)) {
      if (shopIds.has(id)) return { world: false, shop: id }
      const ouId = id.slice(SHOP_PREFIX.length)
      const fnode = factoryNodeByOu.get(ouId)
      if (fnode && factoryNodeIds.has(fnode)) return { world: true, factory: fnode }
      return undefined
    }
    const s = machineShop.get(id)
    return s ? { world: false, shop: s } : undefined
  }

  const edges: SceneEdge[] = []
  const seenInterShop = new Set<string>()
  const seenWorld = new Set<string>()
  for (const f of flows) {
    const ea = resolveEndpoint(f.from_id), eb = resolveEndpoint(f.to_id)
    if (!ea || !eb) continue
    if (ea.world && eb.world) {
      // Мировая дорога между заводами/складом (дедуп по паре).
      if (ea.factory === eb.factory) continue
      const key = ea.factory < eb.factory ? `${ea.factory}|${eb.factory}` : `${eb.factory}|${ea.factory}`
      if (seenWorld.has(key)) continue
      seenWorld.add(key)
      edges.push({ id: `world-${f.id}`, parentId: null, from: ea.factory, to: eb.factory })
      continue
    }
    if (ea.world || eb.world) continue   // смешанные (завод↔станок) — не поддерживаем
    const sa = ea.shop, sb = eb.shop
    const shopEnds = f.from_id.startsWith(SHOP_PREFIX) || f.to_id.startsWith(SHOP_PREFIX)
    if (!shopEnds && sa === sb) {
      edges.push({ id: f.id, parentId: sa, from: f.from_id, to: f.to_id })   // внутри цеха
    } else if (sa !== sb) {
      // Межцеховая дорога — на уровне ПЛОЩАДКИ (родитель = общий завод обоих цехов).
      const fa = shopToFactory.get(sa), fb = shopToFactory.get(sb)
      const site = fa && fa === fb ? fa : null
      const key = (sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`)
      if (seenInterShop.has(key)) continue
      seenInterShop.add(key)
      edges.push({ id: `inter-${f.id}`, parentId: site, from: sa, to: sb })
    }
  }

  return { nodes: [...factoryNodes, ...shopNodes, ...machineNodes], edges }
}

/** Есть ли у узла вложенная подсхема (для drill-down). */
export const hasChildren = (graph: SceneGraph, id: string): boolean =>
  graph.nodes.some((n) => n.parentId === id)
