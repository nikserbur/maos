/**
 * V4 волны A2 — детерминированное расписание: лучшее правило, структурный ГА, ГА с тёплым стартом
 * CP-SAT и CP-SAT в продукте против лучшего известного решения (BKS). Снимок `rl/results/v4_a2.json`
 * (data/v4_a2.json): эталонные задачи — в единицах эталона (минуты), экземпляры MAOS — F = Cmax +
 * 0,5·Σ просрочки, ч; для MAOS BKS нет, разрыв — к лучшему из четырёх методов. Событийный режим
 * правила берётся из снимка A1 только для эталонных задач (они не менялись).
 */
import { V4 as V4A1, gap, median } from './benchData'
import v4a2raw from './data/v4_a2.json'

export interface V4A2Row {
  name: string
  n_jobs: number
  bks: number | null
  best_rule: string
  rule: number
  ga: number
  ga_warm: number
  cpsat: number
  cpsat_status: string
  cpsat_sec: number
}

export interface V4A2Snapshot { snapshot_date: string; source: string; cpsat_sec: number; ga_sec: number; rows: V4A2Row[] }

export const V4A2: V4A2Snapshot = v4a2raw as unknown as V4A2Snapshot

/** Семейство экземпляра: Taillard 15×15, Brandimarte FJSP, экземпляры MAOS из демо-БД. */
export type BenchFamily = 'taillard' | 'brandimarte' | 'maos'

export const FAMILIES: readonly BenchFamily[] = ['taillard', 'brandimarte', 'maos']

export function familyOf(name: string): BenchFamily {
  if (name.startsWith('ta')) return 'taillard'
  if (name.startsWith('mk')) return 'brandimarte'
  return 'maos'
}

export const FAMILY_LABEL: Readonly<Record<BenchFamily, string>> = {
  taillard: 'Taillard 15×15', brandimarte: 'Brandimarte', maos: 'Экземпляры MAOS',
}

/** Что сравнивается в семействе (подпись группы таблицы и панели графика). */
export const FAMILY_NOTE: Readonly<Record<BenchFamily, string>> = {
  taillard: 'Cmax в единицах эталона · разрыв к BKS',
  brandimarte: 'Cmax в единицах эталона · разрыв к BKS',
  maos: 'F = Cmax + 0,5·Σ просрочки, ч · разрыв к лучшему найденному',
}

export type V4Method = 'rule' | 'ga' | 'ga_warm' | 'cpsat'

export const METHODS: readonly V4Method[] = ['rule', 'ga', 'ga_warm', 'cpsat']

export const METHOD_LABEL: Readonly<Record<V4Method, string>> = {
  rule: 'Правило', ga: 'Генетический алгоритм', ga_warm: 'Генетический со стартом от CP-SAT', cpsat: 'CP-SAT',
}

/** Эталон строки: BKS, иначе лучшее из четырёх методов. */
export function refOf(r: V4A2Row): number {
  return r.bks ?? Math.min(r.rule, r.ga, r.ga_warm, r.cpsat)
}

export function gapOf(r: V4A2Row, m: V4Method): number | null {
  return gap(r[m], refOf(r))
}

/** Событийный режим правила из снимка A1 — только для эталонных задач. */
export function ruleEvent(r: V4A2Row): number | null {
  if (familyOf(r.name) === 'maos') return null
  return V4A1.rows.find((a) => a.name === r.name)?.rule_event ?? null
}

/** Допуск «= BKS»: разрыв до 0,1 % (одна единица времени на задаче ~1 200). */
export const AT_BKS_TOL = 0.001

export interface V4Summary {
  /** Эталонных задач, где CP-SAT достиг BKS (с допуском). */
  cpsatAtBks: number
  /** Из них — ровно BKS. */
  cpsatExact: number
  withBks: number
  /** Сколько раз CP-SAT доказал оптимум. */
  optimal: number
}

export function summarizeA2(rows: readonly V4A2Row[]): V4Summary {
  const bench = rows.filter((r) => r.bks !== null)
  const g = (r: V4A2Row) => gapOf(r, 'cpsat') ?? Number.POSITIVE_INFINITY
  return {
    cpsatAtBks: bench.filter((r) => g(r) <= AT_BKS_TOL).length,
    cpsatExact: bench.filter((r) => g(r) <= 0).length,
    withBks: bench.length,
    optimal: bench.filter((r) => r.cpsat_status === 'OPTIMAL').length,
  }
}

export interface FamilyMedians {
  family: BenchFamily
  n: number
  /** Медиана разрыва каждого метода, по возрастанию (лучший — первым). */
  methods: Array<{ method: V4Method; median: number }>
}

export function familyMedians(rows: readonly V4A2Row[]): FamilyMedians[] {
  return FAMILIES.map((family) => {
    const fr = rows.filter((r) => familyOf(r.name) === family)
    const methods = METHODS.map((method) => ({
      method, median: median(fr.map((r) => gapOf(r, method)).filter((x): x is number => x !== null)),
    })).sort((a, b) => a.median - b.median)
    return { family, n: fr.length, methods }
  }).filter((f) => f.n > 0)
}

/** Общая шкала панелей: максимум медиан, округлённый вверх до 10 %. */
export function sharedMax(fams: readonly FamilyMedians[]): number {
  const m = Math.max(0, ...fams.flatMap((f) => f.methods.map((x) => x.median)).filter(Number.isFinite))
  return Math.max(0.1, Math.ceil(m * 10) / 10)
}

/** Диапазон медиан правила на эталонных задачах — для заголовка «правила отстают на 37–56 %». */
export function ruleLagRange(fams: readonly FamilyMedians[]): [number, number] | null {
  const xs = fams.filter((f) => f.family !== 'maos').map((f) => f.methods.find((m) => m.method === 'rule')?.median ?? Number.NaN).filter(Number.isFinite)
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null
}
