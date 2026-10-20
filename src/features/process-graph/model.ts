/**
 * Нормализация справочников в модель процесса — построчное зеркало
 * `load_model()` из backend/src/Scheduler.cpp (чистая функция, без React).
 *
 *  • техкарта участвует, если у неё есть изделие и она действующая (COALESCE(is_default,1)=1);
 *  • операции изделия — все операции его действующих техкарт по (order_no, id);
 *  • типы РЦ операции — operation_wc_types по rowid, первый = ведущий;
 *  • входы — operation_inputs (изделие × норма расхода на единицу);
 *  • PERT: t_exp = (t_opt + 4·t_norm + t_pess)/6, σ = (t_pess − t_opt)/6, иначе 15 % t_exp;
 *    норма пары time_norms для ведущего типа перекрывает плоские нормы;
 *  • станки — только status='active' с типом.
 * Если сервер не отдаёт таблицы связей, они восстанавливаются из текстовых полей
 * operations.wc_types / operations.inputs так же, как это делает link_operation() в main.cpp.
 */
import type {
  Cell,
  LinkSource,
  ModelInput,
  ModelOp,
  ModelProduct,
  ModelWcType,
  OperationRow,
  ProcessData,
  ProcessModel,
  ProductRow,
} from './types'

/** Слотов категориальной палитры (--chart-1..7); --chart-8 (серый) — «без типа». */
export const CATEGORY_SLOTS = 7

export function toNum(v: Cell, def = 0): number {
  if (v === null || v === undefined || v === '') return def
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : def
}

export function toBool(v: Cell): boolean {
  return toNum(v, 0) !== 0
}

const str = (v: Cell): string => (v === null || v === undefined ? '' : String(v))

/** Действующая техкарта: is_default пуст/NULL трактуется как 1 (COALESCE(is_default,1)). */
function isDefaultRouting(v: Cell): boolean {
  return v === null || v === undefined || v === '' ? true : toNum(v, 1) === 1
}

/** PERT движка: возвращает t_exp, σ и признак отката σ = 15 %. */
export function pert(tOptRaw: number, tNormRaw: number, tPessRaw: number): { tExp: number; sigma: number; fallback: boolean } {
  const tOpt = tOptRaw > 0 ? tOptRaw : tNormRaw
  const tPess = tPessRaw > 0 ? tPessRaw : tNormRaw
  let tExp = (tOpt + 4 * tNormRaw + tPess) / 6
  if (tExp <= 0) tExp = tNormRaw > 0 ? tNormRaw : 30
  const s = (tPess - tOpt) / 6
  return s > 0 ? { tExp, sigma: s, fallback: false } : { tExp, sigma: tExp * 0.15, fallback: true }
}

function buildProducts(rows: ProductRow[]): Map<string, ModelProduct> {
  const out = new Map<string, ModelProduct>()
  for (const p of rows) {
    if (!p.id) continue
    const cap = p.market_capacity
    out.set(p.id, {
      id: p.id,
      code: str(p.code),
      name: str(p.name) || p.id,
      unit: str(p.unit) || 'шт',
      purchased: toBool(p.purchased),
      sellable: toBool(p.sellable),
      batchSize: Math.max(1, toNum(p.batch_size, 1)),
      stock: toNum(p.stock),
      leadHours: toNum(p.lead_time_hours),
      basePrice: toNum(p.base_price),
      baseCost: toNum(p.base_cost),
      demandMax: toNum(p.demand_max),
      marketCapacity: cap === null || cap === undefined || cap === '' ? null : toNum(cap),
      routings: [],
      opIds: [],
    })
  }
  return out
}

function buildWcTypes(data: ProcessData): Map<string, ModelWcType> {
  const sorted = [...data.wcTypes].filter((t) => t.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const out = new Map<string, ModelWcType>()
  sorted.forEach((t, i) => {
    out.set(t.id, {
      id: t.id,
      name: str(t.name) || t.id,
      group: str(t.group_name),
      hourRate: toNum(t.hour_rate),
      colorIndex: i % CATEGORY_SLOTS,
      machineIds: [],
      mtbfHours: toNum(t.mtbf_hours),
      repairHours: toNum(t.repair_hours),
    })
  })
  for (const m of data.machines) {
    if (m.status !== 'active' || !m.wc_type_id) continue
    out.get(m.wc_type_id)?.machineIds.push(m.id)
  }
  return out
}

/** Текстовый фолбэк типов: полное имя → иначе токены CSV → иначе id (как link_operation). */
function wcTypesFromText(raw: string, byName: Map<string, string>, wcTypes: Map<string, ModelWcType>): string[] {
  const text = raw.trim()
  if (!text) return []
  const whole = byName.get(text)
  if (whole) return [whole]
  const out: string[] = []
  for (const tok of text.split(',')) {
    const t = tok.trim()
    const id = byName.get(t) ?? (wcTypes.has(t) ? t : undefined)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

interface TextInputs {
  inputs: ModelInput[]
  unresolved: number
}

/** Текстовый фолбэк входов: JSON [{productId|product_id, qty}] или CSV имён/кодов изделий. */
export function inputsFromText(raw: string, products: ReadonlyMap<string, ModelProduct>): TextInputs {
  const text = raw.trim()
  if (!text || text === '[]') return { inputs: [], unresolved: 0 }
  const agg = new Map<string, number>()
  let unresolved = 0
  const add = (pid: string, qty: number) => agg.set(pid, (agg.get(pid) ?? 0) + qty)
  if (text.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(text)
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (!it || typeof it !== 'object') continue
          const rec = it as Record<string, unknown>
          const pid = String(rec.productId ?? rec.product_id ?? '')
          if (!pid) continue
          if (!products.has(pid)) { unresolved += 1; continue }
          add(pid, toNum(rec.qty as Cell, 1))
        }
        return { inputs: [...agg].map(([productId, qty]) => ({ productId, qty })), unresolved }
      }
    } catch {
      /* не JSON — разбираем как CSV ниже */
    }
  }
  const byKey = new Map<string, string>()
  for (const p of products.values()) {
    byKey.set(p.name.toLowerCase(), p.id)
    if (p.code) byKey.set(p.code.toLowerCase(), p.id)
    byKey.set(p.id.toLowerCase(), p.id)
  }
  for (const tok of text.split(',')) {
    const t = tok.trim().toLowerCase()
    if (!t) continue
    const pid = byKey.get(t)
    if (pid) add(pid, 1)
    else unresolved += 1
  }
  return { inputs: [...agg].map(([productId, qty]) => ({ productId, qty })), unresolved }
}

function compareOps(a: OperationRow, b: OperationRow): number {
  const d = toNum(a.order_no, 10) - toNum(b.order_no, 10)
  if (d !== 0) return d
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Число обратных рёбер в графе «изделие → вход» (циклы BOM). */
function countBomCycles(products: ReadonlyMap<string, ModelProduct>, ops: ReadonlyMap<string, ModelOp>): number {
  const childOf = new Map<string, string[]>()
  for (const p of products.values()) {
    const kids = new Set<string>()
    for (const oid of p.opIds) for (const inp of ops.get(oid)?.inputs ?? []) kids.add(inp.productId)
    childOf.set(p.id, [...kids])
  }
  const state = new Map<string, 1 | 2>()
  let back = 0
  for (const root of products.keys()) {
    if (state.has(root)) continue
    const stack: Array<{ id: string; i: number }> = [{ id: root, i: 0 }]
    state.set(root, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const kids = childOf.get(top.id) ?? []
      if (top.i >= kids.length) {
        state.set(top.id, 2)
        stack.pop()
        continue
      }
      const k = kids[top.i++]
      const s = state.get(k)
      if (s === 1) back += 1
      else if (s === undefined) {
        state.set(k, 1)
        stack.push({ id: k, i: 0 })
      }
    }
  }
  return back
}

export function buildModel(data: ProcessData): ProcessModel {
  const products = buildProducts(data.products)
  const wcTypes = buildWcTypes(data)
  const linkSource: LinkSource = data.links ? 'engine' : 'text'
  const warnings: string[] = []

  // Связи из таблиц движка (если сервер их отдаёт).
  const wctsOf = new Map<string, string[]>()
  const inputsOf = new Map<string, ModelInput[]>()
  const pairNorm = new Map<string, { tOpt: number; tNorm: number; tPess: number; setup: number }>()
  if (data.links) {
    for (const r of data.links.wc_types) {
      const list = wctsOf.get(r.operation_id) ?? []
      if (!list.includes(r.wc_type_id)) list.push(r.wc_type_id)
      wctsOf.set(r.operation_id, list)
    }
    for (const r of data.links.inputs) {
      const list = inputsOf.get(r.operation_id) ?? []
      list.push({ productId: r.product_id, qty: toNum(r.qty, 1) })
      inputsOf.set(r.operation_id, list)
    }
    for (const r of data.links.time_norms ?? []) {
      pairNorm.set(`${r.operation_id}|${r.wc_type_id}`, {
        tOpt: toNum(r.t_opt), tNorm: toNum(r.t_norm), tPess: toNum(r.t_pess), setup: toNum(r.setup_time),
      })
    }
  }
  const wctByName = new Map<string, string>()
  for (const t of wcTypes.values()) wctByName.set(t.name, t.id)

  // Действующие техкарты изделий.
  const routingOf = new Map<string, { productId: string; name: string }>()
  for (const r of data.routings) {
    if (!r.id || !r.product_id || !isDefaultRouting(r.is_default)) continue
    const p = products.get(r.product_id)
    if (!p) continue
    routingOf.set(r.id, { productId: r.product_id, name: str(r.name) })
    p.routings.push({ id: r.id, name: str(r.name), version: toNum(r.version, 1) })
  }

  const ops = new Map<string, ModelOp>()
  const sortedOps = [...data.operations].sort(compareOps)
  let ignoredOps = 0
  let unresolvedInputs = 0
  let opsWithoutWcType = 0
  for (const o of sortedOps) {
    const rt = o.routing_id ? routingOf.get(o.routing_id) : undefined
    if (!rt) { ignoredOps += 1; continue }
    const wcTypeIds = (data.links ? wctsOf.get(o.id) : wcTypesFromText(str(o.wc_types), wctByName, wcTypes)) ?? []
    let inputs: ModelInput[]
    if (data.links) {
      inputs = (inputsOf.get(o.id) ?? []).filter((i) => {
        const ok = products.has(i.productId)
        if (!ok) unresolvedInputs += 1
        return ok
      })
    } else {
      const parsed = inputsFromText(str(o.inputs), products)
      inputs = parsed.inputs
      unresolvedInputs += parsed.unresolved
    }
    if (wcTypeIds.length === 0) opsWithoutWcType += 1
    const tOpt = toNum(o.t_opt), tNorm = toNum(o.t_norm), tPess = toNum(o.t_pess)
    let { tExp, sigma, fallback } = pert(tOpt, tNorm, tPess)
    let setupTime = toNum(o.setup_time)
    const pn = wcTypeIds.length ? pairNorm.get(`${o.id}|${wcTypeIds[0]}`) : undefined
    if (pn && pn.tNorm > 0) ({ tExp, sigma, fallback } = pert(pn.tOpt, pn.tNorm, pn.tPess))
    if (pn && pn.setup > 0) setupTime = pn.setup
    ops.set(o.id, {
      id: o.id,
      code: str(o.code),
      name: str(o.name) || o.id,
      productId: rt.productId,
      routingId: o.routing_id,
      routingName: rt.name,
      orderNo: toNum(o.order_no, 10),
      wcTypeIds,
      inputs,
      tOpt, tNorm, tPess, tExp, sigma,
      sigmaFallback: fallback,
      pairNorm: Boolean(pn && pn.tNorm > 0),
      setupTime,
      cost: toNum(o.cost),
      riskCoef: toNum(o.risk_coef, 0.05),
    })
    products.get(rt.productId)?.opIds.push(o.id)
  }

  const consumersOf = new Map<string, string[]>()
  for (const op of ops.values()) {
    for (const inp of op.inputs) {
      const list = consumersOf.get(inp.productId) ?? []
      list.push(op.id)
      consumersOf.set(inp.productId, list)
    }
  }

  const bomCycles = countBomCycles(products, ops)
  if (!data.links) {
    warnings.push(
      'Сервер не отдаёт таблицы связей движка (operation_inputs / operation_wc_types): ' +
        'типы РЦ и входы восстановлены из текстовых полей операций и могут быть неполными.',
    )
  }
  if (unresolvedInputs > 0) warnings.push(`Входов, не найденных в справочнике изделий: ${unresolvedInputs}.`)
  if (opsWithoutWcType > 0) {
    warnings.push(`Операций без типа РЦ: ${opsWithoutWcType} — движок не сможет назначить им станок.`)
  }
  if (bomCycles > 0) warnings.push(`Циклы в составе изделий: ${bomCycles} — движок обрывает такие ветви.`)

  return {
    products,
    ops,
    wcTypes,
    consumersOf,
    linkSource,
    stats: { ignoredOps, unresolvedInputs, opsWithoutWcType, bomCycles },
    warnings,
  }
}
