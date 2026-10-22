/**
 * История прогонов Стадии 1 (UX-V2 §4.5 `RunsTable`): бэкенд хранит планы (`GET /api/simulation/plans`)
 * и их KPI (`GET /api/analytics/kpi_series`) — таблица собирается из них: дата, заказы, E[Cmax],
 * CVaR, OTD, узкое место. Выбор двух строк → сравнение бок о бок (`DiffTable`); клик — открыть KPI.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type KpiBundle, type SimPlanSummary } from '../../lib/api'
import { hours, money, num, pct } from '../../explain/format'
import { DiffTable, type DiffTableRow } from '../../ui/DiffList'
import { Chip, SkeletonRows } from './ui'
import './plan-screen.css'

export interface RunRow {
  id: string
  createdAt: string
  nTasks: number
  makespan: number
  kpi: KpiBundle | null
}

const fmtDate = (s: string) => new Date(s.replace(' ', 'T')).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const kpiOf = (b: KpiBundle | null, f: string): number => (b && typeof b.kpi?.[f] === 'number' ? b.kpi[f] : Number.NaN)

export function mergeRuns(plans: readonly SimPlanSummary[], series: readonly KpiBundle[]): RunRow[] {
  const byId = new Map(series.filter((b) => b.plan_id).map((b) => [b.plan_id as string, b]))
  return plans.map((p) => ({ id: p.id, createdAt: p.created_at, nTasks: Number(p.n_tasks) || 0, makespan: Number(p.makespan) || 0, kpi: byId.get(p.id) ?? null }))
}

const COMPARE_ROWS: ReadonlyArray<DiffTableRow<RunRow>> = [
  { key: 'mk', label: 'E[Cmax]', get: (r) => kpiOf(r.kpi, 'makespan_mean'), fmt: (v) => hours(v, 0), better: 'low', always: true },
  { key: 'cvar', label: 'CVaR длины', get: (r) => kpiOf(r.kpi, 'makespan_cvar'), fmt: (v) => hours(v, 0), better: 'low', always: true },
  { key: 'otd', label: 'OTD', get: (r) => kpiOf(r.kpi, 'otd'), fmt: (v) => pct(v, 0), better: 'high', always: true },
  { key: 'tard', label: 'Просрочка', get: (r) => kpiOf(r.kpi, 'tardiness'), fmt: (v) => hours(v, 0), better: 'low' },
  { key: 'util', label: 'Загрузка', get: (r) => kpiOf(r.kpi, 'utilization'), fmt: (v) => pct(v, 0), better: 'high', always: true },
  { key: 'wait', label: 'Доля ожидания', get: (r) => kpiOf(r.kpi, 'wait_share'), fmt: (v) => pct(v, 0), better: 'low' },
  { key: 'cost', label: 'Себестоимость работ', get: (r) => kpiOf(r.kpi, 'cost'), fmt: (v) => money(v), better: 'low' },
  { key: 'setups', label: 'Переналадок', get: (r) => kpiOf(r.kpi, 'n_setups'), fmt: (v) => num(v, 0), better: 'low' },
  { key: 'bn', label: 'Узкое место', get: (r) => r.kpi?.bottleneck?.wc_name ?? '—' },
  { key: 'ops', label: 'Операций', get: (r) => r.nTasks, fmt: (v) => num(v, 0) },
]

interface RunsTableProps {
  /** Выделить строку текущего результата. */
  currentId?: string | null
  onOpen?: (row: RunRow) => void
  limit?: number
}

export function RunsTable({ currentId, onOpen, limit = 12 }: RunsTableProps) {
  const [rows, setRows] = useState<RunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([api.simulation.plans(), api.analytics.kpiSeries().catch(() => [] as KpiBundle[])])
      .then(([plans, series]) => { if (alive) setRows(mergeRuns(plans, series)) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'нет связи') })
    return () => { alive = false }
  }, [currentId])

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : [s[1], id]))
  const visible = useMemo(() => (rows ? (showAll ? rows : rows.slice(0, limit)) : []), [rows, showAll, limit])
  const columns = sel.map((id) => rows?.find((r) => r.id === id)).filter((r): r is RunRow => Boolean(r)).map((r) => ({ id: r.id, title: fmtDate(r.createdAt), item: r }))

  if (error) return <p className="pl-note">История прогонов недоступна: {error}</p>
  if (!rows) return <SkeletonRows rows={4} label="Загрузка прогонов" />
  if (rows.length === 0) return <p className="pl-note">Прогонов ещё нет — постройте первый план через «Новый план».</p>
  return (
    <div className="pl-runs">
      <table className="plan__rules pl-runs__table">
        <thead>
          <tr>
            <th aria-label="Сравнить" title="Отметьте два прогона для сравнения" />
            <th>Когда</th><th>Операций</th><th>E[Cmax]</th><th>CVaR</th><th>OTD</th><th>Загрузка</th><th>Узкое место</th><th />
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const otd = kpiOf(r.kpi, 'otd')
            return (
              <tr key={r.id} className={r.id === currentId ? 'chosen' : ''}>
                <td><input type="checkbox" aria-label={`сравнить прогон ${fmtDate(r.createdAt)}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="num">{fmtDate(r.createdAt)}{r.id === currentId && <Chip tone="accent">текущий</Chip>}</td>
                <td className="num">{num(r.nTasks, 0)}</td>
                <td className="num">{hours(kpiOf(r.kpi, 'makespan_mean') || r.makespan, 0)}</td>
                <td className="num">{hours(kpiOf(r.kpi, 'makespan_cvar'), 0)}</td>
                <td className="num">{Number.isFinite(otd) ? <Chip tone={otd >= 0.99 ? 'good' : otd >= 0.9 ? 'warn' : 'bad'}>{pct(otd, 0)}</Chip> : '—'}</td>
                <td className="num">{pct(kpiOf(r.kpi, 'utilization'), 0)}</td>
                <td>{r.kpi?.bottleneck?.wc_name ?? '—'}</td>
                <td>{onOpen && r.kpi && <button type="button" className="btn btn--sm" onClick={() => onOpen(r)}>KPI</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > limit && (
        <button type="button" className="pf-link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'свернуть' : `показать все ${rows.length}`}
        </button>
      )}
      {columns.length === 2 && (
        <section className="pl-runs__cmp" aria-label="Сравнение прогонов">
          <DiffTable columns={columns} rows={COMPARE_ROWS} caption="Сравнение A / B — только отличающиеся KPI; лучше — зелёным" />
        </section>
      )}
    </div>
  )
}
