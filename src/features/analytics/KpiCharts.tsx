/**
 * Два графика «Аналитики» (X1 §6.3 п. 1): фильтры (ось · период · план) живут над карточками,
 * заголовок карточки = имена метрик, тип — по форме данных (построения → столбцы, часы → линия),
 * легенда — из ChartFrame, редактор метрик (чипы с «убрать» + «добавить») — отдельно, под плотом.
 */
import { useMemo } from 'react'
import type { KpiBundle, SimResults } from '../../lib/api'
import { ColumnChart, LineChart, type Series } from '../../ui/charts'
import { IconButton } from '../../ui/kit'
import { KPI_CATALOG } from './kpiCatalog'
import type { AxisMode, ChartConfig } from './dashboardConfig'
import { availableMetrics, buildChartData, chartKind, chartTitle, metricName, periodOptions } from './chartData'

const CATALOG_CODES = KPI_CATALOG.map((k) => k.code)
const CHART_H = 240

interface KpiChartsProps {
  charts: ReadonlyArray<ChartConfig>
  axis: AxisMode
  period: string
  series: ReadonlyArray<KpiBundle>
  res: SimResults | null
  loading?: boolean
  onChange: (i: number, patch: Partial<ChartConfig>) => void
}

export function KpiCharts({ charts, axis, period, series, res, loading = false, onChange }: KpiChartsProps) {
  return (
    <div className="an-charts">
      {charts.map((chart, i) => (
        <ChartCard key={i} chart={chart} axis={axis} period={period} series={series} res={res} loading={loading}
                   onChange={(patch) => onChange(i, patch)} />
      ))}
    </div>
  )
}

interface ChartCardProps {
  chart: ChartConfig
  axis: AxisMode
  period: string
  series: ReadonlyArray<KpiBundle>
  res: SimResults | null
  loading: boolean
  onChange: (patch: Partial<ChartConfig>) => void
}

function ChartCard({ chart, axis, period, series, res, loading, onChange }: ChartCardProps) {
  const data = useMemo(() => buildChartData(axis, chart.metrics, series, res, period), [axis, chart.metrics, series, res, period])
  const rows: Series[] = data.series.map((s) => ({ key: s.key, name: s.name, color: s.color, values: s.points, fmt: s.fmtY }))
  const names = chart.metrics.map((k) => metricName(axis, k))
  const available = availableMetrics(axis, chart.metrics, CATALOG_CODES)
  const periodLabel = periodOptions(axis).find((p) => p.id === period)?.label.toLowerCase() ?? ''
  const subtitle = axis === 'plans' ? `по построениям плана · ${periodLabel}` : `внутри выбранного плана · ${periodLabel}`

  const remove = (key: string) => {
    if (chart.metrics.length > 1) onChange({ metrics: chart.metrics.filter((m) => m !== key) })
  }
  const add = (key: string) => { if (key) onChange({ metrics: [...chart.metrics, key] }) }

  const common = {
    labels: data.labels, series: rows, height: CHART_H, fmtY: data.series[0]?.fmtY, loading: loading && axis === 'plans',
    title: chartTitle(names), subtitle,
    ariaLabel: `${chartTitle(names)} — ${subtitle}`,
    emptyTitle: 'Нет данных для выбранных метрик',
    emptyText: axis === 'plans'
      ? 'Постройте план на экране «План» — показатели появятся по каждому построению.'
      : 'Ряды по часам есть только у планов с сохранёнными результатами симуляции.',
  }

  return (
    <section className="dk-card an-chart dk-rise" aria-label={chartTitle(names)}>
      {chartKind(axis) === 'bar' ? <ColumnChart {...common} /> : <LineChart {...common} />}
      <div className="an-metrics" role="group" aria-label="Метрики графика">
        <span className="an-metrics__k text-caps">Метрики</span>
        {chart.metrics.map((key, mi) => (
          <span key={key} className="an-metric" data-slot={mi}>
            <span className="an-metric__sw" aria-hidden="true" />
            {metricName(axis, key)}
            {chart.metrics.length > 1 && (
              <IconButton icon="close" size="sm" variant="ghost" title={`Убрать «${metricName(axis, key)}»`} onClick={() => remove(key)} />
            )}
          </span>
        ))}
        {available.length > 0 && (
          <select className="dk-select an-metrics__add" value="" aria-label="Добавить метрику" onChange={(e) => add(e.target.value)}>
            <option value="">+ метрика</option>
            {available.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        )}
      </div>
    </section>
  )
}
