/**
 * График очередей (X1 §5 п. 8): сколько операций «ждут» свободного станка во времени — `AreaChart`
 * chart-системы (сплошная сетка, 10 % заливка, одна подсказка, таблица-двойник), пик — маркер с
 * лидер-подписью. Ось X — даты от начала горизонта (те же помощники, что у Ганта), подписаны только
 * границы суток/недель. Фильтр «рабочий центр» — в заголовке карточки; по умолчанию — узкое место.
 */
import { useMemo } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { num } from '../../explain/format'
import { AreaChart, type Annotation, type TipRow } from '../../ui/charts'
import { timeLabel } from './ganttTime'
import { parseIsoDate } from './wizard/dates'

type QueueByWc = NonNullable<ScheduleResult['queue_by_wc']>
type QueuePoints = NonNullable<ScheduleResult['queue_timeline']>
/** Точка ряда: агрегат несёт «где копится» (top_wc), ряд участка — нет. */
type QPoint = { t: number; queued: number; top_wc?: string; top_wc_n?: number }

const DAY = 24
const MAX_TICKS = 8

/** Селектор рабочего центра: «все» (агрегат) или очередь конкретного участка, по убыванию пика. */
export function QueueFilter({ byWc, value, onChange }: { byWc?: QueueByWc; value: string; onChange: (wc: string) => void }) {
  const options = useMemo(() => (byWc ?? []).slice().sort((a, b) => b.peak - a.peak), [byWc])
  if (options.length === 0) return null
  return (
    <label className="pl-queue__filter">
      <span className="text-caps">Рабочий центр</span>
      <select className="pl-select pl-select--sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Все участки (сумма)</option>
        {options.map((o) => <option key={o.wc_type_id} value={o.wc_type_id}>{o.wc_name} · пик {num(o.peak, 0)}</option>)}
      </select>
    </label>
  )
}

/** Индексы точек на границах суток (или недель на длинном горизонте) — не больше MAX_TICKS подписей. */
export function dayTickIndices(ts: readonly number[]): number[] {
  if (ts.length === 0) return []
  const span = ts[ts.length - 1] - ts[0]
  const step = [1, 2, 7, 14, 30].map((d) => d * DAY).find((s) => span / s <= MAX_TICKS) ?? 30 * DAY
  const out: number[] = []
  let next = Math.ceil(ts[0] / step) * step
  ts.forEach((t, i) => { if (t >= next) { out.push(i); next += step } })
  return out
}

export function QueueChart({ data, byWc, wc = '', startDate = null }: { data: QueuePoints; byWc?: QueueByWc; wc?: string; startDate?: string | null }) {
  const start = useMemo(() => parseIsoDate(startDate), [startDate])
  // Активный ряд: агрегат или выбранный участок.
  const series = useMemo<ReadonlyArray<QPoint>>(() => {
    if (!wc) return data
    const s = (byWc ?? []).find((x) => x.wc_type_id === wc)
    return s ? s.points : data
  }, [wc, data, byWc])
  const wcName = wc ? (byWc ?? []).find((o) => o.wc_type_id === wc)?.wc_name ?? '' : ''

  const labels = useMemo(() => series.map((d) => timeLabel(d.t, start)), [series, start])
  const ticks = useMemo(() => dayTickIndices(series.map((d) => d.t)), [series])
  const values = useMemo(() => series.map((d) => d.queued), [series])
  const peakIdx = useMemo(() => series.reduce((a, _d, i) => (series[i].queued > series[a].queued ? i : a), 0), [series])
  const peak = series[peakIdx]
  const annotations: Annotation[] = peak
    ? [{ key: 'peak', index: peakIdx, seriesKey: 'q', label: `пик ${num(peak.queued, 0)}${peak.top_wc ? ` · ${peak.top_wc}` : ''}` }]
    : []
  const tipRows = (i: number): TipRow[] => {
    const d = series[i]
    if (!d) return []
    if (wcName) return [{ key: 'wc', label: 'участок', value: wcName }]
    return [{ key: 'top', label: 'копится у', value: d.top_wc ? `${d.top_wc} (${num(d.top_wc_n ?? 0, 0)})` : 'нет очереди' }]
  }

  return (
    <AreaChart
      labels={labels}
      series={[{ key: 'q', name: wcName ? `в очереди · ${wcName}` : 'операций в очереди', values, fmt: (v) => num(v, 0) }]}
      fmtY={(v) => num(Math.ceil(v), 0)}
      unit="оп."
      xHeader="время"
      height={200}
      tickIndices={ticks}
      annotations={annotations}
      tipRows={tipRows}
      ariaLabel={`Очереди операций во времени: пик ${num(peak?.queued ?? 0, 0)} операций${peak?.top_wc ? ` у ${peak.top_wc}` : ''}`}
      emptyTitle="Очереди не возвращены"
    />
  )
}
