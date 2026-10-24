/**
 * «Аналитика» (X1 §6.3, X2): ответ сначала — строка-вердикт о выбранном построении под шапкой, затем
 * вкладки KPI · Узкие места · Инвестпроекты · Потоки. Вкладка и построение живут в адресе
 * `#/analytics/<вкладка>/<planId>` (F5 восстанавливает вид, «Назад» работает), тип РЦ инвестпроекта —
 * `?wc=`, окно графиков — `?period=`, база сравнения — `?vs=`. Выбор построения — в шапке.
 */
import { useEffect, useMemo } from 'react'
import { EmptyState, ErrorBanner, ScreenHeader, Skeleton, SkeletonRows, Tabs, type TabItem } from '../../ui/kit'
import type { BlockId } from '../method-map/types'
import { buildHash, navigateTo, setHashParams, useHashRoute } from '../../shell/router'
import { setCrumbTitle } from '../../shell/crumbs'
import { computeTypeLoads } from './analyticsModel'
import { TAB_LABEL, analyticsAnchor, analyticsCrumb, parseAnalyticsAnchor, type AnalyticsTab } from './analyticsRoute'
import { normalizePeriod } from './chartData'
import { planOptionLabel, planRefs, planSeqMap, planTitle, previousPlan } from './planRuns'
import { useAnalyticsData } from './useAnalyticsData'
import { useDashboard } from './useDashboard'
import { buildVerdict } from './verdict'
import { AnalyticsVerdict } from './AnalyticsVerdict'
import { KpiDashboard } from './KpiDashboard'
import { Bottlenecks } from './Bottlenecks'
import { InvestPanel } from './InvestPanel'
import { FlowsSection } from './FlowsSection'
import './analytics.css'

const TAB_ICONS = { kpi: 'chart', bottleneck: 'link', invest: 'money', flow: 'shuffle' } as const

/** Вкладки — ссылки на тот же адрес с другой вкладкой (построение и параметры сохраняются): стрелки не грузят данные. */
function tabItems(planId: string | null, params: Readonly<Record<string, string>>): ReadonlyArray<TabItem<AnalyticsTab>> {
  return (Object.keys(TAB_ICONS) as AnalyticsTab[]).map((id) => ({
    id, label: TAB_LABEL[id], icon: TAB_ICONS[id], href: buildHash('analytics', analyticsAnchor(id, planId), params),
  }))
}

const SUBTITLE = 'Показатели выбранного построения плана: сроки, загрузка, узкие места, окупаемость'

/** Блоки карты, которые реально использует вкладка (чипы видны, только если нет полосы методологии). */
const TAB_BLOCKS: Readonly<Record<AnalyticsTab, readonly BlockId[]>> = {
  kpi: ['monitoring'], bottleneck: ['monitoring'], invest: ['decisions'], flow: ['monitoring'],
}

export function AnalyticsScreen() {
  const { anchor, params } = useHashRoute()
  const route = parseAnalyticsAnchor(anchor)
  const tab = route.tab
  const data = useAnalyticsData(route.planId, tab === 'flow')
  const dash = useDashboard(data.planId || null)
  const { planId, plans } = data

  const seqOf = useMemo(() => planSeqMap(plans, dash.series), [plans, dash.series])
  const refs = useMemo(() => planRefs(plans, dash.series), [plans, dash.series])
  const current = refs.find((r) => r.id === planId) ?? null
  const seq = current?.seq ?? seqOf.get(planId) ?? null
  const baseRef = params.vs ? refs.find((r) => r.id === params.vs) ?? null : previousPlan(refs, planId)

  const nameOfType = useMemo(() => {
    const map = new Map(data.wcTypes.map((t) => [t.id, t.name]))
    return (id: string) => map.get(id) ?? id
  }, [data.wcTypes])
  const loads = useMemo(() => computeTypeLoads(data.res, data.machines, data.workers, data.wcTypes),
    [data.res, data.machines, data.workers, data.wcTypes])
  const verdict = useMemo(() => buildVerdict({ seq, nTasks: current?.nTasks ?? 0, bundle: data.bundle, loads }),
    [seq, current?.nTasks, data.bundle, loads])
  const ctx = useMemo(() => ({ machines: data.machines.length }), [data.machines.length])
  const period = normalizePeriod(dash.axis, params.period)
  // Номера построений зависят от ряда KPI: до первой загрузки ряда номера не показываем (без «№12 → №52»);
  // повторная загрузка при смене построения держит прежний ряд.
  const numbersReady = dash.series.length > 0 || !dash.seriesLoading

  // Крошки и заголовок вкладки: «Аналитика › Узкие места · План №28».
  useEffect(() => {
    if (anchor && numbersReady) setCrumbTitle('analytics', anchor, analyticsCrumb(tab, seq ? planTitle(seq) : null))
  }, [anchor, tab, seq, numbersReady])

  const go = (nextTab: AnalyticsTab, nextPlan: string | null, patch: Record<string, string | null> = {}) =>
    navigateTo('analytics', analyticsAnchor(nextTab, nextPlan), { ...params, ...patch })
  const setTab = (t: AnalyticsTab) => go(t, route.planId)
  const setPlan = (id: string) => go(tab, id, { vs: null })
  const goInvest = (typeId: string) => go('invest', route.planId, { wc: typeId })

  const planSelect = refs.length > 0 && (!numbersReady ? <Skeleton h={30} w={280} /> : (
    <label className="an-plansel">
      <span className="an-tool__k text-caps">Построение</span>
      <select className="dk-select" value={planId} onChange={(e) => setPlan(e.target.value)} aria-label="Построение плана">
        {refs.map((r) => <option key={r.id} value={r.id}>{planOptionLabel(r)}</option>)}
      </select>
    </label>
  ))

  return (
    <div className="an">
      <ScreenHeader eyebrow="Наблюдение" title="Аналитика" blocks={TAB_BLOCKS[tab]} subtitle={SUBTITLE} actions={planSelect || undefined} />

      {data.plansError ? (
        <ErrorBanner error={data.plansError} message="Список построений не прочитан — аналитику показать не по чему." onRetry={data.retry} />
      ) : !data.loading && plans.length === 0 ? (
        <EmptyState title="Постройте план — аналитика появится по его результатам" kind="first-use" variant="chart"
          action={<a className="btn btn--primary" href="#/plan/new">Построить план</a>}>
          Здесь будут KPI построения, ранжир узких мест, окупаемость докупки оборудования и потоки партий.
        </EmptyState>
      ) : (
        <>
          <AnalyticsVerdict verdict={data.loading ? null : verdict} loading={data.loading || !numbersReady || data.planLoading} onInvest={goInvest} />
          <Tabs label="Разделы аналитики" value={tab} items={tabItems(route.planId, params)} onChange={setTab} />
          {data.refsError ? (
            <ErrorBanner tone="setup" error={data.refsError} message="Справочники прочитаны не полностью — узкие места и потоки могут быть неполными." onRetry={data.retry} />
          ) : null}
          {data.planError ? <ErrorBanner error={data.planError} message="Результаты построения не прочитаны." onRetry={data.retry} /> : null}

          {/* Смена построения: прежний кадр приглушён, пока не пришли новые KPI (не «нет данных»). */}
          <div className={`an-body${data.planLoading && data.bundle ? ' is-refetching' : ''}`} role="region"
               aria-label={TAB_LABEL[tab]} aria-busy={data.planLoading || undefined}>
            {data.loading ? <SkeletonRows rows={4} cols={5} label="Загрузка аналитики…" /> : (
              <>
                {tab === 'kpi' && (
                  <KpiDashboard dash={dash} period={period} onPeriod={(p) => setHashParams({ period: p })}
                    bundle={data.bundle} bundleLoading={data.planLoading} res={data.res} loads={loads} ctx={ctx}
                    planId={planId} refs={refs} seqOf={seqOf} baseRef={baseRef}
                    onBase={(id) => setHashParams({ vs: id })} onInvest={goInvest} />
                )}
                {tab === 'bottleneck' && (
                  <Bottlenecks loads={loads} planId={planId} machines={data.machines} loading={data.planLoading && !data.res} onInvest={goInvest} />
                )}
                {tab === 'invest' && (
                  <InvestPanel wcTypes={data.wcTypes} loads={loads} preselect={params.wc ?? ''} nameOfType={nameOfType}
                    onType={(id) => setHashParams({ wc: id })} />
                )}
                {tab === 'flow' && (
                  <FlowsSection plan={data.flowPlan} machines={data.machines} nameOfType={nameOfType}
                    bottleneck={verdict.bottleneck} loading={data.flowLoading} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
