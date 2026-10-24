/**
 * Состояние дашборда «Аналитики»: конфиг (закреплённые KPI + два графика) из БД проекта,
 * ряд KPI по построениям, одна общая ось для обоих графиков (фильтр над карточками, X1 §6.3 п. 1).
 * Форма сохранённого конфига не меняется — ось пишется в оба графика.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type KpiBundle } from '../../lib/api'
import {
  SECOND_DEFAULT, loadDashboard, saveDashboard, type AxisMode, type ChartConfig, type DashboardConfig,
} from './dashboardConfig'
import { withTail } from './kpiCatalog'

const DEFAULT_METRIC: Record<AxisMode, string[]> = { plans: withTail('MAKESPAN'), timeline: ['util'] }

export interface DashboardApi {
  cfg: DashboardConfig | null
  /** KPI по всем построениям (по возрастанию времени). */
  series: KpiBundle[]
  /** Ряд ещё грузится — графики показывают прежний кадр, а не «нет данных». */
  seriesLoading: boolean
  /** Ряд KPI не прочитан (сбой сервера) — не «нет данных», а ошибка с повтором. */
  seriesError: unknown
  reloadSeries: () => void
  axis: AxisMode
  /** Ошибка чтения конфига (показан дефолт) / последнего сохранения. */
  loadError: string | null
  saveError: string | null
  setAxis: (axis: AxisMode) => void
  setChart: (i: number, patch: Partial<ChartConfig>) => void
  togglePin: (code: string) => void
  /** Клик по плитке: показать KPI в первом графике на оси «по планам». */
  pinToChart: (code: string) => void
  /** Заменить метрики графика целиком (подсказка «лучше показать …» у ровного ряда). */
  replaceMetrics: (i: number, metrics: string[]) => void
}

export function useDashboard(planId: string | null): DashboardApi {
  const [cfg, setCfg] = useState<DashboardConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [series, setSeries] = useState<KpiBundle[]>([])
  const [seriesLoading, setSeriesLoading] = useState(true)
  const [seriesError, setSeriesError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    loadDashboard().then((r) => { if (alive) { setCfg(r.config); setLoadError(r.error) } })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setSeriesLoading(true)
    api.analytics.kpiSeries()
      .then((s) => { if (alive) { setSeries(s); setSeriesError(null) } })
      .catch((e: unknown) => { if (alive) { setSeries([]); setSeriesError(e) } })
      .finally(() => { if (alive) setSeriesLoading(false) })
    return () => { alive = false }
  }, [planId, reloadKey])
  const reloadSeries = useCallback(() => setReloadKey((k) => k + 1), [])

  const apply = useCallback((next: DashboardConfig) => {
    setCfg(next)
    void saveDashboard(next).then(setSaveError)
  }, [])

  const setChart = useCallback((i: number, patch: Partial<ChartConfig>) => {
    if (!cfg) return
    const charts = cfg.charts.map((c, j) => (j === i ? { ...c, ...patch } : c)) as [ChartConfig, ChartConfig]
    apply({ ...cfg, charts })
  }, [cfg, apply])

  const setAxis = useCallback((axis: AxisMode) => {
    if (!cfg || cfg.charts[0].axis === axis) return
    // Метрики осей несовместимы → у каждого графика разумный дефолт; второй — вторая метрика оси.
    const charts: [ChartConfig, ChartConfig] = [
      { ...cfg.charts[0], axis, metrics: DEFAULT_METRIC[axis] },
      { ...cfg.charts[1], axis, metrics: SECOND_DEFAULT[axis] },
    ]
    apply({ ...cfg, charts })
  }, [cfg, apply])

  const togglePin = useCallback((code: string) => {
    if (!cfg) return
    const has = cfg.pinned.includes(code)
    apply({ ...cfg, pinned: has ? cfg.pinned.filter((c) => c !== code) : [...cfg.pinned, code] })
  }, [cfg, apply])

  const pinToChart = useCallback((code: string) => {
    if (!cfg) return
    // Показатель с хвостом риска (длина, просрочка) идёт парой «E · хвост CVaR» — одной серией.
    const charts: [ChartConfig, ChartConfig] = [
      { ...cfg.charts[0], axis: 'plans', metrics: withTail(code) },
      cfg.charts[1].axis === 'plans' ? cfg.charts[1] : { ...cfg.charts[1], axis: 'plans', metrics: SECOND_DEFAULT.plans },
    ]
    apply({ ...cfg, charts })
  }, [cfg, apply])

  const replaceMetrics = useCallback((i: number, metrics: string[]) => setChart(i, { metrics }), [setChart])

  return { cfg, series, seriesLoading, seriesError, reloadSeries, axis: cfg?.charts[0].axis ?? 'plans', loadError, saveError, setAxis, setChart, togglePin, pinToChart, replaceMetrics }
}
