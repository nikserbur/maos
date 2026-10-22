/**
 * Ярус C KPI плана (X1 §5 п. 5): остальные показатели одной свёрнутой таблицей
 * «показатель · значение · контекст» — как реестр в Аналитике. Все показатели из прежней
 * bento-сетки сохранены (просрочка, загрузка с разложением фонда, переналадки, готовность,
 * темп, задел, поток, ожидание, себестоимость, труд, ТО/ремонты) плюс то, что раньше жило
 * чипами баннера узкого места (простой, календарь). Каждая строка — с «i».
 */
import type { ReactNode } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { hours, money, num, pct } from '../../explain/format'
import { InfoTip, type InfoTipValues } from '../../ui/InfoTip'
import { FundBar, type FundParts } from './kpiParts'
import { Chip } from '../../ui/kit'
import { kpiOf, loadsOf, machineBusyHours, machineFundHours, type Tone } from './types'

const WAIT_WARN = 0.5
const LATE_EPS_H = 0.05

interface Row {
  id: string
  metric: string
  label: string
  values: InfoTipValues
  value: string
  context: ReactNode
  tone?: Tone
}

/** Разложение Σ фонда станков (детерминированное расписание); null — старый ответ без фонда. */
function fundParts(r: ScheduleResult): FundParts | null {
  const rows = loadsOf(r.machine_load)
  if (!rows.some((l) => typeof l.fund_hours === 'number')) return null
  const sum = (f: (l: (typeof rows)[number]) => number | undefined) => rows.reduce((a, l) => a + (f(l) ?? 0), 0)
  return { busy: sum((l) => l.busy_hours), setup: sum((l) => l.setup_hours), down: sum((l) => l.downtime_hours), idle: sum((l) => l.idle_hours) }
}

export function kpiRows(r: ScheduleResult): Row[] {
  const k = kpiOf(r)
  const n = r.n_orders
  const fund = machineFundHours(r)
  const busy = machineBusyHours(r)
  const parts = fundParts(r)
  const qty = r.program.reduce((a, o) => a + (o.qty || 0), 0)
  const repair = k.breakdown_hours_mean ?? 0
  const maint = k.maintenance_hours ?? 0
  const late = k.tardiness > LATE_EPS_H
  const wait = k.wait_share ?? 0
  return [
    { id: 'tard', metric: 'plan.tardiness', label: 'Суммарная просрочка', values: { tard: k.tardiness, tard_cvar: k.tardiness_cvar, n_late: k.n_late },
      value: hours(k.tardiness), tone: late ? 'bad' : 'good',
      context: <>CVaR по прогонам <span className="num">{hours(k.tardiness_cvar)}</span> · просрочено заказов <span className="num">{num(k.n_late, 0)}</span></> },
    { id: 'util', metric: 'plan.utilization', label: 'Загрузка оборудования', values: { util: k.utilization, busy, fund, n_machines: r.n_machines },
      value: pct(k.utilization), context: parts ? <FundBar {...parts} /> : <>{num(r.n_machines, 0)} станков · обработка <span className="num">{hours(busy, 0)}</span></> },
    { id: 'setup', metric: 'plan.setup_share', label: 'Доля переналадок', values: { share: k.setup_share, setup: k.setup_hours, fund, n_setups: k.n_setups },
      value: pct(k.setup_share), context: <><span className="num">{num(k.n_setups ?? 0, 0)}</span> переналадок · <span className="num">{hours(k.setup_hours ?? 0)}</span></> },
    { id: 'avail', metric: 'plan.availability', label: 'Готовность К̂г', values: { avail: k.availability, maint, repair, fund },
      value: pct(k.availability), context: 'ТО и ремонты — не занятость' },
    { id: 'th', metric: 'plan.throughput', label: 'Темп выпуска', values: { th: k.throughput_per_day, qty, cmax: k.makespan },
      value: `${num(k.throughput_per_day ?? 0)} ед./сут`, context: <><span className="num">{num(k.orders_per_day)}</span> заказ/сут · выпуск <span className="num">{num(qty, 0)}</span> ед.</> },
    { id: 'wip', metric: 'plan.wip', label: 'Задел (НЗП)', values: { wip: k.wip_avg, n, cmax: k.makespan, flow: k.flow_time_mean_h },
      value: `${num(k.wip_avg ?? 0, 1)} заказов`, context: 'в среднем одновременно в работе (L = λ·W)' },
    { id: 'flow', metric: 'plan.flow_time', label: 'Время потока заказа', values: { flow: k.flow_time_mean_h, n },
      value: hours(k.flow_time_mean_h ?? 0), context: 'от первой до последней операции, среднее' },
    { id: 'wait', metric: 'plan.wait_share', label: 'Доля ожидания', values: { share: k.wait_share },
      value: pct(wait), tone: wait > WAIT_WARN ? 'warn' : undefined, context: wait > WAIT_WARN ? 'очереди доминируют — см. «Очереди»' : 'доля времени потока в очередях' },
    { id: 'cost', metric: 'plan.cost', label: 'Себестоимость работ', values: { cost: k.cost, n_jobs: r.n_jobs },
      value: money(k.cost), context: <><span className="num">{num(r.n_jobs, 0)}</span> операций · без материалов</> },
    { id: 'labor', metric: 'plan.labor_cost', label: 'Затраты на труд', values: { labor: k.labor_cost },
      value: money(k.labor_cost ?? 0), context: <>по назначениям <span className="num">{num(r.n_workers, 0)}</span> рабочих</> },
    { id: 'maint', metric: 'plan.maintenance', label: 'Плановое ТО и ремонты', values: { maint, repair, n: r.samples },
      value: hours(maint + repair), context: <>ТО <span className="num">{hours(maint)}</span> · ремонты (ср. по прогонам) <span className="num">{hours(repair)}</span></> },
    { id: 'idle', metric: 'plan.utilization', label: 'Простой станков', values: { util: k.utilization, busy, fund, n_machines: r.n_machines },
      value: hours(r.idle.machine_idle_hours), context: r.calendar.enabled ? <>календарь смен · фонд <span className="num">{hours(r.calendar.work_fond_hours, 0)}</span></> : 'календарь выключен · 24/7' },
  ]
}

export function KpiTable({ result }: { result: ScheduleResult }) {
  const rows = kpiRows(result)
  return (
    <details className="pl-more">
      <summary className="pl-more__sum">
        <span className="pl-more__caret" aria-hidden="true">▸</span>
        Остальные показатели <span className="num">{rows.length}</span>
        <span className="pl-more__hint">просрочка · загрузка и фонд · переналадки · поток · затраты · ТО</span>
      </summary>
      <table className="pl-table pl-table--tight pl-kpitable">
        <thead><tr><th scope="col">Показатель</th><th scope="col" className="num">Значение</th><th scope="col">Контекст</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="pl-td-name"><span className="pl-kpitable__label">{row.label}<InfoTip id={row.metric} values={row.values} /></span></td>
              <td className="num pl-kpitable__v">{row.tone ? <Chip tone={row.tone}>{row.value}</Chip> : row.value}</td>
              <td className="pl-kpitable__ctx">{row.context}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
