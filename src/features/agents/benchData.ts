/**
 * Снимки результатов стенда rl/ для экрана «Агенты»: V5 — RL на отложенных сценариях (IQM разностей,
 * бутстреп-ДИ, Уилкоксон) и V4 волны A1 (событийный режим правила — для эталонных задач). Это снимки
 * файлов `rl/results/*.json` на дату `snapshot_date` (эндпоинта для них нет): экран показывает
 * «снимок 22.10» и «устарело ▲», если есть более поздние волны. Чистые функции: типизация, строки по
 * стрессу, сводка гейта, лесной график, перепись ходов, базисные пункты.
 */
import { DASH, dateTime, num, NBSP } from '../../explain/format'
import type { ForestRow } from '../../ui/charts'
import v4raw from './data/v4_benchmarks.json'
import v5raw from './data/v5_results.json'

export interface V4Row {
  name: string
  n_jobs: number
  bks: number | null
  lb: number | null
  best_rule: string
  rule_serial: number
  rule_event: number
  ga: number
  cpsat: number
  cpsat_status: string
  cpsat_sec: number
}

export interface V4Snapshot { snapshot_date: string; source: string; cpsat_sec: number; ga_gens: number; rows: V4Row[] }

export type V5Stress = 'base' | 'crisis' | 'quantile' | 'joint'

export interface V5Comparison {
  policy: string
  vs: string
  /** IQM ΔCVaR₀.₁(Π) в долях E[Π] базовой линии. */
  iqm: number
  ci95: [number, number]
  p: number
  win: number
  d_cash_iqm: number
  d_p_breach: number
  d_makespan_h: number
  gate: boolean
}

export interface V5Snapshot {
  snapshot_date: string
  source: string
  n: number
  holdout_seed: number
  seeds: number[]
  instances: string[]
  best_rule: Record<string, string>
  champion: { policy: string; score: number; note: string }
  tables: Record<V5Stress, { regime_share: Record<string, number>; comparisons: V5Comparison[] }>
  moves: Record<string, { moves_per_episode: number; share_episodes: number; kinds: Record<string, number> }>
}

export const V4: V4Snapshot = v4raw as unknown as V4Snapshot
export const V5: V5Snapshot = v5raw as unknown as V5Snapshot

export const STRESS_LABEL: Readonly<Record<V5Stress, string>> = {
  base: 'базовый', crisis: 'кризисный режим', quantile: 'хвост 1 из 100', joint: 'совместный шок',
}

export const STRESS_HINT: Readonly<Record<V5Stress, string>> = {
  base: 'отложенные сценарии генератора как есть',
  crisis: 'режим с наибольшим разбросом ставки и курса — во всех сценариях',
  quantile: 'цены по квантилю распределения Стьюдента 0,99 — худший 1 из 100',
  joint: 'задержки поставок ×2 и дефолт крупнейшего покупателя (потери 45 %)',
}

/** Против чего сравнивать претендентов (базовые линии снимка V5). */
export const BASELINE_LABEL: Readonly<Record<string, string>> = { best_rule: 'лучшее правило', GA: 'ГА', EDD: 'EDD' }

/** Относительный разрыв к эталону: (x − ref) / ref; null без эталона. */
export function gap(x: number, ref: number | null | undefined): number | null {
  if (ref === null || ref === undefined || !Number.isFinite(ref) || ref <= 0 || !Number.isFinite(x)) return null
  return (x - ref) / ref
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Строки V5 для стресса: только против базовой линии `vs` (по умолчанию — лучшее правило). */
export function v5Rows(snap: V5Snapshot, stress: V5Stress, vs = 'best_rule'): V5Comparison[] {
  return (snap.tables[stress]?.comparisons ?? []).filter((c) => c.vs === vs)
}

/** Только претенденты RL (без ГА — это базовая линия, а не обученная политика). */
export function candidateRows(snap: V5Snapshot, stress: V5Stress, vs = 'best_rule'): V5Comparison[] {
  return v5Rows(snap, stress, vs).filter((c) => c.policy !== 'GA')
}

/** ДИ целиком выше нуля / ниже нуля / содержит ноль. */
export type CiVerdict = 'above' | 'below' | 'straddles'

export function ciVerdict(ci: readonly [number, number]): CiVerdict {
  if (ci[0] > 0) return 'above'
  if (ci[1] < 0) return 'below'
  return 'straddles'
}

export interface GateSummary {
  /** Политик-претендентов (без ГА). */
  candidates: number
  passed: number
  /** Лучший претендент по IQM против лучшего правила (базовые сценарии). */
  best: V5Comparison | null
  champion: string
}

export function gateSummary(snap: V5Snapshot): GateSummary {
  const rows = candidateRows(snap, 'base')
  const best = rows.reduce<V5Comparison | null>((b, c) => (!b || c.iqm > b.iqm ? c : b), null)
  return { candidates: rows.length, passed: rows.filter((c) => c.gate).length, best, champion: snap.champion.policy }
}

/** «L0_seed2» → «L0 · сид 2», «L2_edd_seed1» → «L2 поверх EDD · сид 1». */
export function policyLabel(p: string): string {
  const m = /^(L0|L2)(_edd)?_seed(\d+)$/.exec(p)
  if (!m) return p === 'GA' ? 'ГА по ключам' : p
  return `${m[1]}${m[2] ? ' поверх EDD' : ''} · сид ${m[3]}`
}

/** Ходов за эпизод у политики L2 (null — у L0 структурных ходов нет). */
export function movesPerEpisode(snap: V5Snapshot, policy: string): number | null {
  const m = snap.moves[policy]
  return m ? m.moves_per_episode : null
}

/** Политика L2 с нулём ходов совпадает со своей базовой эвристикой (EDD). */
export function isIdle(snap: V5Snapshot, policy: string): boolean {
  return movesPerEpisode(snap, policy) === 0
}

/** Подпись претендента с пометкой «совпал с EDD» для политики без ходов. */
export function candidateLabel(snap: V5Snapshot, policy: string): string {
  return isIdle(snap, policy) ? `${policyLabel(policy)} — 0 ходов, совпал с EDD` : policyLabel(policy)
}

/** «лучше в 5 из 12»: доля выигрышных экземпляров → целое число из числа экземпляров. */
export function winCount(snap: V5Snapshot, win: number): number {
  return Math.round(win * snap.instances.length)
}

/* ── Базисные пункты ─────────────────────────────────────────────────────── */

const BP = 10_000

/** Доля → б. п. с одним знаком до 10 б. п. (разности RL — доли базисного пункта): «−0,4 б. п.», «+0,1 б. п.». */
export function bpFine(v: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const x = v * BP
  const text = num(x, Math.abs(x) < 10 ? 1 : 0)
  const sign = opts.signed && x > 0 && /[1-9]/.test(text) ? '+' : ''
  return `${sign}${text}${NBSP}б.${NBSP}п.`
}

/** Число без единицы для ДИ в скобках: «−0,4», «+0,1». */
export function bpNum(v: number): string {
  const x = v * BP
  const text = num(x, Math.abs(x) < 10 ? 1 : 0)
  return x > 0 && /[1-9]/.test(text) ? `+${text}` : text
}

/** Точечная оценка: «≈ 0 б. п.», если по модулю меньше половины базисного пункта. */
export function bpApprox(v: number): string {
  return Math.abs(v * BP) < 0.5 ? `≈${NBSP}0${NBSP}б.${NBSP}п.` : bpFine(v, { signed: true })
}

/** Точечная оценка без единицы для ячеек таблицы: «≈ 0», «−6,1». */
export function bpPoint(v: number): string {
  return Math.abs(v * BP) < 0.5 ? `≈${NBSP}0` : bpNum(v)
}

/** «[−0,4; +0,1]» — ДИ в базисных пунктах. */
export function bpCi(ci: readonly [number, number]): string {
  return `[${bpNum(ci[0])}; ${bpNum(ci[1])}]`
}

/* ── Лесной график и общая шкала ─────────────────────────────────────────── */

/** Строки лесного графика (в б. п.): претенденты RL к базовой линии. */
export function v5Forest(snap: V5Snapshot, stress: V5Stress = 'base', vs = 'best_rule'): ForestRow[] {
  return candidateRows(snap, stress, vs).map((c) => ({
    key: c.policy, label: candidateLabel(snap, c.policy),
    delta: c.iqm * BP, lo: c.ci95[0] * BP, hi: c.ci95[1] * BP, share: c.win,
  }))
}

/** Общая шкала строк (в долях): от минимума ДИ до максимума, ноль внутри. */
export function ciDomain(rows: ReadonlyArray<{ ci95: readonly [number, number] }>): [number, number] {
  const lo = Math.min(0, ...rows.map((r) => r.ci95[0]))
  const hi = Math.max(0, ...rows.map((r) => r.ci95[1]))
  const pad = (hi - lo) * 0.04 || 1e-5
  return [lo - pad, hi + pad]
}

/** ΔP(кассового разрыва) нулевая у всех строк снимка — тогда она уходит в сноску. */
export function breachAllZero(snap: V5Snapshot): boolean {
  return Object.values(snap.tables).every((t) => t.comparisons.every((c) => c.d_p_breach === 0))
}

/* ── Перепись ходов L2 ───────────────────────────────────────────────────── */

export interface MoveCount { kind: string; n: number }

/** Сколько ходов какого вида сделал L2 (сумма по сидам), по убыванию; плюс сиды без единого хода. */
export function movesCensus(snap: V5Snapshot): { kinds: MoveCount[]; idleSeeds: number[] } {
  const acc = new Map<string, number>()
  for (const m of Object.values(snap.moves)) for (const [k, n] of Object.entries(m.kinds)) acc.set(k, (acc.get(k) ?? 0) + n)
  const kinds = [...acc.entries()].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n)
  const idleSeeds = Object.keys(snap.moves).filter((p) => isIdle(snap, p)).map((p) => Number(/seed(\d+)$/.exec(p)?.[1] ?? NaN)).filter(Number.isFinite)
  return { kinds, idleSeeds }
}

/* ── Снимки и их свежесть ────────────────────────────────────────────────── */

/** «22.10» — день и месяц снимка. */
export function snapDay(iso: string): string {
  return dateTime(iso, { time: false }).slice(0, 5)
}
