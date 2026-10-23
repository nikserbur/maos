/**
 * Модель дифа двух расписаний «как диф кода» (UX-V2 §4.8): по станкам — две дорожки (до / после),
 * каждая полоса классифицируется: без изменений · перенесена (другой станок или сдвиг ≥ EPS ч) ·
 * удалена (только в «до») · добавлена (только в «после») · заморожена. Изменения упорядочены по
 * времени для клавиатурного обхода j/k; дорожки без изменений можно скрыть.
 * Чистые функции, числа — только через src/explain/format.ts у вызывающего.
 */
import type { GanttJob } from '../../../lib/api'
import { signed } from '../../../explain/format'
import type { AppliedBar } from './applyMoves'

export type DiffKind = 'same' | 'moved' | 'removed' | 'added' | 'frozen'

export interface DiffBar {
  kind: DiffKind
  bar: AppliedBar
  /** Для перенесённых: где полоса была (станок и интервал «до»). */
  from?: { machine_id: string; machine_name: string; start: number; end: number }
  /** Ход, которым объясняется изменение. */
  moveId?: string
}

export interface DiffLane {
  machineId: string
  name: string
  wcName: string
  before: DiffBar[]
  after: DiffBar[]
  changed: boolean
}

export interface DiffChange {
  key: string
  kind: Exclude<DiffKind, 'same'>
  laneId: string
  jobIdx: number
  at: number
  moveId?: string
  bar: AppliedBar
}

export interface DiffSummary { same: number; moved: number; removed: number; added: number; frozen: number }

export interface ScheduleDiff {
  lanes: DiffLane[]
  changes: DiffChange[]
  summary: DiffSummary
  makespan: number
}

/** Сдвиг меньше этого порога — «та же» полоса (шум округления). */
export const MOVE_EPS_H = 0.05

const sameBar = (a: GanttJob, b: GanttJob): boolean =>
  a.machine_id === b.machine_id && Math.abs(a.start - b.start) < MOVE_EPS_H && Math.abs(a.end - b.end) < MOVE_EPS_H

export function diffSchedules(before: readonly AppliedBar[], after: readonly AppliedBar[]): ScheduleDiff {
  const beforeBy = new Map(before.map((b) => [b.job_idx, b]))
  const afterBy = new Map(after.map((b) => [b.job_idx, b]))
  const lanes = new Map<string, DiffLane>()
  const lane = (b: GanttJob): DiffLane => {
    const id = b.machine_id || '—'
    let l = lanes.get(id)
    if (!l) { l = { machineId: id, name: b.machine_name || id, wcName: b.wc_name, before: [], after: [], changed: false }; lanes.set(id, l) }
    return l
  }
  const changes: DiffChange[] = []
  const summary: DiffSummary = { same: 0, moved: 0, removed: 0, added: 0, frozen: 0 }
  const push = (kind: DiffChange['kind'], laneId: string, b: AppliedBar, moveId?: string) =>
    changes.push({ key: `${kind}:${b.job_idx}`, kind, laneId, jobIdx: b.job_idx, at: b.start, moveId, bar: b })

  for (const b of before) {
    const a = afterBy.get(b.job_idx)
    const l = lane(b)
    if (!a) {
      l.before.push({ kind: 'removed', bar: b, moveId: findMove(after, b) })
      l.changed = true; summary.removed += 1
      push('removed', l.machineId, b, findMove(after, b))
    } else if (a.frozen) {
      l.before.push({ kind: 'frozen', bar: b, moveId: a.moveId })
      lane(a).after.push({ kind: 'frozen', bar: a, moveId: a.moveId })
      l.changed = true; summary.frozen += 1
      push('frozen', l.machineId, a, a.moveId)
    } else if (sameBar(a, b)) {
      l.before.push({ kind: 'same', bar: b })
      lane(a).after.push({ kind: 'same', bar: a })
      summary.same += 1
    } else {
      const from = { machine_id: b.machine_id, machine_name: b.machine_name, start: b.start, end: b.end }
      l.before.push({ kind: 'moved', bar: b, moveId: a.moveId })
      const la = lane(a)
      la.after.push({ kind: 'moved', bar: a, from, moveId: a.moveId })
      l.changed = true; la.changed = true; summary.moved += 1
      push('moved', la.machineId, a, a.moveId)
    }
  }
  for (const a of after) {
    if (beforeBy.has(a.job_idx)) continue
    const l = lane(a)
    l.after.push({ kind: 'added', bar: a, moveId: a.moveId })
    l.changed = true; summary.added += 1
    push('added', l.machineId, a, a.moveId)
  }
  const sortBars = (xs: DiffBar[]) => xs.sort((x, y) => x.bar.start - y.bar.start)
  const out = [...lanes.values()].map((l) => ({ ...l, before: sortBars(l.before), after: sortBars(l.after) }))
    .sort((x, y) => Number(y.changed) - Number(x.changed) || x.wcName.localeCompare(y.wcName, 'ru') || x.name.localeCompare(y.name, 'ru'))
  changes.sort((x, y) => x.at - y.at || x.jobIdx - y.jobIdx)
  const makespan = Math.max(1, ...before.map((b) => b.end), ...after.map((b) => b.end))
  return { lanes: out, changes, summary, makespan }
}

/** Удалённая полоса: ход ищется по соседним полосам того же заказа в «после» (аутсорсинг снимает операцию целиком). */
function findMove(after: readonly AppliedBar[], removed: GanttJob): string | undefined {
  return after.find((a) => a.order_idx === removed.order_idx && a.moveId)?.moveId
}

/** Следующее/предыдущее изменение для клавиш j/k (циклически). */
export function stepChange(changes: readonly DiffChange[], current: string | null, dir: 1 | -1): string | null {
  if (changes.length === 0) return null
  const i = current ? changes.findIndex((c) => c.key === current) : -1
  if (i < 0) return (dir === 1 ? changes[0] : changes[changes.length - 1]).key
  return changes[(i + dir + changes.length) % changes.length].key
}

export const DIFF_KIND_LABEL: Readonly<Record<DiffKind, string>> = {
  same: 'без изменений', moved: 'перенесено', removed: 'удалено', added: 'добавлено', frozen: 'заморожено',
}

/* ── Диф маршрутов (режим «Маршрут»): цепочка операций заказа до/после ──── */

export interface RouteStep {
  op_id: string; op_name: string
  /** Где выполняется / что изменилось: «Станок 1 → Станок 2», «Токарный · сдвиг +24 ч». */
  wc_name: string
  kind: DiffKind
  /** Подряд идущие одинаковые шаги (партии одной операции) схлопываются: ×N. */
  count: number
}
export interface RouteDiffRow { orderIdx: number; product: string; steps: RouteStep[]; changed: boolean }

const shiftText = (dh: number): string => `сдвиг ${signed(dh, 'ч')}`

/** Где шаг «после»: другой станок — «откуда → куда», тот же — сдвиг по времени. */
function placeText(b: GanttJob, a: GanttJob | undefined, kind: DiffKind): string {
  if (!a || kind !== 'moved') return b.wc_name
  if (a.machine_id !== b.machine_id) return `${b.machine_name} → ${a.machine_name}`
  return `${b.wc_name} · ${shiftText(a.start - b.start)}`
}

/** Схлопнуть подряд идущие шаги одной операции с одинаковым видом и местом. */
function collapse(steps: RouteStep[]): RouteStep[] {
  const out: RouteStep[] = []
  for (const st of steps) {
    const last = out[out.length - 1]
    if (last && last.op_id === st.op_id && last.kind === st.kind && last.wc_name === st.wc_name) out[out.length - 1] = { ...last, count: last.count + 1 }
    else out.push(st)
  }
  return out
}

/** По заказам: последовательность операций «до» с пометками удалено/перенесено, плюс добавленные «после». */
export function diffRoutes(before: readonly AppliedBar[], after: readonly AppliedBar[]): RouteDiffRow[] {
  const afterBy = new Map(after.map((b) => [b.job_idx, b]))
  const beforeIdx = new Set(before.map((b) => b.job_idx))
  const orders = new Map<number, RouteDiffRow>()
  const row = (b: GanttJob) => {
    let r = orders.get(b.order_idx)
    if (!r) { r = { orderIdx: b.order_idx, product: b.product_name, steps: [], changed: false }; orders.set(b.order_idx, r) }
    return r
  }
  for (const b of [...before].sort((x, y) => x.start - y.start)) {
    const a = afterBy.get(b.job_idx)
    const kind: DiffKind = !a ? 'removed' : a.frozen ? 'frozen' : sameBar(a, b) ? 'same' : 'moved'
    const r = row(b)
    r.steps.push({ op_id: b.op_id, op_name: b.op_name, wc_name: placeText(b, a, kind), kind, count: 1 })
    if (kind !== 'same') r.changed = true
  }
  for (const a of after) {
    if (beforeIdx.has(a.job_idx)) continue
    const r = row(a)
    r.steps.push({ op_id: a.op_id, op_name: a.op_name, wc_name: a.wc_name, kind: 'added', count: 1 })
    r.changed = true
  }
  return [...orders.values()]
    .map((r) => ({ ...r, steps: collapse(r.steps) }))
    .sort((x, y) => Number(y.changed) - Number(x.changed) || x.orderIdx - y.orderIdx)
}
