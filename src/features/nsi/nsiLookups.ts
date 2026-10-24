/**
 * Связи реестров НСИ для таблиц (X2 «запись показывает, для чего она и где влияет на план»):
 * сколько станков и допущенных операторов у типа, сколько операций действующих техкарт его используют,
 * сводка техкарты (операций, Σ нормы, самая длинная операция), допуски рабочего. Чистые функции — vitest.
 */
import type { Machine, Operation, Product, Routing, Worker, WorkCenterType } from '../../lib/api'
import { isEligible } from './labor'
import { isDefaultRouting } from './registries'
import { typesFromNames } from './routing/routingModel'

export interface NsiData {
  wcTypes: ReadonlyArray<WorkCenterType>
  machines: ReadonlyArray<Machine>
  workers: ReadonlyArray<Worker>
  products: ReadonlyArray<Product>
  operations: ReadonlyArray<Operation>
  routings: ReadonlyArray<Routing>
}

export interface RoutingStats { ops: number; totalMin: number; longest: { name: string; min: number } | null }

export interface NsiLookups {
  typeById: ReadonlyMap<string, WorkCenterType>
  productById: ReadonlyMap<string, Product>
  routingById: ReadonlyMap<string, Routing>
  machinesByType: ReadonlyMap<string, number>
  operatorsByType: ReadonlyMap<string, number>
  /** Операций действующих техкарт, допускающих тип. */
  opsByType: ReadonlyMap<string, number>
  routingStats: ReadonlyMap<string, RoutingStats>
  /** Вариантов техкарт у изделия (действующая + альтернативы). */
  variantsByProduct: ReadonlyMap<string, number>
  /** Типы, допустимые для операции (связи по ID; иначе — по именам). */
  typesOfOp: (op: Operation) => WorkCenterType[]
}

const count = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
const minutes = (op: Operation) => {
  const n = Number(op.t_norm)
  return Number.isFinite(n) ? n : 0
}

export function buildLookups(d: NsiData): NsiLookups {
  const typeById = new Map(d.wcTypes.map((t) => [t.id, t]))
  const typesOfOp = (op: Operation): WorkCenterType[] =>
    op.wc_type_ids?.length
      ? op.wc_type_ids.map((id) => typeById.get(id)).filter((t): t is WorkCenterType => Boolean(t))
      : typesFromNames(op.wc_types, d.wcTypes)

  const machinesByType = new Map<string, number>()
  for (const m of d.machines) if (m.wc_type_id) count(machinesByType, m.wc_type_id)

  const operatorsByType = new Map<string, number>()
  for (const t of d.wcTypes) operatorsByType.set(t.id, d.workers.filter((w) => isEligible(w.skills, t.name, t.id)).length)

  const active = new Set(d.routings.filter(isDefaultRouting).map((r) => r.id))
  const opsByType = new Map<string, number>()
  const routingStats = new Map<string, RoutingStats>()
  for (const op of d.operations) {
    if (op.routing_id && active.has(op.routing_id)) for (const t of typesOfOp(op)) count(opsByType, t.id)
    if (!op.routing_id) continue
    const st = routingStats.get(op.routing_id) ?? { ops: 0, totalMin: 0, longest: null }
    const min = minutes(op)
    routingStats.set(op.routing_id, {
      ops: st.ops + 1,
      totalMin: st.totalMin + min,
      longest: !st.longest || min > st.longest.min ? { name: op.name, min } : st.longest,
    })
  }

  const variantsByProduct = new Map<string, number>()
  for (const r of d.routings) if (r.product_id) count(variantsByProduct, r.product_id)

  return {
    typeById,
    productById: new Map(d.products.map((p) => [p.id, p])),
    routingById: new Map(d.routings.map((r) => [r.id, r])),
    machinesByType, operatorsByType, opsByType, routingStats, variantsByProduct, typesOfOp,
  }
}

/** Типы, к которым допущен рабочий; пустые навыки — универсал (null). */
export function workerTypes(w: Pick<Worker, 'skills'>, wcTypes: ReadonlyArray<WorkCenterType>): WorkCenterType[] | null {
  if (!(w.skills ?? '').trim()) return null
  return wcTypes.filter((t) => isEligible(w.skills, t.name, t.id))
}

/** Запись рабочего неполна (тестовая/мусорная): нет подразделения или имя без букв. */
export function workerIncomplete(w: Pick<Worker, 'org_unit' | 'org_unit_id' | 'last_name' | 'first_name'>): string | null {
  const letters = /\p{L}/u
  if (!letters.test(w.last_name ?? '') || !letters.test(w.first_name ?? '')) return 'имя без букв'
  if (!(w.org_unit_id ?? '').trim() && !(w.org_unit ?? '').trim()) return 'нет подразделения'
  return null
}

/** Табельный номер для естественной сортировки: «T0012» → «T0000000012». */
export function tabSortKey(tab: string | null | undefined): string {
  return (tab ?? '').replace(/\d+/g, (d) => d.padStart(10, '0'))
}
