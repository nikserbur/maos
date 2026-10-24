/**
 * Данные панели MENTAT: источники контекста из хранилищ приложения (карта, портфель, план, касса, RL,
 * инвестпроект, прогон сравнения), статус подключения модели и история по проекту. Сами числа не
 * пересчитываются — только собираются уже полученные ответы.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type OptRunSummary } from '../../lib/api'
import { useInvestResult } from '../analytics/investStore'
import { useRlStatus } from '../agents/rlStatusStore'
import { useCashStore } from '../finance/cashStore'
import { useMethodMapState } from '../method-map/useMethodMapState'
import { useOptStore } from '../optimization/optStore'
import type { OptResultExt } from '../optimization/optTypes'
import { usePlanStore } from '../plan/planStore'
import type { BuildContextInput } from './context'
import { appendHistory, loadHistory, saveHistory, type HistoryEntry } from './llm/history'
import { mentatApi, type MentatStatus } from './llm/mentatApi'
import type { Need } from './prompts'

export type Sources = Omit<BuildContextInput, 'asked' | 'budgetTokens' | 'depth'>

export interface MentatSources {
  sources: Sources
  available: Record<Need, boolean>
  runs: readonly OptRunSummary[]
}

export function useMentatSources(compareRunId: string): MentatSources {
  const live = useMethodMapState()
  const opt = useOptStore()
  const plan = usePlanStore()
  const cash = useCashStore()
  const rl = useRlStatus()
  const invest = useInvestResult()
  const [names, setNames] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<readonly OptRunSummary[]>([])
  const [compare, setCompare] = useState<OptResultExt | null>(null)

  useEffect(() => {
    let alive = true
    api.products.list().then((ps) => { if (alive) setNames(Object.fromEntries(ps.map((p) => [p.id, p.name]))) }).catch(() => undefined)
    api.optimize.runs().then((rs) => { if (alive) setRuns(rs) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    if (!compareRunId) { setCompare(null); return undefined }
    api.optimize.run_get(compareRunId)
      .then((r) => { if (alive) setCompare(r) })
      .catch(() => { if (alive) setCompare(null) })
    return () => { alive = false }
  }, [compareRunId])

  const program = plan.result?.program
  const sources = useMemo<Sources>(() => ({
    state: live.state, scenarioName: live.scenario?.name, opt: opt.result, plan: plan.result, cash: cash.result,
    rl: rl.status, invest, compare,
    productNames: { ...names, ...Object.fromEntries((program ?? []).map((p) => [p.product_id, p.product_name])) },
  }), [live.state, live.scenario?.name, opt.result, plan.result, cash.result, rl.status, invest, compare, names, program])
  const available = useMemo<Record<Need, boolean>>(() => ({
    opt: Boolean(opt.result && !opt.result.error_soft), plan: Boolean(plan.result && !plan.result.error_soft),
    cash: Boolean(cash.result), rl: Boolean(rl.status), invest: Boolean(invest), compare: Boolean(compare),
  }), [opt.result, plan.result, cash.result, rl.status, invest, compare])
  return { sources, available, runs }
}

export type StatusLoad = 'loading' | 'ready' | 'error'

export interface MentatStatusState {
  load: StatusLoad
  status: MentatStatus | null
  error: string | null
  probing: boolean
  refresh: (probe?: boolean) => Promise<void>
  replace: (s: MentatStatus) => void
}

export function useMentatStatus(): MentatStatusState {
  const [load, setLoad] = useState<StatusLoad>('loading')
  const [status, setStatus] = useState<MentatStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const refresh = useCallback(async (probe = false) => {
    if (probe) setProbing(true)
    try {
      setStatus(await mentatApi.status(probe))
      setLoad('ready')
      setError(null)
    } catch (e) {
      setLoad('error')
      setError(e instanceof Error ? e.message : 'MENTAT-API недоступен')
    } finally {
      setProbing(false)
    }
  }, [])
  useEffect(() => { void refresh(false) }, [refresh])
  const replace = useCallback((s: MentatStatus) => { setStatus(s); setLoad('ready'); setError(null) }, [])
  return { load, status, error, probing, refresh, replace }
}

/** Имя проекта-БД (ключ истории). */
function useProject(): string {
  const [project, setProject] = useState('')
  useEffect(() => {
    let alive = true
    api.health().then((h) => { if (alive) setProject(h.project ?? 'default') }).catch(() => { if (alive) setProject('default') })
    return () => { alive = false }
  }, [])
  return project
}

export interface MentatHistory {
  entries: readonly HistoryEntry[]
  add: (e: HistoryEntry) => void
  clear: () => void
}

export function useMentatHistory(): MentatHistory {
  const project = useProject()
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([])
  useEffect(() => { if (project) setEntries(loadHistory(project)) }, [project])
  const add = useCallback((e: HistoryEntry) => {
    setEntries((prev) => {
      const next = appendHistory(prev, e)
      saveHistory(project || 'default', next)
      return next
    })
  }, [project])
  const clear = useCallback(() => { setEntries([]); saveHistory(project || 'default', []) }, [project])
  return { entries, add, clear }
}
