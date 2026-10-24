/**
 * Два графика «Аналитики» (X2 «графики, которые несут информацию»): хронология — линия, подписи X —
 * номера построений «№19» (дата — в подсказке), пара «показатель + хвост CVaR» — одна серия
 * `--chart-1` с полосой хвоста, заголовок — утверждение о последних построениях. Ровный ряд (все
 * значения окна равны) схлопывается в строку-итог с предложением метрики, которая различает
 * построения. Редактор метрик (чипы «убрать» + «добавить») — под графиком.
 */
import { useMemo } from 'react'
import type { KpiBundle, SimResults } from '../../lib/api'
import { LineChart, type Series } from '../../ui/charts'
import { IconButton } from '../../ui/kit'
import { KPI_CATALOG, kpiDef, withTail } from './kpiCatalog'
import type { AxisMode, ChartConfig } from './dashboardConfig'
import {
  availableMetrics, buildChartData, chartTitle, flatInfo, flatSuggestion, metricName, periodOptions, statementTitle, type ChartData,
} from './chartData'

const CATALOG_CODES = KPI_CATALOG.map((k) => k.code)
const CHART_H = 240

interface KpiChartsProps {
  charts: ReadonlyArray<ChartConfig>
  axis: AxisMode
  period: string
  series: ReadonlyArray<KpiBundle>
  res: SimResults | null
  seqOf: ReadonlyMap<string, number>
  loading?: boolean
  onChange: (i: number, patch: Partial<ChartConfig>) => void
  onReplace: (i: number, metrics: string[]) => void
}

export function KpiCharts({ charts, axis, period, series, res, seqOf, loading = false, onChange, onReplace }: KpiChartsProps) {
  return (
    <div className="an-charts">
      {charts.map((chart, i) => {
        const others = charts.filter((_, j) => j !== i).flatMap((c) => c.metrics)
        return (
          <ChartCard key={i} chart={chart} axis={axis} period={period} series={series} res={res} seqOf={seqOf} loading={loading}
                     others={others} onChange={(patch) => onChange(i, patch)} onReplace={(m) => onReplace(i, m)} />
        )
      })}
    </div>
  )
}

interface ChartCardProps {
  chart: ChartConfig
  axis: AxisMode
  period: string
  series: ReadonlyArray<KpiBundle>
  res: SimResults | null
  seqOf: ReadonlyMap<string, number>
  loading: boolean
  /** Метрики второго графика — подсказка замены их не предлагает. */
  others: ReadonlyArray<string>
  onChange: (patch: Partial<ChartConfig>) => void
  onReplace: (metrics: string[]) => void
}

function ChartCard({ chart, axis, period, series, res, seqOf, loading, others, onChange, onReplace }: ChartCardProps) {
  const data = useMemo(() => buildChartData(axis, chart.metrics, series, res, period, seqOf), [axis, chart.metrics, series, res, period, seqOf])
  const names = chart.metrics.map((k) => metricName(axis, k))
  const periodLabel = periodOptions(axis).find((p) => p.id === period)?.label.toLowerCase() ?? ''
  const subtitle = axis === 'plans' ? `окно: ${periodLabel}` : `внутри выбранного построения · ${periodLabel}`
  const title = statementTitle(axis, data, names)
  const flat = loading ? null : flatInfo(axis, data)
  const suggest = flat && axis === 'plans' ? flatSuggestion(chart.metrics, others) : null

  return (
    <section className="dk-card an-chart" aria-label={chartTitle(names)}>
      {flat ? (
        <div className="an-flat" role="note">
          <h3 className="an-flat__title">{flat.text}</h3>
          <p className="an-muted">
            Ровный ряд не различает построения — график из одинаковых точек не показан.
            {suggest && <>{' '}<button type="button" className="pf-link" onClick={() => onReplace(withTail(suggest))}>Показать «{kpiDef(suggest)?.name}»</button></>}
          </p>
        </div>
      ) : (
        <LineChart labels={data.labels} series={toSeries(data)} height={CHART_H} fmtY={data.series[0]?.fmtY}
          loading={loading && axis === 'plans'} title={title} subtitle={subtitle} ariaLabel={`${title} — ${subtitle}`}
          xHeader={axis === 'plans' ? 'Построение' : 'Час'}
          tipRows={axis === 'plans' ? (i) => [{ key: 'when', label: 'построено', value: data.tips[i] ?? '' }] : undefined}
          emptyTitle="Нет данных для выбранных метрик"
          emptyText={axis === 'plans'
            ? 'У построений в окне нет этих показателей — выберите другую метрику или окно «Все построения».'
            : 'Ряды по часам есть только у построений с сохранёнными результатами симуляции.'} />
      )}
      <MetricEditor chart={chart} axis={axis} data={data} onChange={onChange} />
    </section>
  )
}

function toSeries(data: ChartData): Series[] {
  return data.series.map((s) => ({
    key: s.key, name: s.name, color: s.color, values: s.points, fmt: s.fmtY,
    band: s.band ? { lo: s.band.lo, hi: s.band.hi, label: s.band.label } : undefined,
  }))
}

/** Слот цвета чипа = слот серии; хвост, слитый с показателем, — слот показателя с пометкой «полоса». */
function chipSlot(data: ChartData, key: string): { slot: number; band: boolean } {
  const own = data.series.findIndex((s) => s.key === key)
  if (own >= 0) return { slot: own, band: false }
  const host = data.series.findIndex((s) => s.band && kpiDef(s.key)?.tail === key)
  return { slot: host, band: host >= 0 }
}

function MetricEditor({ chart, axis, data, onChange }: { chart: ChartConfig; axis: AxisMode; data: ChartData; onChange: (patch: Partial<ChartConfig>) => void }) {
  const available = availableMetrics(axis, chart.metrics, CATALOG_CODES)
  const remove = (key: string) => {
    if (chart.metrics.length > 1) onChange({ metrics: chart.metrics.filter((m) => m !== key) })
  }
  const add = (key: string) => { if (key) onChange({ metrics: [...chart.metrics, key] }) }
  return (
    <div className="an-metrics" role="group" aria-label="Метрики графика">
      <span className="an-metrics__k text-caps">Метрики</span>
      {chart.metrics.map((key) => {
        const { slot, band } = chipSlot(data, key)
        const name = metricName(axis, key)
        return (
          <span key={key} className={`an-metric${band ? ' an-metric--band' : ''}`} data-slot={slot}>
            <span className="an-metric__sw" aria-hidden="true" />
            {name}{band && <span className="dk-vh"> — полоса хвоста</span>}
            {chart.metrics.length > 1 && (
              <IconButton icon="close" size="sm" variant="ghost" title={`Убрать «${name}»`} onClick={() => remove(key)} />
            )}
          </span>
        )
      })}
      {available.length > 0 && (
        <select className="dk-select an-metrics__add" value="" aria-label="Добавить метрику" onChange={(e) => add(e.target.value)}>
          <option value="">+ метрика</option>
          {available.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
        </select>
      )}
    </div>
  )
}
