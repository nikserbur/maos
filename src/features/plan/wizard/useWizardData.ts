/**
 * Данные мастера плана в одном месте: справочники (изделия, планы, заказы, прогоны Стадии 2,
 * сценарии), выбранный портфель (`GET /api/optimize/runs/:id`), полный сценарий, сводка макро-
 * генератора и режимы, паспорт/fin_params (кэш), календарь. Здесь же обновляется «база»
 * унаследованных значений (α, критерий — из сценария; L_min, β — из fin_params) с владельцем.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  api, type DemandOrder, type MacroRegimes, type OptResult, type OptRunSummary, type PriceScenario, type Product, type ProductionPlan,
  type WorkCalendar,
} from '../../../lib/api'
import { getDecisionContext } from '../../../shell/context'
import { useRefs, ensureRefs } from '../../method-map/useMethodMapState'
import { usePassport } from '../../passport/passportStore'
import { useWizard, wizardActions, type WizardOrder } from './wizardStore'
import { horizonStart } from './dates'

export interface WizardData {
  products: Product[]
  plans: ProductionPlan[]
  orders: DemandOrder[]
  runs: OptRunSummary[]
  scenarios: PriceScenario[]
  run: OptResult | null
  runLoading: boolean
  scenario: PriceScenario | null
  regimes: MacroRegimes | null
  calendar: WorkCalendar | null
  loading: boolean
  error: string | null
  reloadOrders: () => Promise<void>
  reloadPlans: () => Promise<void>
  /** Программа по текущему источнику (для MRP, сводки, запуска). */
  program: WizardOrder[]
  /** Начало горизонта и откуда оно. */
  start: { date: Date; source: 'scenario' | 'fallback' }
  effectiveScenarioId: string
}

export function useWizardData(): WizardData {
  const w = useWizard()
  const refs = useRefs()
  const passport = usePassport()
  const [products, setProducts] = useState<Product[]>([])
  const [plans, setPlans] = useState<ProductionPlan[]>([])
  const [orders, setOrders] = useState<DemandOrder[]>([])
  const [runs, setRuns] = useState<OptRunSummary[]>([])
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [run, setRun] = useState<OptResult | null>(null)
  const [runLoading, setRunLoading] = useState(false)
  const [scenario, setScenario] = useState<PriceScenario | null>(null)
  const [regimes, setRegimes] = useState<MacroRegimes | null>(null)
  const [calendar, setCalendar] = useState<WorkCalendar | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reloadOrders = () => api.demandOrders.list().then(setOrders).catch(() => {})
  const reloadPlans = () => api.plans.list().then((ps) => {
    setPlans(ps)
    if (ps.length && !w.planId) wizardActions.setPlanId(ps[0].id)
  }).catch(() => {})

  useEffect(() => {
    let alive = true
    void ensureRefs()
    Promise.allSettled([
      api.products.list(), api.plans.list(), api.demandOrders.list(), api.optimize.runs(), api.scenarios.list(),
      api.macro.regimes(), api.calendar.get(),
    ]).then(([pr, pl, od, rn, sc, rg, cal]) => {
      if (!alive) return
      const ok = <T,>(r: PromiseSettledResult<T>, fb: T): T => (r.status === 'fulfilled' ? r.value : fb)
      setProducts(ok(pr, []).filter((p) => p.sellable === '1'))
      const planList = ok(pl, [])
      setPlans(planList)
      setOrders(ok(od, []))
      const runList = ok(rn, [])
      setRuns(runList)
      setScenarios(ok(sc, []))
      setRegimes(ok(rg, null as MacroRegimes | null))
      setCalendar(ok(cal, null as WorkCalendar | null))
      const failed = [pr, pl, od, rn, sc].filter((r) => r.status === 'rejected').length
      setError(failed === 5 ? 'нет связи с сервером' : null)
      setLoading(false)
      // Контекст решения: портфель → источник «портфель»; план → реестр.
      const ctx = getDecisionContext()
      const st = w
      if (!st.runId && !st.planId) {
        if (ctx.portfolioRunId && runList.some((r) => r.id === ctx.portfolioRunId)) {
          wizardActions.setSource('portfolio'); wizardActions.setRunId(ctx.portfolioRunId)
        } else if (planList.length) {
          wizardActions.setPlanId((ctx.planId && planList.some((p) => p.id === ctx.planId) ? ctx.planId : planList[0].id))
        }
      }
      if (!st.scenarioId && ctx.scenarioId) wizardActions.setScenarioId(ctx.scenarioId)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Портфель Стадии 2 → полный результат (программа, сценарий, горизонт).
  useEffect(() => {
    if (w.source !== 'portfolio' || !w.runId) { setRun(null); return }
    let alive = true
    setRunLoading(true)
    api.optimize.run_get(w.runId).then((r) => { if (alive) { setRun(r); if (r.scenario_id) wizardActions.setScenarioId(r.scenario_id) } })
      .catch(() => { if (alive) setRun(null) })
      .finally(() => { if (alive) setRunLoading(false) })
    return () => { alive = false }
  }, [w.source, w.runId])

  const effectiveScenarioId = (w.source === 'portfolio' && run?.scenario_id) || w.scenarioId || scenarios[0]?.id || ''

  // Полный сценарий (с распределениями) → база α / критерий с владельцем.
  useEffect(() => {
    if (!effectiveScenarioId) { setScenario(null); return }
    let alive = true
    api.scenarios.get(effectiveScenarioId).then((sc) => {
      if (!alive) return
      setScenario(sc)
      const alpha = Number(sc.alpha)
      wizardActions.setBase({
        alpha: Number.isFinite(alpha) && alpha > 0 ? alpha : 0.1,
        objective: sc.objective || 'cvar',
      }, `из сценария «${sc.name}»`)
      if (sc.start_date) wizardActions.setStartDate(sc.start_date)
    }).catch(() => { if (alive) setScenario(null) })
    return () => { alive = false }
  }, [effectiveScenarioId])

  // fin_params → база L_min / β (владелец — проект).
  useEffect(() => {
    if (!passport.fin) return
    wizardActions.setBase({ lMin: passport.fin.l_min, beta: passport.fin.beta }, 'из fin_params проекта')
  }, [passport.fin])

  // Календарь проекта → база «календарь смен».
  useEffect(() => {
    if (calendar) wizardActions.setBase({ useCalendar: calendar.enabled }, 'из календаря проекта')
  }, [calendar])

  const program = useMemo<WizardOrder[]>(() => {
    if (w.source === 'portfolio') {
      if (!run) return []
      return run.robust.items.filter((it) => it.qty > 0).map((it) => ({ product_id: it.product_id, qty: it.qty, due_hours: run.horizon_hours, priority: 5 }))
    }
    if (w.source === 'orders') {
      return orders.filter((o) => o.plan_id === w.planId).map((o) => ({
        id: o.id, product_id: o.product_id, qty: Number(o.quantity) || 1, due_hours: Number(o.due_hours) || 0, priority: Number(o.priority) || 5,
      }))
    }
    return [...w.manualOrders]
  }, [w.source, w.planId, w.manualOrders, run, orders])

  const start = useMemo(() => horizonStart(w.startDate ?? scenario?.start_date, new Date()), [w.startDate, scenario?.start_date])

  return {
    products, plans, orders, runs, scenarios, run, runLoading, scenario, regimes, calendar,
    loading: loading || refs.status === 'loading', error, reloadOrders, reloadPlans, program, start, effectiveScenarioId,
  }
}
