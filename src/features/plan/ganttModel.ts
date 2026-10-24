/**
 * Чистая логика диаграммы Ганта: ЕДИНАЯ раскраска (изделие → слот chart-системы slotForEntity:
 * детерминированно по id, 6 именованных + «прочее» со штриховкой, никогда не по модулю), шаг и
 * подписи оси времени (часы или даты от начала горизонта), двухуровневая ось (ganttAxis.ts),
 * группировка полос по типу РЦ, цеху или заказу, отличительные подписи дорожек, доли наладки/ТО.
 */
import type { ScheduleResult } from '../../lib/api'
import { num } from '../../explain/format'
import { ENTITY_SLOTS, slotForEntity } from '../../ui/charts/palette'
import type { PlanBar } from './types'

/** Цветовых слотов на изделия: --chart-1…6 (slotForEntity); дальше — «прочее» (--chart-8, штриховка). */
export const COLOR_SLOTS = ENTITY_SLOTS

export interface ProductSwatch {
  productId: string
  name: string
  /** Σ объёма заказов изделия в программе. */
  qty: number
  /** Индекс слота палитры; null — «прочее» (штриховка). */
  slot: number | null
}

export interface Palette {
  swatches: ProductSwatch[]
  /** Есть ли полосы вне палитры (снабжение, изделия сверх 7 слотов). */
  hasOther: boolean
  slotOf: (productId: string) => number | null
}

type Program = ScheduleResult['program']

/**
 * Одна раскраска для полос, легенды и дифа: слот изделия — slotForEntity по id изделий программы
 * (одно изделие — один цвет при любой сортировке); легенда — в порядке программы.
 */
export function buildPalette(program: Program, bars: readonly PlanBar[]): Palette {
  const universe = [...new Set(program.map((o) => o.product_id))]
  const byId = new Map<string, ProductSwatch>()
  for (const o of program) {
    const prev = byId.get(o.product_id)
    if (prev) {
      byId.set(o.product_id, { ...prev, qty: prev.qty + (o.qty || 0) })
    } else {
      const e = slotForEntity('product', o.product_id, universe)
      byId.set(o.product_id, { productId: o.product_id, name: o.product_name || o.product_id, qty: o.qty || 0, slot: e.other ? null : e.slot })
    }
  }
  const swatches = [...byId.values()]
  const slotOf = (pid: string): number | null => byId.get(pid)?.slot ?? null
  const hasOther = swatches.some((s) => s.slot === null) || bars.some((b) => !byId.has(b.product_id))
  return { swatches, hasOther, slotOf }
}

/** CSS-цвет слота (только токены). */
export function colorVar(slot: number | null): string {
  return slot === null ? 'var(--chart-other)' : `var(--chart-${slot + 1})`
}

/* ── Ось времени ─────────────────────────────────────────────────────────── */

const NICE_H = [1, 2, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720, 1440, 2160, 4320] as const
const DAY = 24
const MONTH = 720

/** Шаг делений: ближайший «круглый» интервал, дающий ≈ один тик на `targetPx` пикселей. */
export function niceStep(span: number, trackW: number, targetPx = 96): number {
  const target = span * (targetPx / Math.max(1, trackW))
  return NICE_H.find((s) => s >= target) ?? NICE_H[NICE_H.length - 1]
}

/** Подпись деления по шагу: часы до суток, далее сутки, далее месяцы (30 сут). */
export function fmtTick(h: number, step: number): string {
  if (h === 0) return '0'
  if (step >= MONTH) return `${num(h / MONTH, 1)} мес`
  if (step >= DAY) return `${num(h / DAY, 0)} сут`
  if (h % DAY === 0) return `${num(h / DAY, 0)} сут`
  return `${num(h, 0)} ч`
}

const MS_PER_HOUR = 3_600_000
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Подпись деления датой от начала горизонта (X1 §5 п. 7): шаг ≥ суток — «дд.мм»,
 * часовой шаг — «чч:00», а на границе суток — «дд.мм». Без даты старта — часы/сутки.
 */
export function fmtTickDate(h: number, step: number, start: Date | null): string {
  if (!start) return fmtTick(h, step)
  const d = new Date(start.getTime() + h * MS_PER_HOUR)
  const day = `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}`
  if (step >= DAY || h % DAY === 0) return day
  return `${pad2(d.getUTCHours())}:00`
}

/** Деления 0…span с шагом step (включая 0). */
export function makeTicks(span: number, step: number): number[] {
  const out: number[] = []
  if (step <= 0) return out
  for (let t = 0; t <= span + 1e-6; t += step) out.push(t)
  return out
}

/** Деление — граница суток (рисуется чуть плотнее). */
export const isMajorTick = (t: number, step: number): boolean => step < DAY && t > 0 && t % DAY === 0

/* ── Группировка: тип оборудования → станки → полосы ─────────────────────── */

export interface GanttMachine { id: string; name: string; bars: PlanBar[] }
export interface GanttGroup { wc: string; name: string; machines: GanttMachine[]; nOps: number }

export function groupBars(bars: readonly PlanBar[]): GanttGroup[] {
  const byWc = new Map<string, { name: string; machines: Map<string, GanttMachine> }>()
  for (const g of bars) {
    const wc = g.wc_type_id || 'other'
    let grp = byWc.get(wc)
    if (!grp) {
      grp = { name: g.wc_name || wc, machines: new Map() }
      byWc.set(wc, grp)
    }
    const mid = g.machine_id || '—'
    let mc = grp.machines.get(mid)
    if (!mc) {
      mc = { id: mid, name: g.machine_name || mid, bars: [] }
      grp.machines.set(mid, mc)
    }
    mc.bars.push(g)
  }
  return [...byWc.entries()].map(([wc, grp]) => {
    const machines = [...grp.machines.values()]
    return { wc, name: grp.name, machines, nOps: machines.reduce((a, m) => a + m.bars.length, 0) }
  })
}

/**
 * Группировка по цеху (X1 §5.1 «по цехам»): цех = `group_name` типа РЦ из НСИ; станки
 * внутри цеха подписываются «тип · станок». Типы без цеха — группа «Без цеха».
 */
export function groupBarsByShop(bars: readonly PlanBar[], shopOf: (wcTypeId: string) => string | undefined): GanttGroup[] {
  const NO_SHOP = 'Без цеха'
  const byShop = new Map<string, Map<string, GanttMachine>>()
  for (const g of bars) {
    const shop = shopOf(g.wc_type_id) || NO_SHOP
    let machines = byShop.get(shop)
    if (!machines) {
      machines = new Map()
      byShop.set(shop, machines)
    }
    const mid = g.machine_id || '—'
    let mc = machines.get(mid)
    if (!mc) {
      mc = { id: mid, name: `${g.wc_name || g.wc_type_id} · ${g.machine_name || mid}`, bars: [] }
      machines.set(mid, mc)
    }
    mc.bars.push(g)
  }
  return [...byShop.entries()]
    .sort(([a], [b]) => (a === NO_SHOP ? 1 : b === NO_SHOP ? -1 : a.localeCompare(b, 'ru')))
    .map(([shop, machines]) => {
      const list = [...machines.values()]
      return { wc: shop, name: shop, machines: list, nOps: list.reduce((a, m) => a + m.bars.length, 0) }
    })
}

/* ── Разложение полосы: наладка (в начале) и ТО/ремонт (в конце) ─────────── */

export interface BarSegments { setupFrac: number; downFrac: number }

/** Доли наладки и простоя в длине полосы (работа = обработка + наладка + ТО/ремонт). */
export function barSegments(g: PlanBar): BarSegments {
  const setup = Math.max(0, g.setup_hours ?? 0)
  const down = Math.max(0, g.downtime_hours ?? 0)
  if (setup + down <= 0) return { setupFrac: 0, downFrac: 0 }
  const span = Math.max(0, g.end - g.start)
  const proc = g.proc_hours ?? Math.max(0, span - setup - down)
  const work = proc + setup + down
  if (work <= 0) return { setupFrac: 0, downFrac: 0 }
  return { setupFrac: setup / work, downFrac: down / work }
}

/* ── Подписи дорожек: только отличающая часть, многоточие в середине ─────── */

/** «Ленточнопильный станок №1» при типе «Ленточнопильный станок» → «№1»; без общего начала — имя целиком. */
export function distinctPart(name: string, wcName: string): string {
  const n = name.trim()
  const w = wcName.trim()
  if (w && n.length > w.length && n.toLowerCase().startsWith(w.toLowerCase())) {
    const tail = n.slice(w.length).replace(/^[\s·,—-]+/, '').trim()
    if (tail) return tail
  }
  return n
}

/** Многоточие в середине: «№1 · Ленточноп…рный станок» — начало и конец видны. */
export function middleEllipsis(s: string, max: number): string {
  if (max < 3 || s.length <= max) return s
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`
}

export interface LaneSource { id: string; name: string; wcName: string }

/**
 * Подписи дорожек станков: в группировке по типам РЦ (тип — в заголовке группы) — «№1»; по цехам —
 * «№1 · Ленточнопильный станок» с многоточием в середине. Повторы получают «(2)», «(3)» — две
 * одинаковые видимые подписи невозможны.
 */
export function laneLabels(lanes: readonly LaneSource[], mode: 'wc' | 'shop', maxChars: number): Map<string, string> {
  const out = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const l of lanes) {
    const tail = distinctPart(l.name, l.wcName)
    const full = mode === 'wc' ? tail : tail === l.name.trim() ? tail : `${tail} · ${l.wcName}`
    let label = middleEllipsis(full, maxChars)
    const k = (seen.get(label) ?? 0) + 1
    seen.set(label, k)
    if (k > 1) label = `${middleEllipsis(full, Math.max(3, maxChars - 4))} (${k})`
    out.set(l.id, label)
  }
  return out
}

/* ── Режим «по заказам»: дорожка — заказ, группа — изделие ───────────────── */

export function groupBarsByOrder(bars: readonly PlanBar[]): GanttGroup[] {
  const byProduct = new Map<string, { name: string; orders: Map<number, GanttMachine> }>()
  for (const g of bars) {
    const pid = g.product_id || 'other'
    let grp = byProduct.get(pid)
    if (!grp) {
      grp = { name: g.product_name || pid, orders: new Map() }
      byProduct.set(pid, grp)
    }
    let lane = grp.orders.get(g.order_idx)
    if (!lane) {
      lane = { id: `o${g.order_idx}`, name: `Заказ №${g.order_idx + 1} · ${g.product_name || pid}`, bars: [] }
      grp.orders.set(g.order_idx, lane)
    }
    lane.bars.push(g)
  }
  return [...byProduct.entries()].map(([pid, grp]) => {
    const machines = [...grp.orders.values()].sort((a, b) => a.bars[0].order_idx - b.bars[0].order_idx)
    return { wc: `p:${pid}`, name: grp.name, machines, nOps: machines.reduce((a, m) => a + m.bars.length, 0) }
  })
}

/** Срок заказа дорожки (◆) — один на заказ. */
export const laneDue = (lane: GanttMachine): number | null => (lane.bars.length ? Math.max(...lane.bars.map((b) => b.due)) : null)
