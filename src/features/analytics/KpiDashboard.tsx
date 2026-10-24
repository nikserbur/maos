/**
 * Вкладка «KPI»: плитки кита сразу под вердиктом (первое число ≤ 220 px от верха) → строка
 * фильтров графиков (ось · период — то, чем они управляют) → два графика → разбор (рекомендации,
 * сравнение с базой, реестр). База сравнения — предыдущее построение (или `?vs=`): та же Δ на
 * плитках и в сравнении. Набор плиток и метрики графиков хранятся в БД проекта (useDashboard).
 */
import { useState } from 'react'
import type { KpiBundle, SimResults } from '../../lib/api'
import { EmptyState, ErrorBanner, Segmented, SkeletonRows, type SegOption } from '../../ui/kit'
import { num } from '../../explain/format'
import { useCashStore } from '../finance/cashStore'
import { usePassport } from '../passport/passportStore'
import { withCashKpis } from './cashKpis'
import type { KpiContext } from './kpiCatalog'
import type { TypeLoad } from './analyticsModel'
import type { AxisMode } from './dashboardConfig'
import { periodOptions, sliceByPeriod } from './chartData'
import type { PlanRef } from './planRuns'
import type { DashboardApi } from './useDashboard'
import { KpiCharts } from './KpiCharts'
import { KpiPins, PinEditor } from './KpiPins'
import { KpiRegistry } from './KpiRegistry'

const AXES: ReadonlyArray<SegOption<AxisMode>> = [
  { id: 'plans', label: 'По построениям', title: 'показатели по каждому построению плана' },
  { id: 'timeline', label: 'По часам', title: 'ряды симуляции внутри выбранного построения' },
]

interface KpiDashboardProps {
  dash: DashboardApi
  /** Окно периода (id из chartData.periodOptions) — из адреса. */
  period: string
  onPeriod: (period: string) => void
  bundle: KpiBundle | null
  bundleLoading: boolean
  res: SimResults | null
  loads: ReadonlyArray<TypeLoad>
  ctx: KpiContext
  planId: string
  refs: ReadonlyArray<PlanRef>
  seqOf: ReadonlyMap<string, number>
  /** База сравнения (предыдущее построение или выбранное); null — сравнивать не с чем. */
  baseRef: PlanRef | null
  onBase: (planId: string) => void
  onInvest: (wcTypeId: string) => void
}

export function KpiDashboard(props: KpiDashboardProps) {
  const { dash, period, onPeriod, bundle, bundleLoading, res, loads, ctx, planId, refs, seqOf, baseRef, onBase, onInvest } = props
  const [editPins, setEditPins] = useState(false)
  const cash = useCashStore()
  const passport = usePassport()
  const { cfg, series } = dash

  if (!cfg) return <SkeletonRows rows={3} cols={4} label="Загрузка дашборда…" />

  const hasKpi = Boolean(bundle?.kpi && Object.keys(bundle.kpi).length > 0)
  const full = hasKpi ? withCashKpis(bundle as KpiBundle, cash.result, passport.fin) : null
  const baseBundle = baseRef ? series.find((b) => b.plan_id === baseRef.id) ?? null : null
  const cashNote = cash.result
    ? `деньги — водопад кассы CVaR-LP, ${num(cash.result.n_scenarios, 0)} сценариев × ${num(cash.result.horizon_weeks, 0)} нед`
    : 'деньги появятся после расчёта кассы в «Плане» (шаг «Результат»)'
  // Спарклайн героя — то же окно, что у графиков.
  const currentIdx = series.findIndex((b) => b.plan_id === planId)
  const upToCurrent = currentIdx >= 0 ? series.slice(0, currentIdx + 1) : series
  const sparkSeries = sliceByPeriod(upToCurrent, dash.axis === 'plans' ? period : 'all')

  return (
    <>
      {dash.loadError && <ErrorBanner tone="setup" title="Набор плиток не прочитан — показан стандартный" detail={dash.loadError} />}
      {dash.saveError && <ErrorBanner tone="setup" title="Изменения дашборда не сохранены — повторите изменение" detail={dash.saveError} />}

      <KpiPins pinned={cfg.pinned} bundle={full ?? bundle} loading={bundleLoading && !bundle} series={sparkSeries}
        seriesLoading={dash.seriesLoading} ctx={ctx} base={baseRef && baseBundle ? { ref: baseRef, bundle: baseBundle } : null}
        onOpen={dash.pinToChart} editing={editPins} onToggleEdit={() => setEditPins((v) => !v)} />
      {editPins && <PinEditor pinned={cfg.pinned} onToggle={dash.togglePin} />}

      <div className="an-filters" role="group" aria-label="Фильтры графиков">
        <div className="an-tool">
          <span className="an-tool__k text-caps">Ось графиков</span>
          <Segmented<AxisMode> options={AXES} value={dash.axis} onChange={(a) => { dash.setAxis(a); onPeriod('') }} label="Ось графиков" size="sm" fit />
        </div>
        <div className="an-tool">
          <span className="an-tool__k text-caps">Период</span>
          <Segmented options={periodOptions(dash.axis).map((p) => ({ id: p.id, label: p.label, title: p.title }))}
                     value={period} onChange={onPeriod} label="Период" size="sm" fit />
        </div>
      </div>
      {dash.seriesError ? (
        <ErrorBanner error={dash.seriesError} message="Ряд показателей по построениям не прочитан — графики пусты не потому, что данных нет." onRetry={dash.reloadSeries} />
      ) : null}

      <KpiCharts charts={cfg.charts} axis={dash.axis} period={period} series={series} res={res} seqOf={seqOf}
        loading={dash.seriesLoading} onChange={dash.setChart} onReplace={dash.replaceMetrics} />

      {full ? (
        <KpiRegistry bundle={full} baseBundle={baseBundle} baseRef={baseRef} loads={loads} refs={refs} planId={planId}
          ctx={ctx} cashNote={cashNote} onBase={onBase} onInvest={onInvest} />
      ) : bundleLoading ? (
        <SkeletonRows rows={4} cols={4} label="Загрузка показателей построения…" />
      ) : (
        <EmptyState title="Полный набор KPI есть только у построений с сохранёнными показателями" kind="unavailable" variant="table" size="sm">
          Перестройте расписание на экране «План» — показатели сохранятся вместе с ним.
          {res && res.n_machines > 0 && ' Загрузка по типам уже есть во вкладках «Узкие места» и «Потоки».'}
        </EmptyState>
      )}
    </>
  )
}
