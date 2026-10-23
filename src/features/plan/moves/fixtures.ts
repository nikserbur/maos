/**
 * ПРИМЕР структурных ходов (UX-V2 §7 G4: «до бэкенда панель ходов работает на фикстурах»).
 * Политика RL не прошла гейт §7.4 (A1 §5: чемпион — лучшее правило), поэтому реальных `moves[]`
 * в ответе /api/schedule нет. Чтобы панель, диф Ганта и клавиатура были проверяемы, ходы
 * строятся детерминированно поверх ТЕКУЩЕГО расписания: цели — настоящие заказы, операции и
 * станки из `result.gantt`, а все денежные числа — иллюстративные константы. Каждый ход несёт
 * `agent.policy_version = 'пример'`; UI обязан подписывать их «пример», никогда — как результат.
 */
import type { AgentGuardrails, GanttJob, MoveImpact, MovesResult, ScheduleResult, StructuralMove } from '../../../lib/api'
import { defaultGuardrails } from '../../agents/guardrails'

export const DEMO_POLICY = 'пример'
export const DEMO_RUN_ID = 'demo'

/** Ход-пример: признак для подписи «пример» в любой точке UI. */
export const isDemoMove = (m: StructuralMove): boolean => m.agent.policy_version === DEMO_POLICY

const M = 1e6

function impact(cvar: [number, number], cash: [number, number], gap: [number, number], win: number, ci: [number, number], cmax: number, otd: number): MoveImpact {
  return {
    profit: { e_before: 58.2 * M, e_after: 58.2 * M + (cvar[1] - cvar[0]) * 0.2 * M, cvar_before: cvar[0] * M, cvar_after: cvar[1] * M },
    cash: { min_cash_cvar_before: cash[0] * M, min_cash_cvar_after: cash[1] * M, p_gap_before: gap[0], p_gap_after: gap[1] },
    schedule: { cmax_e_delta_h: cmax, cmax_cvar_delta_h: cmax * 1.4, otd_delta: otd, tardiness_delta_h: -otd * 40 },
    win_share: win,
    ci95: [ci[0] * M, ci[1] * M],
  }
}

const REGIMES = {
  rate: { id: 'rate_jump', label: 'скачок ставки', share: 0.18 },
  price: { id: 'price_crisis', label: 'ценовой кризис', share: 0.24 },
  supply: { id: 'supply_delay', label: 'задержка поставок', share: 0.12 },
} as const

/** Первые операции разных заказов — устойчивые цели для примера. */
function pickTargets(gantt: readonly GanttJob[]) {
  const byOrder = new Map<number, GanttJob[]>()
  for (const g of [...gantt].sort((a, b) => a.start - b.start)) {
    const list = byOrder.get(g.order_idx) ?? []
    list.push(g)
    byOrder.set(g.order_idx, list)
  }
  const orders = [...byOrder.keys()].sort((a, b) => a - b)
  const opOf = (i: number, k = 0): GanttJob | undefined => byOrder.get(orders[i % Math.max(1, orders.length)])?.[k]
  // Станок-альтернатива: другой станок того же типа РЦ, если есть.
  const altMachine = (g: GanttJob | undefined) => g
    ? gantt.find((x) => x.wc_type_id === g.wc_type_id && x.machine_id && x.machine_id !== g.machine_id)
    : undefined
  return { orders, opOf, altMachine }
}

const base = (id: string, patch: Partial<StructuralMove>): StructuralMove => ({
  id, kind: 'shift', status: 'proposed', targets: {}, before: {}, after: {},
  impact: impact([0, 0], [0, 0], [0, 0], 0.5, [0, 0], 0, 0),
  justification: { regime: REGIMES.rate, scenarios: [], map_nodes: [] },
  masks_checked: [], proposed_at: '2026-10-22T12:00:00', agent: { level: 'L2', policy_version: DEMO_POLICY, seed: 0 },
  ...patch,
})

/** Пример пакета ходов поверх результата; null — расписание пустое. */
export function demoMoves(result: ScheduleResult): MovesResult | null {
  const { orders, opOf, altMachine } = pickTargets(result.gantt)
  if (orders.length === 0) return null
  const a = opOf(0)!
  const b = opOf(1) ?? a
  const c = opOf(2) ?? b
  const d = opOf(3) ?? c
  const alt = altMachine(c)
  const moves: StructuralMove[] = [
    base('demo-out', {
      kind: 'outsource', targets: { op_ids: [b.op_id], order_idx: [b.order_idx] }, after: { outsourced: true, supplier: 'поставщик из НСИ', lead_h: 72 },
      before: { machine_id: b.machine_id }, impact: impact([-1.8, -0.9], [-2.1, -1.4], [0.11, 0.06], 0.91, [0.6, 1.2], -6, 0.02),
      justification: { regime: REGIMES.rate, map_nodes: ['int.finance', 'dist.durations', 'dec.cash'], text: 'В хвосте ставки выгоднее не держать операцию на узком месте: закупка снимает очередь и ускоряет инкассацию.',
        scenarios: [{ idx: 412, key_rate: 0.24, gain: 2.4 * M }, { idx: 1877, key_rate: 0.22, gain: 2.1 * M }, { idx: 95, key_rate: 0.21, lead_delay_h: 36, gain: 1.9 * M }] },
      masks_checked: ['есть поставщик с ценой и сроком', 'лимит доли аутсорсинга ≤ 15 %'],
    }),
    base('demo-shift', {
      kind: 'shift', targets: { order_idx: [a.order_idx] }, before: { release_hours: 0 }, after: { release_hours: 24 }, depends_on: ['demo-out'],
      impact: impact([-0.9, -0.6], [-1.4, -1.1], [0.06, 0.05], 0.78, [0.1, 0.5], 4, 0.01),
      justification: { regime: REGIMES.price, map_nodes: ['dec.cash', 'crit.cash'], text: 'Сдвиг запуска на сутки переносит закупку сырья за неделю ценового пика (имеет смысл только вместе с аутсорсингом выше).',
        scenarios: [{ idx: 233, price_shock: 0.31, gain: 0.8 * M }, { idx: 2690, price_shock: 0.27, gain: 0.7 * M }] },
      masks_checked: ['не раньше сегодня и поставок MRP', 'не позже срока минус цикл'],
    }),
    base('demo-split', {
      kind: 'split', targets: { op_ids: [c.op_id], order_idx: [c.order_idx] }, before: { n_batches: 1 }, after: { n_batches: 2 },
      impact: impact([-0.6, -0.5], [-1.1, -1.05], [0.05, 0.05], 0.64, [-0.05, 0.25], -3, 0),
      justification: { regime: REGIMES.supply, map_nodes: ['dec.lots', 'dist.durations'], text: 'Две партии вместо одной: следующая операция стартует раньше; выигрыш неустойчив — ДИ содержит ноль.',
        scenarios: [{ idx: 1504, lead_delay_h: 48, gain: 0.3 * M }] },
      masks_checked: ['в пределах min–max партии изделия'],
    }),
    ...(alt ? [base('demo-reassign', {
      kind: 'reassign', targets: { op_ids: [c.op_id], order_idx: [c.order_idx] }, before: { machine_id: c.machine_id }, after: { machine_id: alt.machine_id, machine_name: alt.machine_name },
      impact: impact([-0.5, -0.45], [-1.05, -1.0], [0.05, 0.04], 0.81, [0.02, 0.09], -2, 0), depends_on: ['demo-split'],
      justification: { regime: REGIMES.supply, map_nodes: ['int.capacity', 'int.labor'], text: 'Партии — на соседний станок того же типа: допущенный рабочий есть, очередь короче.',
        scenarios: [{ idx: 777, lead_delay_h: 24, gain: 0.1 * M }] },
      masks_checked: ['только допустимые типы и допущенные рабочие'],
    })] : []),
    base('demo-shift-2', {
      kind: 'shift', targets: { order_idx: [d.order_idx] }, before: { release_hours: 0 }, after: { release_hours: 12 },
      impact: impact([-0.45, -0.47], [-1.0, -0.98], [0.04, 0.04], 0.42, [-0.12, 0.04], 2, -0.01),
      justification: { regime: REGIMES.price, map_nodes: ['crit.profit'], text: 'Слабый ход: в большинстве сценариев проигрывает — для контраста «безопасных».',
        scenarios: [{ idx: 18, price_shock: 0.12, gain: 0.05 * M }] },
      masks_checked: ['не позже срока минус цикл'],
    }),
    base('demo-finance', {
      kind: 'finance', targets: {}, before: { tranche_share: 0 }, after: { tranche_share: 0.25, week: 6 },
      impact: impact([-0.47, -0.4], [-0.98, -0.6], [0.04, 0.01], 0.88, [0.03, 0.11], 0, 0),
      justification: { regime: REGIMES.rate, map_nodes: ['int.finance', 'dec.cash'], text: 'Транш 25 % невыбранного лимита на 6-й неделе закрывает разрыв кассы в хвосте ставки; расписание не меняет.',
        scenarios: [{ idx: 412, key_rate: 0.24, gain: 0.4 * M }] },
      masks_checked: ['лимит линии и ковенанты', 'd_t ≤ невыбранный лимит'],
    }),
  ]
  const guardrails: AgentGuardrails = defaultGuardrails(result.alpha || 0.1)
  return {
    run_id: DEMO_RUN_ID, baseline_run_id: result.plan_id ?? '', moves,
    totals: impact([-1.8, -0.4], [-2.1, -0.6], [0.11, 0.01], 0.83, [0.9, 1.9], 2, 0.03),
    guardrails, n_scenarios: 600,
  }
}
