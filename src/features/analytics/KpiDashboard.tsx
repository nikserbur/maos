/**
 * Вкладка «KPI»: закреплённые плитки (герой со спарклайном) → два графика с общей осью и периодом
 * из строки фильтров экрана → разбор (рекомендации, сравнение, реестр таблицей). Набор плиток и
 * метрики графиков сохраняются в БД проекта (useDashboard).
 */
import { useState } from 'react'
import type { KpiBundle, SimPlanSummary, SimResults } from '../../lib/api'
import { EmptyState, ErrorBanner, IconButton, Section, SkeletonRows } from '../../ui/kit'
import { num } from '../../explain/format'
import { useCashStore } from '../finance/cashStore'
import { usePassport } from '../passport/passportStore'
import { withCashKpis } from './cashKpis'
import type { KpiContext } from './kpiCatalog'
import type { TypeLoad } from './analyticsModel'
import type { DashboardApi } from './useDashboard'
import { KpiCharts } from './KpiCharts'
import { KpiPins, PinEditor } from './KpiPins'
import { KpiRegistry } from './KpiRegistry'

interface KpiDashboardProps {
  dash: DashboardApi
  /** Окно периода из строки фильтров (id из chartData.periodOptions). */
  period: string
  bundle: KpiBundle | null
  res: SimResults | null
  loads: ReadonlyArray<TypeLoad>
  plans: ReadonlyArray<SimPlanSummary>
  planId: string
  ctx: KpiContext
  onInvest: (wcTypeId: string) => void
}

export function KpiDashboard({ dash, period, bundle, res, loads, plans, planId, ctx, onInvest }: KpiDashboardProps) {
  const [editPins, setEditPins] = useState(false)
  const cash = useCashStore()
  const passport = usePassport()
  const { cfg, series } = dash

  if (!cfg) return <SkeletonRows rows={3} cols={4} label="Загрузка дашборда…" />

  // Значения плиток: из выбранного плана, иначе из последнего построения в ряду.
  const valueBundle = bundle ?? (series.length ? series[series.length - 1] : null)
  const hasKpi = Boolean(bundle?.kpi && Object.keys(bundle.kpi).length > 0)
  const full = hasKpi ? withCashKpis(bundle as KpiBundle, cash.result, passport.fin) : null
  const cashNote = cash.result
    ? `деньги — водопад кассы CVaR-LP, ${num(cash.result.n_scenarios, 0)} сценариев × ${num(cash.result.horizon_weeks, 0)} нед`
    : 'деньги появятся после расчёта кассы в «Плане» (шаг «Результат»)'

  return (
    <>
      {dash.loadError && <ErrorBanner tone="setup" title="Набор плиток не прочитан — показан стандартный" message={dash.loadError} />}
      {dash.saveError && <ErrorBanner tone="setup" title="Изменения дашборда не сохранены" message={dash.saveError} />}

      <Section id="an-pins" title="Закреплённые показатели"
        meta="набор хранится в проекте · клик по плитке выводит показатель по построениям в первом графике"
        tools={<IconButton icon={editPins ? 'check' : 'pin'} size="sm" pressed={editPins} onClick={() => setEditPins((v) => !v)}>{editPins ? 'Готово' : 'Настроить набор'}</IconButton>}>
        {editPins && <PinEditor pinned={cfg.pinned} onToggle={dash.togglePin} />}
        <KpiPins pinned={cfg.pinned} bundle={valueBundle} series={series} ctx={ctx} onOpen={dash.pinToChart} />
      </Section>

      <KpiCharts charts={cfg.charts} axis={dash.axis} period={period} series={series} res={res} loading={dash.seriesLoading} onChange={dash.setChart} />

      {full ? (
        <KpiRegistry bundle={full} loads={loads} plans={plans} planId={planId} ctx={ctx} cashNote={cashNote} onInvest={onInvest} />
      ) : (
        <EmptyState title="Полный набор KPI есть только у планов, построенных с сохранением показателей" variant="table" size="sm">
          Постройте или перестройте расписание на экране «План».
          {res && res.n_machines > 0 && ' Базовые метрики уже доступны во вкладках «Узкие места» и «Потоки».'}
        </EmptyState>
      )}
    </>
  )
}
