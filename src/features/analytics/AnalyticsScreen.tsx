/**
 * «Аналитика» (X1 §6.3, G3 2.4): KPI, узкие места, инвестпроекты и потоки по построенному плану.
 * Шапка и табы — единый кит; одна строка фильтров над содержимым (план · ось · период),
 * а не тулбары внутри карточек. Данные — те же вызовы API, что и прежде.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  api, type KpiBundle, type Machine, type SimPlan, type SimPlanSummary, type SimResults, type WorkCenterType, type Worker,
} from '../../lib/api'
import { EmptyState, ScreenHeader, Segmented, SkeletonRows, type SegOption } from '../../ui/kit'
import { hours, num } from '../../explain/format'
import { computeTypeLoads } from './analyticsModel'
import { defaultPeriod, periodOptions, shortDate } from './chartData'
import type { AxisMode } from './dashboardConfig'
import { useDashboard } from './useDashboard'
import { KpiDashboard } from './KpiDashboard'
import { Bottlenecks } from './Bottlenecks'
import { InvestPanel } from './InvestPanel'
import { FlowsSection } from './FlowsSection'
import './analytics.css'

type Tab = 'kpi' | 'bottleneck' | 'invest' | 'flow'

const TABS: ReadonlyArray<SegOption<Tab>> = [
  { id: 'kpi', label: 'KPI', icon: 'chart' },
  { id: 'bottleneck', label: 'Узкие места', icon: 'link' },
  { id: 'invest', label: 'Инвестпроекты', icon: 'money' },
  { id: 'flow', label: 'Потоки', icon: 'shuffle' },
]
const AXES: ReadonlyArray<SegOption<AxisMode>> = [
  { id: 'plans', label: 'По планам', title: 'показатели по каждому построению плана' },
  { id: 'timeline', label: 'По часам', title: 'ряды симуляции внутри выбранного плана' },
]

export function AnalyticsScreen() {
  const [tab, setTab] = useState<Tab>('kpi')
  const [machines, setMachines] = useState<Machine[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [wcTypes, setWcTypes] = useState<WorkCenterType[]>([])
  const [plans, setPlans] = useState<SimPlanSummary[]>([])
  const [planId, setPlanId] = useState('')
  const [res, setRes] = useState<SimResults | null>(null)
  const [kpiB, setKpiB] = useState<KpiBundle | null>(null)
  const [plan, setPlan] = useState<SimPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [investType, setInvestType] = useState('')   // предвыбор из «узких мест»/рекомендаций
  const [period, setPeriod] = useState(defaultPeriod('plans'))
  const dash = useDashboard(planId || null)

  useEffect(() => {
    Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workers.list().catch(() => [] as Worker[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
      api.simulation.plans().catch(() => [] as SimPlanSummary[]),
    ]).then(([m, w, t, pl]) => {
      setMachines(m); setWorkers(w); setWcTypes(t); setPlans(pl)
      if (pl.length) setPlanId(pl[0].id)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    // Бэкенд без построенного плана отдаёт { plan_id: null } БЕЗ массива per_machine → null.
    api.simulation.results(planId || undefined)
      .then((r) => setRes(r && r.plan_id && Array.isArray(r.per_machine) ? r : null))
      .catch(() => setRes(null))
    api.analytics.kpi(planId || undefined).then(setKpiB).catch(() => setKpiB(null))
    if (tab === 'flow') api.simulation.plan(planId || undefined).then(setPlan).catch(() => setPlan(null))
  }, [planId, tab])

  const nameOfType = useMemo(() => {
    const map = new Map(wcTypes.map((t) => [t.id, t.name]))
    return (id: string) => map.get(id) ?? id
  }, [wcTypes])
  const loads = useMemo(() => computeTypeLoads(res, machines, workers, wcTypes), [res, machines, workers, wcTypes])
  const ctx = useMemo(() => ({ machines: machines.length }), [machines.length])

  const goInvest = (typeId: string) => { setInvestType(typeId); setTab('invest') }
  const setAxis = (axis: AxisMode) => { dash.setAxis(axis); setPeriod(defaultPeriod(axis)) }

  return (
    <div className="an">
      <ScreenHeader
        eyebrow="Наблюдение · по построенному плану"
        title="Аналитика"
        blocks={['monitoring']}
        subtitle="Показатели — из результатов симуляции выбранного плана; инвестрасчёт — через рыночную модель и производительность (Стадия 2)."
      />

      <Segmented<Tab> options={TABS} value={tab} onChange={setTab} label="Разделы аналитики" kind="tab" size="lg" fit idBase="an" />

      {loading ? (
        <SkeletonRows rows={4} cols={5} label="Загрузка аналитики…" />
      ) : plans.length === 0 ? (
        <EmptyState title="Планов ещё нет" variant="chart" action={<a className="btn btn--primary" href="#/plan">Построить план</a>}>
          Аналитика читает сохранённые результаты построений: KPI, загрузку типов РЦ и ленту операций.
        </EmptyState>
      ) : (
        <>
          <div className="an-filters dk-rise" role="group" aria-label="Фильтры">
            <label className="an-tool">
              <span className="an-tool__k text-caps">План</span>
              <select className="dk-select an-filters__plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {plans.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    #{plans.length - i} · {hours(Number(p.makespan) || 0, 0)} · {num(Number(p.n_tasks) || 0, 0)} оп · {shortDate(p.created_at)}
                  </option>
                ))}
              </select>
            </label>
            {tab === 'kpi' && (
              <>
                <div className="an-tool">
                  <span className="an-tool__k text-caps">Ось графиков</span>
                  <Segmented<AxisMode> options={AXES} value={dash.axis} onChange={setAxis} label="Ось графиков" size="sm" fit />
                </div>
                <div className="an-tool">
                  <span className="an-tool__k text-caps">Период</span>
                  <Segmented options={periodOptions(dash.axis).map((p) => ({ id: p.id, label: p.label, title: p.title }))}
                             value={period} onChange={setPeriod} label="Период" size="sm" fit />
                </div>
              </>
            )}
          </div>

          <div className="an-body" id={`an-panel-${tab}`} role="tabpanel" aria-labelledby={`an-tab-${tab}`}>
            {tab === 'kpi' && (
              <KpiDashboard dash={dash} period={period} bundle={kpiB} res={res} loads={loads} plans={plans} planId={planId} ctx={ctx} onInvest={goInvest} />
            )}
            {tab === 'bottleneck' && <Bottlenecks loads={loads} onInvest={goInvest} />}
            {tab === 'invest' && <InvestPanel wcTypes={wcTypes} loads={loads} preselect={investType} nameOfType={nameOfType} />}
            {tab === 'flow' && <FlowsSection plan={plan} machines={machines} nameOfType={nameOfType} />}
          </div>
        </>
      )}
    </div>
  )
}
