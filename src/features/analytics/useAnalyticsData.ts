/**
 * Данные «Аналитики»: справочники (станки, рабочие, типы РЦ) и список построений один раз; по
 * выбранному построению — результаты симуляции, KPI-блок и (для «Потоков») лента операций.
 * Состояния честные (X2): загрузка, ошибка с повтором и «нет данных» различаются — сбой сервера
 * не превращается в «Планов ещё нет».
 */
import { useCallback, useEffect, useState } from 'react'
import {
  api, type KpiBundle, type Machine, type SimPlan, type SimPlanSummary, type SimResults, type WorkCenterType, type Worker,
} from '../../lib/api'

export interface AnalyticsRefs {
  machines: Machine[]
  workers: Worker[]
  wcTypes: WorkCenterType[]
}

export interface AnalyticsData extends AnalyticsRefs {
  /** Построение, которое показывает экран: из адреса, иначе последнее; '' — построений нет. */
  planId: string
  /** Справочники и список построений ещё грузятся. */
  loading: boolean
  plans: SimPlanSummary[]
  /** Список построений не прочитан — ошибка, а не «планов нет». */
  plansError: unknown
  /** Какой-то справочник не прочитан — узкие места и потоки неполны. */
  refsError: unknown
  retry: () => void
  res: SimResults | null
  bundle: KpiBundle | null
  /** KPI и результаты выбранного построения ещё грузятся. */
  planLoading: boolean
  planError: unknown
  flowPlan: SimPlan | null
  flowLoading: boolean
}

const EMPTY_REFS: AnalyticsRefs = { machines: [], workers: [], wcTypes: [] }

export function useAnalyticsData(explicitPlanId: string | null, wantFlow: boolean): AnalyticsData {
  const [refs, setRefs] = useState<AnalyticsRefs>(EMPTY_REFS)
  const [plans, setPlans] = useState<SimPlanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [plansError, setPlansError] = useState<unknown>(null)
  const [refsError, setRefsError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [res, setRes] = useState<SimResults | null>(null)
  const [bundle, setBundle] = useState<KpiBundle | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<unknown>(null)
  const [flowPlan, setFlowPlan] = useState<SimPlan | null>(null)
  const [flowLoading, setFlowLoading] = useState(false)
  const planId = explicitPlanId || plans[0]?.id || ''

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.allSettled([api.machines.list(), api.workers.list(), api.workCenterTypes.list(), api.simulation.plans()])
      .then(([m, w, t, pl]) => {
        if (!alive) return
        setRefs({
          machines: m.status === 'fulfilled' ? m.value : [],
          workers: w.status === 'fulfilled' ? w.value : [],
          wcTypes: t.status === 'fulfilled' ? t.value : [],
        })
        const refFail = [m, w, t].find((r): r is PromiseRejectedResult => r.status === 'rejected')
        setRefsError(refFail ? refFail.reason : null)
        setPlans(pl.status === 'fulfilled' ? pl.value : [])
        setPlansError(pl.status === 'rejected' ? pl.reason : null)
        setLoading(false)
      })
    return () => { alive = false }
  }, [attempt])

  useEffect(() => {
    if (!planId) { setRes(null); setBundle(null); setPlanLoading(false); return undefined }
    let alive = true
    setPlanLoading(true)
    setPlanError(null)
    // Бэкенд без построенного плана отдаёт { plan_id: null } БЕЗ массива per_machine → null.
    Promise.allSettled([api.simulation.results(planId), api.analytics.kpi(planId)]).then(([r, k]) => {
      if (!alive) return
      setRes(r.status === 'fulfilled' && r.value && r.value.plan_id && Array.isArray(r.value.per_machine) ? r.value : null)
      setBundle(k.status === 'fulfilled' ? k.value : null)
      const fail = [r, k].find((x): x is PromiseRejectedResult => x.status === 'rejected')
      setPlanError(fail ? fail.reason : null)
      setPlanLoading(false)
    })
    return () => { alive = false }
  }, [planId, attempt])

  useEffect(() => {
    if (!wantFlow || !planId) return undefined
    let alive = true
    setFlowLoading(true)
    api.simulation.plan(planId)
      .then((p) => { if (alive) setFlowPlan(p) })
      .catch((e: unknown) => { if (alive) { setFlowPlan(null); setPlanError(e) } })
      .finally(() => { if (alive) setFlowLoading(false) })
    return () => { alive = false }
  }, [planId, wantFlow, attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  return { ...refs, planId, loading, plans, plansError, refsError, retry, res, bundle, planLoading, planError, flowPlan, flowLoading }
}
