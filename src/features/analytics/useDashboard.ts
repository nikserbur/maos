/**
 * Состояние дашборда «Аналитики»: конфиг (закреплённые KPI + два графика) из БД проекта,
 * ряд KPI по построениям, одна общая ось для обоих графиков (фильтр над карточками, X1 §6.3 п. 1).
 * Форма сохранённого конфига не меняется — ось пишется в оба графика.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, type KpiBundle } from '../../lib/api'
import {
  loadDashboard, saveDashboard, type AxisMode, type ChartConfig, type DashboardConfig,
} from './dashboardConfig'

const DEFAULT_METRIC: Record<AxisMode, string> = { plans: 'MAKESPAN', timeline: 'util' }

export interface DashboardApi {
  cfg: DashboardConfig | null
  /** KPI по всем построениям (по возрастанию времени). */
  series: KpiBundle[]
  /** Ряд ещё грузится — графики показывают прежний кадр, а не «нет данных». */
  seriesLoading: boolean
  axis: AxisMode
  /** Ошибка чтения конфига (показан дефолт) / последнего сохранения. */
  loadError: string | null
  saveError: string | null
  setAxis: (axis: AxisMode) => void
  setChart: (i: number, patch: Partial<ChartConfig>) => void
  togglePin: (code: string) => void
  /** Клик по плитке: показать KPI в первом графике на оси «по планам». */
  pinToChart: (code: string) => void
}

export function useDashboard(planId: string | null): DashboardApi {
  const [cfg, setCfg] = useState<DashboardConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [series, setSeries] = useState<KpiBundle[]>([])
  const [seriesLoading, setSeriesLoading] = useState(true)

  useEffect(() => {
    let alive = true
    loadDashboard().then((r) => { if (alive) { setCfg(r.config); setLoadError(r.error) } })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setSeriesLoading(true)
    api.analytics.kpiSeries()
      .then((s) => { if (alive) setSeries(s) })
      .catch(() => { if (alive) setSeries([]) })
      .finally(() => { if (alive) setSeriesLoading(false) })
    return () => { alive = false }
  }, [planId])

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
    const second = axis === 'timeline' ? 'workers' : 'OTD'
    const charts: [ChartConfig, ChartConfig] = [
      { ...cfg.charts[0], axis, metrics: [DEFAULT_METRIC[axis]] },
      { ...cfg.charts[1], axis, metrics: [second] },
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
    const charts: [ChartConfig, ChartConfig] = [
      { ...cfg.charts[0], axis: 'plans', metrics: [code] },
      cfg.charts[1].axis === 'plans' ? cfg.charts[1] : { ...cfg.charts[1], axis: 'plans', metrics: ['OTD'] },
    ]
    apply({ ...cfg, charts })
  }, [cfg, apply])

  return { cfg, series, seriesLoading, axis: cfg?.charts[0].axis ?? 'plans', loadError, saveError, setAxis, setChart, togglePin, pinToChart }
}
