/**
 * Вкладка «Прогон» (X2 P-36, P-37, P-40): прогоны — 3 строки + «все N» (Когда · Операций · В срок;
 * ▲ «под риском» только ниже 90 %), живые показатели, выбранный в сцене объект, одна строка о
 * нехватке операторов, свёрнутые «Обозначения (N)», итог прогона с единственной заливной кнопкой —
 * следующим шагом «Результаты». Плеер — в полосе времени внизу канваса.
 */
import type { ReactNode } from 'react'
import { Chip, DataTable, ErrorBanner, IconButton, type DataColumn } from '../../ui/kit'
import { Legend, type LegendItem } from '../../ui/charts'
import { countText, num, pct } from '../../explain/format'
import { fmtRunDate, type SimRun } from './simModel'
import type { SimSession } from './useSimSession'

/** Порог «под риском»: доля заказов в срок ниже 90 %. */
const OTD_RISK = 0.9
const RUN_ROWS = 3
const TYPE_FORMS = ['тип', 'типа', 'типов'] as const
const OP_FORMS = ['операция', 'операции', 'операций'] as const

const COLUMNS: ReadonlyArray<DataColumn<SimRun>> = [
  { key: 'createdAt', title: 'Когда', rowHeader: true, get: (r) => r.createdAt, render: (r) => fmtRunDate(r.createdAt) },
  { key: 'nTasks', title: 'Операций', num: true, get: (r) => r.nTasks, render: (r) => num(r.nTasks, 0) },
  { key: 'otd', title: 'В срок', num: true, get: (r) => (Number.isFinite(r.otd) ? r.otd : null), hint: 'Доля заказов в срок (OTD)',
    render: (r) => (!Number.isFinite(r.otd) ? <span className="sim__muted" title="KPI прогона не сохранены">—</span>
      : r.otd < OTD_RISK ? <Chip size="sm" tone="setup">{pct(r.otd, 0)} под риском</Chip> : pct(r.otd, 0)) },
]

interface SimulationRunsProps {
  session: SimSession
  /** Объект, выбранный в сцене (занятость, очередь, текущая операция). */
  nodeInfo: ReactNode
  legend: ReadonlyArray<LegendItem>
  onResults: () => void
}

export function SimulationRuns({ session, nodeInfo, legend, onResults }: SimulationRunsProps) {
  const { runs, runsError, planId, meta, live, labor } = session
  const finished = !!meta && meta.n > 0 && live.done >= meta.n
  return (
    <div className="dk-stack sim__stack">
      {runsError ? (
        <ErrorBanner title="История прогонов не загрузилась" error={runsError} onRetry={session.reloadRuns} />
      ) : runs && runs.length > 0 && (
        <div className="sim__runs">
          <DataTable columns={COLUMNS} rows={runs} rowKey={(r) => r.id} tight caption="Прогоны: выберите план" limit={RUN_ROWS}
                     onRowClick={(r) => session.loadPlan(r.id)} rowClassName={(r) => (r.id === planId ? 'is-chosen' : undefined)}
                     rowTitle={() => 'Проиграть этот план'} />
        </div>
      )}

      {session.planError !== null && session.planError !== undefined && (
        <ErrorBanner title="План для симуляции не загрузился" error={session.planError} onRetry={() => session.loadPlan(planId || undefined)} />
      )}

      {meta?.planId && (
        <dl className="sim__live" aria-live="off">
          <div><dt>Занято станков</dt><dd className="num">{num(live.busy, 0)} <small>пик {num(live.peakBusy, 0)}</small></dd></div>
          <div title={`${num(live.done, 0)} из ${countText(meta.n, OP_FORMS)}`}><dt>Выполнено</dt><dd className="num">{pct(meta.n ? live.done / meta.n : 0, 0)}</dd></div>
        </dl>
      )}

      {nodeInfo}

      {labor && labor.length > 0 && (
        <ErrorBanner tone="setup"
                     title={`Операторов с допуском не хватает на ${countText(labor.length, TYPE_FORMS)} оборудования`}
                     message={<a className="ep-link" href="#/nsi/worker">подробнее → Справочники › Рабочие</a>} />
      )}

      <details className="sim__legend">
        <summary>Обозначения ({num(legend.length, 0)})</summary>
        <Legend items={legend} className="sim__legend-list" />
      </details>

      {finished && meta && (
        <div className="sim__done" role="status">
          <div className="sim__done-title">Прогон завершён</div>
          <div className="sim__done-meta">пик занятости — {countText(live.peakBusy, ['станок', 'станка', 'станков'])}</div>
          <IconButton icon="chart" variant="primary" size="sm" onClick={onResults}>Результаты</IconButton>
        </div>
      )}
    </div>
  )
}
