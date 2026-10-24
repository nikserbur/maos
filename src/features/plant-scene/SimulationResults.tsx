/**
 * Вкладка «Результаты» (X2 P-37): одна правда о рабочих («Всего хватает (нужно 41 из 84), но по
 * допускам не хватает на 3 типа»), загрузка и занятые операторы во времени (chart-система),
 * загрузка по станкам; единственная заливная кнопка — следующий шаг «Записать в справочники».
 */
import { EmptyState, IconButton, SkeletonRows } from '../../ui/kit'
import { AreaChart, BarList, type BarRow } from '../../ui/charts'
import { countText, hours, num, pct } from '../../explain/format'
import type { SimResults } from '../../lib/api'
import type { LaborLoad } from '../nsi/labor'
import { OVERLOAD } from './sceneOps'

const TOP_MACHINES = 12
const TYPE_FORMS = ['тип', 'типа', 'типов'] as const

/** Итог по рабочим одной фразой: сколько нужно, сколько есть, и где не хватает допусков. */
export function workersVerdict(required: number, total: number, short: number | null): string {
  const enough = total >= required
  const head = enough
    ? `Всего хватает (нужно ${num(required, 0)} из ${num(total, 0)})`
    : `Не хватает: нужно ${num(required, 0)}, в справочнике ${num(total, 0)}`
  if (short === null || short === 0) return `${head}${enough && short === 0 ? ', и допусков достаточно' : ''}.`
  return `${head}, ${enough ? 'но ' : ''}по допускам не хватает на ${countText(short, TYPE_FORMS)}.`
}

interface SimulationResultsProps {
  res: SimResults | null | undefined
  error: unknown
  labor: LaborLoad[] | null
  onRetry: () => void
  onCalib: () => void
}

export function SimulationResults({ res, error, labor, onRetry, onCalib }: SimulationResultsProps) {
  if (error) {
    return <EmptyState size="sm" kind="unavailable" title="Результаты прогона не загрузились"
                       action={<button type="button" className="btn btn--sm" onClick={onRetry}>Повторить</button>}>Проверьте, что сервер запущен.</EmptyState>
  }
  if (res === undefined) return <SkeletonRows rows={4} cols={3} label="Загрузка результатов" />
  if (!res || res.n_machines === 0) {
    return <EmptyState size="sm" variant="chart" kind="first-use" title="Нет данных прогона">Постройте план на экране «План» и проиграйте его.</EmptyState>
  }

  const labels = res.util_series.map((p) => hours(p.t, 0))
  const workerLabels = res.workers_series.map((p) => hours(p.t, 0))
  const top: BarRow[] = res.per_machine.slice().sort((a, b) => b.utilization - a.utilization).slice(0, TOP_MACHINES)
    .map((m) => ({ key: m.machine_id, label: m.name, labelText: m.name, value: m.utilization, marked: m.utilization >= OVERLOAD }))

  return (
    <div className="dk-stack sim__stack">
      <p className="sim__verdict">{workersVerdict(res.required_operators, res.n_workers, labor ? labor.length : null)}</p>
      <dl className="sim__live">
        <div><dt>Загрузка, средняя</dt><dd className="num">{pct(res.avg_utilization, 0)}</dd></div>
        <div><dt>Проходка</dt><dd className="num">{num(res.throughput_per_day, 1)} <small>партий в день</small></dd></div>
      </dl>

      <AreaChart title="Загрузка оборудования во времени" height={140} labels={labels}
                 series={[{ key: 'util', name: 'Загрузка', values: res.util_series.map((p) => p.util), fmt: (v) => pct(v, 0) }]}
                 fmtY={(v) => pct(v, 0)} ariaLabel="Загрузка оборудования по модельному времени" />
      <AreaChart title="Занятые операторы" subtitle={`пик ${num(res.required_operators, 0)}`} height={140} labels={workerLabels}
                 series={[{ key: 'ops', name: 'Операторы', values: res.workers_series.map((p) => p.workers), fmt: (v) => num(v, 0) }]}
                 fmtY={(v) => num(v, 0)} ariaLabel="Занятые операторы по модельному времени" />
      <BarList title={`Загрузка по станкам · топ-${num(TOP_MACHINES, 0)}`} rows={top} max={1} fmt={(v) => pct(v, 0)}
               valueHeader="Загрузка" ariaLabel="Загрузка станков за прогон" compact />

      <div className="sim__next">
        <p className="sim__note">Наблюдаемые длительности операций можно записать в нормативы — с подтверждением и «Отменить».</p>
        <IconButton icon="check" variant="primary" size="sm" onClick={onCalib}>Записать в справочники…</IconButton>
      </div>
    </div>
  )
}
