/**
 * Живое состояние карты для текущего контекста: справочники (счётчики), активный
 * сценарий, последние результаты Стадии 2 / Стадии 1 из их хранилищ → `deriveState()`.
 * Справочники кэшируются на уровне модуля (TTL), чтобы полоса методологии на каждом
 * экране не перезапрашивала их; `refresh()` — принудительно. Бэкенда не требует:
 * при сбое запроса карта работает по тому, что уже знает.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { api, type KpiBundle, type MacroSummary, type PriceScenario, type WorkCalendar } from '../../lib/api'
import { useCashStore } from '../finance/cashStore'
import { usePassport } from '../passport/passportStore'
import { getDecisionContext, useDecisionContext } from '../../shell/context'
import { useOptStore } from '../optimization/optStore'
import { usePlanStore } from '../plan/planStore'
import { useRlStatus } from '../agents/rlStatusStore'
import { useGuardrails } from '../agents/guardrailsStore'
import { EMPTY_COUNTS, type DeriveInput, type RefCounts } from './deriveInput'
import { deriveState } from './deriveState'
import type { MethodMapState } from './types'

export type RefsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RefsState {
  status: RefsStatus
  counts: RefCounts
  scenarios: readonly PriceScenario[]
  /** Полные сценарии (с распределениями) по id. */
  full: Readonly<Record<string, PriceScenario>>
  calendar: WorkCalendar | null
  kpi: KpiBundle | null
  /** Волна M: сводка обученного макро-генератора (режимы, CRPS, покрытие). */
  macro: MacroSummary | null
  loadedAt: number | null
  error: string | null
}

const TTL_MS = 60_000

let refs: RefsState = { status: 'idle', counts: EMPTY_COUNTS, scenarios: [], full: {}, calendar: null, kpi: null, macro: null, loadedAt: null, error: null }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(next: RefsState): void {
  refs = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): RefsState => refs

const has = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== '' && Number(v) > 0

async function fetchRefs(): Promise<void> {
  const [products, machines, wcTypes, workers, routings, operations, scenarios, calendar, kpi, macro] = await Promise.allSettled([
    api.products.list(), api.machines.list(), api.workCenterTypes.list(), api.workers.list(),
    api.routings.list(), api.operations.list(), api.scenarios.list(), api.calendar.get(), api.analytics.kpi(), api.macro.summary(),
  ])
  const ok = <T,>(r: PromiseSettledResult<T>, fallback: T): T => (r.status === 'fulfilled' ? r.value : fallback)
  const failed = [products, machines, wcTypes, workers, routings, operations, scenarios].filter((r) => r.status === 'rejected')
  const pr = ok(products, [])
  const wc = ok(wcTypes, [])
  const counts: RefCounts = {
    products: pr.length,
    sellable: pr.filter((p) => p.sellable === '1').length,
    purchased: pr.filter((p) => p.purchased === '1').length,
    machines: ok(machines, []).length,
    wcTypes: wc.length,
    wcTypesWithMtbf: wc.filter((t) => has(t.mtbf_hours)).length,
    workers: ok(workers, []).length,
    routings: ok(routings, []).length,
    operations: ok(operations, []).length,
    scenarios: ok(scenarios, []).length,
  }
  emit({
    ...refs,
    status: failed.length === 7 ? 'error' : 'ready',
    error: failed.length === 7 ? 'нет связи с сервером — состояние по последним ответам' : null,
    counts,
    scenarios: ok(scenarios, []),
    calendar: ok(calendar, null as WorkCalendar | null),
    kpi: ok(kpi, null as KpiBundle | null),
    macro: ok(macro, null as MacroSummary | null),
    loadedAt: Date.now(),
  })
}

/** Загрузить справочники, если кэш пуст или старше TTL. */
export function ensureRefs(force = false): Promise<void> {
  if (inflight) return inflight
  const fresh = refs.loadedAt !== null && Date.now() - refs.loadedAt < TTL_MS
  if (fresh && !force) return Promise.resolve()
  emit({ ...refs, status: refs.loadedAt === null ? 'loading' : refs.status })
  inflight = fetchRefs()
    .catch(() => emit({ ...refs, status: 'error', error: 'нет связи с сервером' }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Полный сценарий (с распределениями) — по требованию, один раз на id. */
function ensureScenario(id: string): void {
  if (!id || refs.full[id]) return
  api.scenarios.get(id)
    .then((sc) => emit({ ...refs, full: { ...refs.full, [sc.id]: sc } }))
    .catch(() => {
      const listed = refs.scenarios.find((s) => s.id === id)
      if (listed) emit({ ...refs, full: { ...refs.full, [id]: listed } })
    })
}

/** Сбросить кэш полного сценария (после правки на экране «Сценарии»). */
export function invalidateScenario(id: string): void {
  if (!refs.full[id]) return
  const { [id]: _dropped, ...rest } = refs.full
  emit({ ...refs, full: rest })
}

export function useRefs(): RefsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Активный сценарий: контекст решения → форма «Оптимизации» → последний портфель → первый в списке. */
export function resolveScenarioId(refsState: RefsState, formScenarioId: string, resultScenarioId?: string): string {
  const ctx = getDecisionContext().scenarioId
  const known = (id?: string) => (id && refsState.scenarios.some((s) => s.id === id) ? id : undefined)
  return known(ctx) ?? known(formScenarioId) ?? known(resultScenarioId) ?? refsState.scenarios[0]?.id ?? ''
}

export interface MethodMapLive {
  state: MethodMapState
  refs: RefsState
  scenario: PriceScenario | null
  scenarioId: string
  refresh: () => void
}

export function useMethodMapState(): MethodMapLive {
  const refsState = useRefs()
  const context = useDecisionContext()
  const opt = useOptStore()
  const plan = usePlanStore()
  const cash = useCashStore()
  const passport = usePassport()
  const rl = useRlStatus()
  const guard = useGuardrails()

  useEffect(() => {
    void ensureRefs()
  }, [])

  const scenarioId = resolveScenarioId(refsState, opt.form.scenarioId, opt.result?.scenario_id)
  useEffect(() => {
    ensureScenario(scenarioId)
  }, [scenarioId])

  const scenario = refsState.full[scenarioId] ?? refsState.scenarios.find((s) => s.id === scenarioId) ?? null

  const state = useMemo(() => {
    const input: DeriveInput = {
      context: { ...context, scenarioId: scenarioId || undefined, portfolioRunId: context.portfolioRunId ?? opt.result?.run_id },
      scenario,
      counts: refsState.counts,
      calendar: refsState.calendar,
      opt: { result: opt.result, ranAt: opt.ranAt, running: opt.running, form: opt.form },
      plan: { result: plan.result, builtAt: plan.builtAt, running: plan.running, params: plan.params },
      kpi: refsState.kpi,
      forecast: null,
      passport: passport.status === 'ready' ? passport.byCode : null,
      fin: passport.fin,
      macro: refsState.macro,
      cash: { result: cash.result, ranAt: cash.ranAt, running: cash.running },
      rl: rl.status ?? undefined,
      guardrails: guard.loaded ? guard.value : undefined,
      now: Date.now(),
    }
    return deriveState(input)
  }, [context, scenarioId, scenario, refsState.counts, refsState.calendar, refsState.kpi, refsState.macro, opt, plan, cash, passport, rl.status, guard])

  return { state, refs: refsState, scenario, scenarioId, refresh: () => void ensureRefs(true) }
}
