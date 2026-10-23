/**
 * Снимки результатов стенда rl/ (волна A, A1 §3 и §5) для экрана «Агенты»: V4 — расписание
 * «правила / ГА / CP-SAT против BKS и нижней границы», V5 — структурный RL на отложенных
 * сценариях с IQM, бутстреп-ДИ и Уилкоксоном. Это снимок файлов `rl/results/*.json` на дату
 * `snapshot_date` (эндпоинта для них нет) — экран показывает бейдж «снимок от …».
 * Чистые функции: типизация, разрывы, выбор строк по стрессу, сводка гейта.
 */
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
  base: 'базовый', crisis: 'кризисный режим', quantile: 'квантиль t (q = 0,99)', joint: 'совместный шок',
}

export const STRESS_HINT: Readonly<Record<V5Stress, string>> = {
  base: 'holdout-сценарии генератора как есть',
  crisis: 'режим HMM с максимальной дисперсией ставки и курса с вероятностью 1',
  quantile: 'квантильный Student-t на 0,99',
  joint: 'задержки поставок ×2 и дефолт крупнейшего покупателя (LGD 0,45)',
}

/** Семейство экземпляра: Taillard 15×15, Brandimarte FJSP, экземпляры MAOS из демо-БД. */
export type BenchFamily = 'taillard' | 'brandimarte' | 'maos'

export function familyOf(name: string): BenchFamily {
  if (name.startsWith('ta')) return 'taillard'
  if (name.startsWith('mk')) return 'brandimarte'
  return 'maos'
}

export const FAMILY_LABEL: Readonly<Record<BenchFamily, string>> = {
  taillard: 'Taillard 15×15 (JSSP)', brandimarte: 'Brandimarte (FJSP)', maos: 'MAOS · демо-БД (CP-SAT — релаксация)',
}

/** Относительный разрыв к эталону: (x − ref) / ref; null без эталона. */
export function gap(x: number, ref: number | null | undefined): number | null {
  if (ref === null || ref === undefined || !Number.isFinite(ref) || ref <= 0 || !Number.isFinite(x)) return null
  return (x - ref) / ref
}

/** Эталон строки: BKS, если известен, иначе лучшее найденное CP-SAT (на MAOS — нижняя оценка релаксации). */
export function referenceOf(r: V4Row): number {
  return r.bks ?? r.cpsat
}

export interface V4Summary {
  /** Экземпляров, где CP-SAT достиг BKS. */
  cpsatAtBks: number
  withBks: number
  /** Медианы разрывов к эталону: лучшее правило (серийно), событийный режим, ГА. */
  medRule: number
  medEvent: number
  medGa: number
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function summarizeV4(rows: readonly V4Row[]): V4Summary {
  const withBks = rows.filter((r) => r.bks !== null)
  const gaps = (pick: (r: V4Row) => number) => rows.map((r) => gap(pick(r), referenceOf(r))).filter((g): g is number => g !== null)
  return {
    cpsatAtBks: withBks.filter((r) => r.bks !== null && r.cpsat <= r.bks).length,
    withBks: withBks.length,
    medRule: median(gaps((r) => r.rule_serial)),
    medEvent: median(gaps((r) => r.rule_event)),
    medGa: median(gaps((r) => r.ga)),
  }
}

/** Строки V5 для стресса: только против базовой линии `vs` (по умолчанию — чемпион best_rule). */
export function v5Rows(snap: V5Snapshot, stress: V5Stress, vs = 'best_rule'): V5Comparison[] {
  return (snap.tables[stress]?.comparisons ?? []).filter((c) => c.vs === vs)
}

/** ДИ целиком выше нуля / ниже нуля / содержит ноль — словами для таблицы. */
export type CiVerdict = 'above' | 'below' | 'straddles'

export function ciVerdict(ci: readonly [number, number]): CiVerdict {
  if (ci[0] > 0) return 'above'
  if (ci[1] < 0) return 'below'
  return 'straddles'
}

export interface GateSummary {
  /** Политик-претендентов (без GA). */
  candidates: number
  passed: number
  /** Лучший претендент по IQM против чемпиона (базовые сценарии). */
  best: V5Comparison | null
  champion: string
}

export function gateSummary(snap: V5Snapshot): GateSummary {
  const rows = v5Rows(snap, 'base').filter((c) => c.policy !== 'GA')
  const best = rows.reduce<V5Comparison | null>((b, c) => (!b || c.iqm > b.iqm ? c : b), null)
  return { candidates: rows.length, passed: rows.filter((c) => c.gate).length, best, champion: snap.champion.policy }
}

/** «L0_seed2» → «L0 · сид 2», «L2_edd_seed1» → «L2 поверх EDD · сид 1». */
export function policyLabel(p: string): string {
  const m = /^(L0|L2)(_edd)?_seed(\d+)$/.exec(p)
  if (!m) return p === 'GA' ? 'ГА по ключам' : p
  return `${m[1]}${m[2] ? ' поверх EDD' : ''} · сид ${m[3]}`
}
