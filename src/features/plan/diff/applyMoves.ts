/**
 * Применение структурных ходов к расписанию НА ФРОНТЕНДЕ (UX-V2 §4.8): пока бэкенд не отдаёт
 * прогон «после» (`POST /api/runs/:id/moves/decide` — A1 §7 п. 4), «после» строится из снимков
 * `before/after` каждого принятого (или предложенного) хода. Поддерживаются ключи снимков,
 * которые отдаёт RlRule и фикстуры: `release_hours` (сдвиг заказа), `machine_id` (другой станок),
 * `outsourced` (операция снята с плана), `n_batches` (дробление — полоса делится), `frozen` (пин).
 * Остальные виды ходов (finance, reroute…) расписание не меняют — дифф их не показывает, таблица ходов — да.
 */
import type { GanttJob, ScheduleResult, StructuralMove } from '../../../lib/api'

export interface AppliedBar extends GanttJob {
  /** Ход, которым полоса изменена/удалена/добавлена. */
  moveId?: string
  /** Полоса заморожена (пин «не трогать»). */
  frozen?: boolean
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * Затронута ли полоса ходом: все заданные измерения целей должны совпасть (И) — операция техкарты
 * общая у разных заказов одного изделия, поэтому «op_ids + order_idx» сужает до одного заказа.
 */
export function touches(move: StructuralMove, bar: GanttJob): boolean {
  const t = move.targets
  const dims: boolean[] = []
  if (t.op_ids?.length) dims.push(t.op_ids.includes(bar.op_id))
  if (t.order_idx?.length) dims.push(t.order_idx.includes(bar.order_idx))
  if (t.machine_ids?.length) dims.push(t.machine_ids.includes(bar.machine_id))
  if (t.product_ids?.length) dims.push(t.product_ids.includes(bar.product_id))
  return dims.length > 0 && dims.every(Boolean)
}

function applyOne(bars: readonly AppliedBar[], move: StructuralMove, frozen: boolean): AppliedBar[] {
  const out: AppliedBar[] = []
  const relBefore = num(move.before.release_hours)
  const relAfter = num(move.after.release_hours)
  const shift = relBefore !== null && relAfter !== null ? relAfter - relBefore : num(move.after.shift_h)
  const machine = str(move.after.machine_id)
  const machineName = str(move.after.machine_name) ?? machine
  const outsourced = move.after.outsourced === true
  const nBatches = num(move.after.n_batches)
  for (const b of bars) {
    if (!touches(move, b)) { out.push(b); continue }
    if (frozen) { out.push({ ...b, frozen: true, moveId: move.id }); continue }
    if (outsourced) continue
    let nb: AppliedBar = { ...b, moveId: move.id }
    if (shift !== null && shift !== 0) nb = { ...nb, start: Math.max(0, nb.start + shift), end: Math.max(0, nb.end + shift) }
    if (machine) nb = { ...nb, machine_id: machine, machine_name: machineName ?? machine }
    if (nBatches !== null && nBatches > 1 && move.kind === 'split') {
      const span = (nb.end - nb.start) / nBatches
      for (let k = 0; k < nBatches; k++) {
        out.push({ ...nb, job_idx: nb.job_idx * 1000 + k, op_name: `${nb.op_name} · ${k + 1}/${nBatches}`, start: nb.start + span * k, end: nb.start + span * (k + 1) })
      }
      continue
    }
    out.push(nb)
  }
  return out
}

/**
 * Расписание «после»: к полосам «до» применяются ходы в порядке зависимости (родители первыми).
 * Замороженные ходы помечают полосы, не меняя их.
 */
export function applyMoves(result: ScheduleResult, moves: readonly StructuralMove[], statusOf: (m: StructuralMove) => string): AppliedBar[] {
  const active = moves.filter((m) => { const s = statusOf(m); return s === 'accepted' || s === 'applied' || s === 'frozen' })
  const ordered = [...active].sort((a, b) => (a.depends_on?.includes(b.id) ? 1 : b.depends_on?.includes(a.id) ? -1 : 0))
  let bars: AppliedBar[] = result.gantt.map((g) => ({ ...g }))
  for (const m of ordered) bars = applyOne(bars, m, statusOf(m) === 'frozen')
  return bars
}
