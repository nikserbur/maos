/**
 * Чистая логика диаграммы Ганта: ЕДИНАЯ раскраска (изделие → --chart-n по индексу
 * в программе, ≤ 7 цветов + «прочее»), шаг и подписи оси времени (часы или даты от начала
 * горизонта), группировка полос по типу РЦ или по цеху, доли наладки/ТО.
 */
import type { ScheduleResult } from '../../lib/api'
import { num } from '../../explain/format'
import type { PlanBar } from './types'

/** Цветовых слотов на изделия: --chart-1…7; восьмой (серый) зарезервирован под «прочее». */
export const COLOR_SLOTS = 7

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

/** Одна раскраска для полос и легенды: порядок первого появления изделия в программе. */
export function buildPalette(program: Program, bars: readonly PlanBar[]): Palette {
  const byId = new Map<string, ProductSwatch>()
  for (const o of program) {
    const prev = byId.get(o.product_id)
    if (prev) {
      byId.set(o.product_id, { ...prev, qty: prev.qty + (o.qty || 0) })
    } else {
      const slot = byId.size < COLOR_SLOTS ? byId.size : null
      byId.set(o.product_id, { productId: o.product_id, name: o.product_name || o.product_id, qty: o.qty || 0, slot })
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
