/**
 * График «во времени» Аналитики — адаптер над chart-системой (src/ui/charts, G3 1.1):
 * сплошная волосяная сетка, компактные тики, маркеры только на hover/конце, одна подсказка,
 * легенда при ≥ 2 рядов, таблица-двойник. Контракт `ChartSeries` сохранён для KpiDashboard.
 */
import type { ChartType } from './dashboardConfig'
import { AreaChart, ColumnChart, LineChart, type Series } from '../../ui/charts'

/** Один ряд графика: значения выровнены с labels по индексу (NaN — разрыв). */
export interface ChartSeries {
  key: string
  name: string
  color: string
  fmtY: (v: number) => string
  points: number[]
}

interface TimeChartProps {
  labels: string[]
  series: ChartSeries[]
  type: ChartType
  height?: number
  /** Подпись для экранного диктора (что изображено). */
  ariaLabel?: string
  emptyText?: string
}

export function TimeChart({ labels, series, type, height = 240, ariaLabel, emptyText }: TimeChartProps) {
  const rows: Series[] = series.map((s) => ({ key: s.key, name: s.name, color: s.color, values: s.points, fmt: s.fmtY }))
  const fmtY = series[0]?.fmtY
  const common = {
    labels, series: rows, height, fmtY, ariaLabel,
    emptyTitle: 'Нет данных для выбранных метрик',
    emptyText: emptyText ?? 'Постройте план на экране «План» — показатели появятся по каждому построению.',
  }
  if (type === 'bar') return <ColumnChart {...common} />
  if (type === 'area') return <AreaChart {...common} />
  return <LineChart {...common} />
}
