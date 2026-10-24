/**
 * Паспорт прогона Стадии 1 на этой машине (X2 «повторить любой прогон»): по адресу результата
 * (plan_id или local-…) храним правило, источник программы, сценарий и параметры мастера, с которыми
 * прогон строился. Бэкенд хранит только KPI прогона (kpi_series), поэтому «Повторить» и подпись
 * «Правило · Источник» в истории берутся отсюда; для чужих прогонов — честное «—».
 * Лёгкие записи (без Ганта) — держим больше, чем полных результатов в planStore. Чистые функции.
 */
import type { StorageLike } from './planStore'
import type { Crit } from './types'
import type { ProgramSource, RiskPreset, WizardFields, WizardOrder, WizardState } from './wizard/wizardStore'

/** Параметры мастера, достаточные, чтобы открыть тот же прогон на шаге «Запуск». */
export interface RunParams {
  source: ProgramSource
  runId: string
  planId: string
  scenarioId: string
  manualOrders: WizardOrder[]
  overrides: Partial<WizardFields>
  preset: RiskPreset
  crits: Crit[]
  startDate: string | null
}

export interface RunMeta {
  key: string
  /** Правило бэкенда (EDD, CR, RL…) и принят ли ГА. */
  rule: string
  adopted: boolean
  source: ProgramSource
  scenarioId: string
  scenarioName: string
  builtAt: number
  params: RunParams
}

export const RUN_META_KEY = 'maos.plan.runmeta'
export const RUN_META_MAX = 80

const SOURCES: readonly ProgramSource[] = ['portfolio', 'orders', 'manual']

const isMeta = (x: unknown): x is RunMeta => {
  if (!x || typeof x !== 'object') return false
  const m = x as Partial<RunMeta>
  return typeof m.key === 'string' && typeof m.rule === 'string' && typeof m.builtAt === 'number'
    && SOURCES.includes(m.source as ProgramSource) && !!m.params && typeof m.params === 'object'
}

/** Снимок мастера для паспорта прогона (без унаследованной базы — она выводится заново). */
export function snapshotOf(w: Pick<WizardState, 'source' | 'runId' | 'planId' | 'scenarioId' | 'manualOrders' | 'overrides' | 'preset' | 'crits' | 'startDate'>): RunParams {
  return {
    source: w.source, runId: w.runId, planId: w.planId, scenarioId: w.scenarioId,
    manualOrders: [...w.manualOrders], overrides: { ...w.overrides }, preset: w.preset, crits: [...w.crits], startDate: w.startDate,
  }
}

/** Все паспорта, новые первыми; битый JSON — пусто. */
export function readRunMeta(storage: StorageLike | null | undefined): RunMeta[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(RUN_META_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isMeta) : []
  } catch {
    return []
  }
}

/** Добавить паспорт в начало (дубликат по ключу заменяется), не больше `max`. */
export function writeRunMeta(storage: StorageLike | null | undefined, entry: RunMeta, max = RUN_META_MAX): RunMeta[] {
  const next = [entry, ...readRunMeta(storage).filter((m) => m.key !== entry.key)].slice(0, max)
  if (!storage) return next
  try {
    storage.setItem(RUN_META_KEY, JSON.stringify(next))
  } catch {
    // квота: паспорт — удобство, без него «Повторить» откроет мастер с текущими значениями
    return readRunMeta(storage)
  }
  return next
}

export function runMetaMap(storage: StorageLike | null | undefined): ReadonlyMap<string, RunMeta> {
  return new Map(readRunMeta(storage).map((m) => [m.key, m]))
}

export const browserStorage = (): StorageLike | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}
