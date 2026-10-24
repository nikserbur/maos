/**
 * Текущая история RL одним источником (протокол «RL → эвристика»): гейт A3 (живой из
 * `GET /api/rl/status → gate_a3` — то же поле, что читает MENTAT; без сервера — снимок), строгий
 * чемпион A4 (C* — лучшая неучащаяся политика на 49 из 60 экземпляров, holdout не завершён) и
 * реестр правил, найденных RL: что найдено, откуда, эффект с ДИ, как проверено, что стало в продукте.
 * Снимок — data/a4_summary.json из `rl/results/a3`, `rl/results/a4` (новых прогонов RL нет).
 */
import type { RlGateA3 } from '../../lib/api'
import { NBSP, pct } from '../../explain/format'
import a4raw from './data/a4_summary.json'

export interface A3Snapshot {
  n_instances: number
  seeds: number
  seeds_converged: number
  gate_pass: boolean
  gate_g1: boolean
  gate_g2_prereg: boolean
  vs_best_rule: { iqm: number; ci95: [number, number]; p: number; win_share: number }
  vs_champion: { iqm: number; ci95: [number, number] }
  vs_strict: { iqm: number; ci95: [number, number]; p: number }
  candidate_overtime: { variant: string; seed: number; deviations: Array<{ instance: string; d_pct_v: number }> }
  units: string
}

export interface A4Snapshot {
  n_instances: number
  holdout_complete: boolean
  champion_counts: Record<string, number>
  mean_vs_rule_pct_v: Record<string, number>
  variants: Array<{ id: string; decisions_m: number; val_lo: number; val_hi: number }>
  distill: Record<string, { n_states: number; n_deviation_states: number; adv_mean_pct_v: number; adv_pos_share: number }>
}

export interface A4Summary { snapshot_date: string; source: string; a3: A3Snapshot; a4: A4Snapshot }

export const A4S: A4Summary = a4raw as unknown as A4Summary

/** Имена политик пула чемпиона — по-русски, без внутренних id. */
export const POOL_LABEL: Readonly<Record<string, string>> = {
  'C*': 'C* — эвристика + казначейское правило',
  best_rule: 'лучшее правило',
  'LA*': 'просмотр последствий ходов',
  GA: 'генетический алгоритм со стартом от CP-SAT',
  CPSAT: 'CP-SAT',
}

export const poolLabel = (id: string): string => POOL_LABEL[id] ?? id

/** «+1,46 %» — проценты стоимости портфеля (значение уже в процентах). */
export function pctV(v: number, digits = 2): string {
  const t = pct(v / 100, digits)
  return v > 0 && /[1-9]/.test(t) ? `+${t}` : t
}

/** «[+1,01; +1,92] %» — ДИ в процентах стоимости портфеля. */
export function pctVci(ci: readonly [number, number], digits = 2): string {
  const strip = (s: string) => s.replace(`${NBSP}%`, '')
  return `[${strip(pctV(ci[0], digits))}; ${strip(pctV(ci[1], digits))}]${NBSP}%`
}

/* ── Гейт: живой или снимок ──────────────────────────────────────────────── */

export interface GateView {
  pass: boolean
  g1: boolean
  /** ДИ выигрыша RL к лучшему правилу, % V. */
  ruleCi: [number, number]
  /** ДИ к строгому контролю «эвристика + казначейское правило», % V. */
  strictCi: [number, number]
  source: 'live' | 'snapshot'
}

/** Тот же вердикт, что у MENTAT (facts.ts → gate_a3); без сервера — снимок a4_summary.json. */
export function gateView(live: RlGateA3 | null | undefined, snap: A3Snapshot = A4S.a3): GateView {
  if (live) {
    return {
      pass: live.gate_pass, g1: live.gate_g1,
      ruleCi: live.ci95_vs_best_rule ?? snap.vs_best_rule.ci95,
      strictCi: live.ci95_vs_champion_plus ?? snap.vs_strict.ci95,
      source: 'live',
    }
  }
  return { pass: snap.gate_pass, g1: snap.gate_g1, ruleCi: snap.vs_best_rule.ci95, strictCi: snap.vs_strict.ci95, source: 'snapshot' }
}

/** Строгий контроль «≈ 0»: ДИ к «эвристика + казначейское правило» не дальше 0,05 % от нуля. */
export function strictNearZero(g: GateView): boolean {
  return Math.abs(g.strictCi[0]) <= 0.05 && Math.abs(g.strictCi[1]) <= 0.05
}

/* ── Чемпион A4 ──────────────────────────────────────────────────────────── */

export interface ChampionShare { id: string; n: number; of: number }

/** Чемпион по числу экземпляров (C* — 49 из 60) и вся раскладка пула по убыванию. */
export function championShares(a4: A4Snapshot = A4S.a4): ChampionShare[] {
  return Object.entries(a4.champion_counts).map(([id, n]) => ({ id, n, of: a4.n_instances })).sort((a, b) => b.n - a.n)
}

/* ── Кандидат «сверхурочные вместо станка» ───────────────────────────────── */

export interface Candidate { n: number; of: number; better: number; lo: number; hi: number }

export function overtimeCandidate(a3: A3Snapshot = A4S.a3): Candidate {
  const d = a3.candidate_overtime.deviations.map((x) => x.d_pct_v)
  return { n: d.length, of: a3.n_instances, better: d.filter((x) => x > 0).length, lo: Math.min(...d), hi: Math.max(...d) }
}

/* ── Реестр правил, найденных RL ─────────────────────────────────────────── */

export interface LedgerRow {
  id: string
  rule: string
  origin: string
  effect: string
  effectNote: string
  check: { text: string; kind: 'derived' | 'candidate' }
  status: { text: string; code?: string; href?: string }
}

export function ledgerRows(g: GateView, a3: A3Snapshot = A4S.a3): LedgerRow[] {
  const c = overtimeCandidate(a3)
  const wins = Math.round(a3.vs_best_rule.win_share * a3.n_instances)
  const strict = strictNearZero(g) ? '≈ 0' : pctVci(g.strictCi)
  return [
    {
      id: 'auto_repay',
      rule: 'Излишек кассы сверх буфера гасит кредитную линию — каждую неделю',
      origin: a3.seeds_converged === a3.seeds
        ? `волна A3 · результаты всех ${a3.seeds} запусков совпали`
        : `волна A3 · совпали результаты ${a3.seeds_converged} запусков из ${a3.seeds}`,
      effect: `${pctV(a3.vs_best_rule.iqm)} ${pctVci(g.ruleCi).replace(`${NBSP}%`, '')}`,
      effectNote: `лучше в ${wins} из ${a3.n_instances}`,
      check: { text: `выведено RL · первая проверка ${g.g1 ? '✓' : '✕'} · строгий контроль ${strict}`, kind: 'derived' },
      // Ключ настройки — в подсказке ссылки, не в тексте ячейки.
      status: { text: 'включено по умолчанию: «Гасить кредитную линию излишком кассы»', code: 'fin.auto_repay [НОРМ]', href: '#/map/int.finance' },
    },
    {
      id: 'overtime',
      rule: 'Сверхурочные вместо покупки станка в неделю 0',
      origin: `волна A3 · вариант ${a3.candidate_overtime.variant}, запуск ${a3.candidate_overtime.seed}`,
      effect: `от ${pctV(c.lo)} до ${pctV(c.hi)}`,
      effectNote: `отличается в ${c.n} из ${c.of} · лучше в ${c.better} из ${c.n} · ДИ не заявлен`,
      check: { text: 'кандидат · не проверено', kind: 'candidate' },
      status: { text: 'не в продукте — нужно условие применения и отдельный гейт' },
    },
  ]
}
