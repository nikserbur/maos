/**
 * Вкладка «Результаты»: показатели прогона, загрузка во времени и занятые операторы
 * (AreaChart chart-системы), загрузка по станкам (BarList), рекомендация в НСИ.
 */
import { EmptyState, IconButton, SkeletonRows } from '../../ui/kit'
import { AreaChart, BarList, type BarRow } from '../../ui/charts'
import { hours, num, pct } from '../../explain/format'
import type { SimResults } from '../../lib/api'
import { SimKpi } from './SimKpi'

const TOP_MACHINES = 12
/** Порог загрузки, выше которого станок считается узким местом. */
const HOT_UTIL = 0.85

interface SimulationResultsProps {
  res: SimResults | null | undefined
  onCalib: () => void
}

export function SimulationResults({ res, onCalib }: SimulationResultsProps) {
  if (res === undefined) return <SkeletonRows rows={4} cols={3} label="Загрузка результатов" />
  if (!res || res.n_machines === 0) {
    return <EmptyState size="sm" variant="chart" title="Нет данных прогона">Постройте план на экране «План» и проиграйте его.</EmptyState>
  }

  const labels = res.util_series.map((p) => hours(p.t, 0))
  const workerLabels = res.workers_series.map((p) => hours(p.t, 0))
  const top: BarRow[] = res.per_machine.slice().sort((a, b) => b.utilization - a.utilization).slice(0, TOP_MACHINES)
    .map((m) => ({ key: m.machine_id, label: m.name, labelText: m.name, value: m.utilization, marked: m.utilization > HOT_UTIL }))
  const surplus = res.n_workers - res.required_operators

  return (
    <div className="dk-stack sim__stack">
      <div className="sim__kpis">
        <SimKpi hero k="Требуется операторов" v={num(res.required_operators, 0)} sub={`ср. ${num(res.avg_operators, 1)}`} />
        <SimKpi k="В справочнике" v={num(res.n_workers, 0)} />
        <SimKpi k="Загрузка (ср.)" v={pct(res.avg_utilization, 0)} />
        <SimKpi k="Станков" v={num(res.n_machines, 0)} />
        <SimKpi k="Проходка" v={num(res.throughput_per_day, 1)} sub="парт/дн" />
      </div>

      <AreaChart title="Загрузка оборудования во времени" height={150} labels={labels}
                 series={[{ key: 'util', name: 'Загрузка', values: res.util_series.map((p) => p.util), fmt: (v) => pct(v, 0) }]}
                 fmtY={(v) => pct(v, 0)} ariaLabel="Загрузка оборудования по модельному времени" />
      <AreaChart title="Занятые операторы" subtitle={`пик ${num(res.required_operators, 0)}`} height={150} labels={workerLabels}
                 series={[{ key: 'ops', name: 'Операторы', values: res.workers_series.map((p) => p.workers), color: 'var(--chart-5)', fmt: (v) => num(v, 0) }]}
                 fmtY={(v) => num(v, 0)} ariaLabel="Занятые операторы по модельному времени" />
      <BarList title={`Загрузка по станкам · топ-${num(TOP_MACHINES, 0)}`} rows={top} max={1} fmt={(v) => pct(v, 0)}
               valueHeader="Загрузка" ariaLabel="Загрузка станков за прогон" compact />

      <div className="sim__nsi">
        <div className="sim__nsi-title glyph-info">Рекомендация в НСИ</div>
        <p className="sim__nsi-text">
          Для этого плана достаточно <b className="num">{num(res.required_operators, 0)}</b> операторов (пик одновременной занятости).
          {surplus > 1 && ` В справочнике их ${num(res.n_workers, 0)} — ${num(surplus, 0)} избыточны для этого объёма.`}
          {' '}Наблюдаемые длительности операций можно записать в нормативы.
        </p>
        <IconButton icon="gear" variant="primary" size="sm" onClick={onCalib}>Калибровка норм НСИ</IconButton>
      </div>
    </div>
  )
}
