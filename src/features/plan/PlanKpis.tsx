/**
 * KPI построенного плана — bento-сетка: герой-плитка «Длина расписания» (E[Cmax] + хвост
 * CVaR), сроки, разложение фонда станков, поток, затраты. Каждый показатель — с «i»
 * (src/explain/metrics.plan.ts), значения — из живых полей ответа /api/schedule.
 */
import type { ScheduleResult } from '../../lib/api'
import { hours, money, num, pct } from '../../explain/format'
import { Chip } from './ui'
import { FmtValue, FundBar, SubLabel, Sparkline, TailStrip, Tile, Value, type FundParts } from './kpiParts'
import { kpiOf, loadsOf, machineBusyHours, machineFundHours, type Tone } from './types'
import './kpi.css'

const OTD_GOOD = 0.99
const OTD_WARN = 0.9
const WAIT_WARN = 0.5
const LATE_EPS_H = 0.05

const otdTone = (otd: number): Tone => (otd >= OTD_GOOD ? 'good' : otd >= OTD_WARN ? 'warn' : 'bad')

/** Разложение Σ фонда станков (детерминированное расписание); null — старый ответ без фонда. */
function fundParts(r: ScheduleResult): FundParts | null {
  const rows = loadsOf(r.machine_load)
  if (!rows.some((l) => typeof l.fund_hours === 'number')) return null
  const sum = (f: (l: (typeof rows)[number]) => number | undefined) => rows.reduce((a, l) => a + (f(l) ?? 0), 0)
  return { busy: sum((l) => l.busy_hours), setup: sum((l) => l.setup_hours), down: sum((l) => l.downtime_hours), idle: sum((l) => l.idle_hours) }
}

export function PlanKpis({ result }: { result: ScheduleResult }) {
  const k = kpiOf(result)
  const n = result.n_orders
  const fund = machineFundHours(result)
  const busy = machineBusyHours(result)
  const parts = fundParts(result)
  const qty = result.program.reduce((a, o) => a + (o.qty || 0), 0)
  const repair = k.breakdown_hours_mean ?? 0
  const maint = k.maintenance_hours ?? 0
  const horizon = result.portfolio_horizon_hours ?? 0
  const tailPct = k.makespan_mean > 0 ? k.makespan_cvar / k.makespan_mean - 1 : 0
  const late = k.tardiness > LATE_EPS_H
  const wait = k.wait_share ?? 0

  const cvarChip = horizon > 0
    ? (k.makespan_cvar > horizon
      ? <Chip tone="bad">не вписывается в горизонт Стадии 2 · {hours(horizon, 0)}</Chip>
      : <Chip tone="good">в горизонте Стадии 2 · {hours(horizon, 0)}</Chip>)
    : <Chip tone="accent">хвост +{pct(tailPct)} к E</Chip>

  return (
    <div className="pl-bento">
      <Tile metric="plan.makespan" label="Длина расписания · E[Cmax]" span="s5" hero
            values={{ mean: k.makespan_mean, det: k.makespan, n: result.samples }}
            status={<Chip>{num(result.samples, 0)} прогонов</Chip>}>
        <FmtValue text={hours(k.makespan_mean)} />
        <div className="pl-tile__sub">
          детерминированное (диаграмма Ганта) <span className="num">{hours(k.makespan)}</span>
          {' '}≈ <span className="num">{num(k.makespan_mean / 24, 1)}</span> сут
        </div>
        <TailStrip det={k.makespan} mean={k.makespan_mean} cvar={k.makespan_cvar} worst={k.makespan_worst} />
        <div className="pl-tile__div" />
        <div className="pl-tile__k">
          <SubLabel metric="plan.makespan_cvar" label={`CVaR · α = ${pct(result.alpha, 0)}`}
                    values={{ cvar: k.makespan_cvar, worst: k.makespan_worst, alpha: result.alpha, n: result.samples }} />
          {cvarChip}
        </div>
        <FmtValue text={hours(k.makespan_cvar)} size="md" />
        <div className="pl-tile__sub">худший прогон <span className="num">{hours(k.makespan_worst)}</span></div>
      </Tile>

      <Tile metric="plan.otd" label="Заказы в срок · OTD" values={{ otd: k.otd, n, n_late: k.n_late }}
            status={<Chip tone={otdTone(k.otd)}>{k.otd >= OTD_GOOD ? 'все в срок' : `${k.n_late} с опозданием`}</Chip>}>
        <Value text={num(k.otd * 100, k.otd >= OTD_GOOD ? 0 : 1)} unit="%" />
        <div className="pl-meter" aria-hidden="true">
          <span className={`pl-meter__fill${otdTone(k.otd) === 'good' ? '' : ` pl-meter__fill--${otdTone(k.otd)}`}`}
                style={{ transform: `scaleX(${Math.max(0, Math.min(1, k.otd))})` }} />
        </div>
        <div className="pl-tile__sub">в срок <span className="num">{n - k.n_late}</span> из <span className="num">{n}</span> заказов</div>
      </Tile>

      <Tile metric="plan.tardiness" label="Суммарная просрочка" span="s4"
            values={{ tard: k.tardiness, tard_cvar: k.tardiness_cvar, n_late: k.n_late }}
            status={<Chip tone={late ? 'bad' : 'good'}>{late ? 'есть просрочка' : 'без просрочки'}</Chip>}>
        <FmtValue text={hours(k.tardiness)} />
        <div className="pl-tile__sub">
          CVaR по прогонам <span className="num">{hours(k.tardiness_cvar)}</span> · просрочено заказов <span className="num">{k.n_late}</span>
        </div>
      </Tile>

      <Tile metric="plan.utilization" label="Загрузка оборудования" span="s7"
            values={{ util: k.utilization, busy, fund, n_machines: result.n_machines }}
            status={<Chip>{result.n_machines} станков</Chip>}>
        <div className="pl-tile__pair">
          <div><FmtValue text={pct(k.utilization)} /></div>
          <div>
            <SubLabel metric="plan.setup_share" label="Доля переналадок"
                      values={{ share: k.setup_share, setup: k.setup_hours, fund, n_setups: k.n_setups }} />
            <FmtValue text={pct(k.setup_share)} size="md" />
            <div className="pl-tile__sub"><span className="num">{k.n_setups ?? 0}</span> переналадок · <span className="num">{hours(k.setup_hours ?? 0)}</span></div>
          </div>
          <div>
            <SubLabel metric="plan.availability" label="Готовность К̂г"
                      values={{ avail: k.availability, maint, repair, fund }} />
            <FmtValue text={pct(k.availability)} size="md" />
            <div className="pl-tile__sub">ТО и ремонты — не занятость</div>
          </div>
        </div>
        {parts && <FundBar {...parts} />}
      </Tile>

      <Tile metric="plan.throughput" label="Темп выпуска"
            values={{ th: k.throughput_per_day, qty, cmax: k.makespan }}>
        <Value text={num(k.throughput_per_day ?? 0)} unit="ед./сут" />
        <div className="pl-tile__sub">
          <span className="num">{num(k.orders_per_day)}</span> заказ/сут · выпуск <span className="num">{num(qty, 0)}</span> ед.
        </div>
      </Tile>

      <Tile metric="plan.wip" label="Задел (НЗП)"
            values={{ wip: k.wip_avg, n, cmax: k.makespan, flow: k.flow_time_mean_h }}>
        <Value text={num(k.wip_avg ?? 0, 1)} unit="заказов" />
        <div className="pl-tile__sub">в среднем одновременно в работе (L = λ·W)</div>
      </Tile>

      <Tile metric="plan.flow_time" label="Время потока заказа" values={{ flow: k.flow_time_mean_h, n }}>
        <FmtValue text={hours(k.flow_time_mean_h ?? 0)} />
        <div className="pl-tile__sub">от первой до последней операции, среднее</div>
      </Tile>

      <Tile metric="plan.wait_share" label="Доля ожидания" values={{ share: k.wait_share }}
            status={wait > WAIT_WARN ? <Chip tone="warn">очереди доминируют</Chip> : undefined}>
        <FmtValue text={pct(wait)} />
        {result.queue_timeline && <Sparkline points={result.queue_timeline} label="Очередь операций во времени" />}
      </Tile>

      <Tile metric="plan.cost" label="Себестоимость работ" span="s4" values={{ cost: k.cost, n_jobs: result.n_jobs }}>
        <FmtValue text={money(k.cost)} />
        <div className="pl-tile__sub"><span className="num">{num(result.n_jobs, 0)}</span> операций · без материалов</div>
      </Tile>

      <Tile metric="plan.labor_cost" label="Затраты на труд" span="s4" values={{ labor: k.labor_cost }}>
        <FmtValue text={money(k.labor_cost ?? 0)} />
        <div className="pl-tile__sub">по назначениям <span className="num">{result.n_workers}</span> рабочих</div>
      </Tile>

      <Tile metric="plan.maintenance" label="Плановое ТО и ремонты" span="s4"
            values={{ maint, repair, n: result.samples }}>
        <FmtValue text={hours(maint + repair)} />
        <div className="pl-tile__sub">
          ТО <span className="num">{hours(maint)}</span> · ремонты (ср. по прогонам) <span className="num">{hours(repair)}</span>
        </div>
      </Tile>
    </div>
  )
}
