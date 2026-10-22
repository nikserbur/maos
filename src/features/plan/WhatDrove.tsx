/**
 * «Что определило результат» (UX-V2 §4.2 шаг 7): 3–5 узлов карты с наибольшим вкладом —
 * хвост длительностей (CVaR − E), календарь (фонд против 24×7), труд (операторов меньше станков),
 * ГА (принят/отклонён), ручные пины, узкое место. Каждый — с переходом на узел карты.
 * Чистая функция `driversOf` — вклад оценивается по полям ответа /api/schedule, без догадок.
 */
import type { ScheduleResult } from '../../lib/api'
import { hours, num, pct } from '../../explain/format'
import './plan-screen.css'

export interface Driver {
  id: string
  title: string
  /** Относительная сила 0…1 для полосы. */
  weight: number
  detail: string
  mapNode: string
  tone: 'warn' | 'good' | 'neutral'
}

export function driversOf(r: ScheduleResult, pins: number): Driver[] {
  const k = r.kpi
  const out: Driver[] = []
  const tail = k.makespan_mean > 0 ? k.makespan_cvar / k.makespan_mean - 1 : 0
  out.push({
    id: 'tail', title: 'Хвост длительностей', weight: Math.min(1, tail / 0.5),
    detail: `CVaR на ${pct(tail, 0)} выше E[Cmax] · ${num(r.samples, 0)} прогонов`, mapNode: 'dist.durations', tone: tail > 0.25 ? 'warn' : 'neutral',
  })
  if (r.calendar.enabled && r.calendar.work_fond_hours > 0 && r.n_machines > 0) {
    const full = r.n_machines * k.makespan
    const share = full > 0 ? 1 - r.calendar.work_fond_hours / full : 0
    out.push({
      id: 'calendar', title: 'Календарь смен', weight: Math.min(1, Math.max(0, share) * 1.5),
      detail: `фонд ${hours(r.calendar.work_fond_hours, 0)} вместо ${hours(full, 0)} при 24×7`, mapNode: 'int.capacity', tone: share > 0.4 ? 'warn' : 'neutral',
    })
  }
  if (r.n_workers > 0 && r.n_workers < r.n_machines) {
    out.push({
      id: 'labor', title: 'Операторов меньше станков', weight: Math.min(1, 1 - r.n_workers / r.n_machines),
      detail: `параллельно не больше ${r.n_workers} из ${r.n_machines} станков`, mapNode: 'int.labor', tone: 'warn',
    })
  }
  out.push({
    id: 'bottleneck', title: `Узкое место: ${r.bottleneck.wc_name}`, weight: Math.min(1, r.bottleneck.utilization),
    detail: `загрузка ${pct(r.bottleneck.utilization, 0)} · очередь — ${pct(k.wait_share ?? 0, 0)} времени потока`, mapNode: 'int.capacity', tone: r.bottleneck.utilization > 0.85 ? 'warn' : 'neutral',
  })
  if (r.improver) {
    const imp = r.improver.validation?.improvement_pct ?? r.improver.improvement_pct
    out.push({
      id: 'ga', title: r.improver.adopted ? 'ГА принят' : 'ГА отклонён (нет выигрыша вне выборки)', weight: Math.min(1, Math.abs(imp) / 10),
      detail: `${imp >= 0 ? '+' : ''}${num(imp, 1)} % к F на отложенных сценариях · правило ${r.rule}`, mapNode: 'dec.schedule', tone: r.improver.adopted ? 'good' : 'neutral',
    })
  }
  if (pins > 0) out.push({ id: 'pins', title: 'Ручные правки Ганта', weight: Math.min(1, pins / 10), detail: `${pins} пин(ов) «не раньше»`, mapNode: 'dec.schedule', tone: 'neutral' })
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5)
}

export function WhatDrove({ result, pins }: { result: ScheduleResult; pins: number }) {
  const drivers = driversOf(result, pins)
  return (
    <section className="pl-drove" aria-label="Что определило результат">
      <p className="pl-drove__eyebrow text-caps">Что определило результат</p>
      <ol className="pl-drove__list">
        {drivers.map((d) => (
          <li key={d.id} className={`pl-drove__row is-${d.tone}`}>
            <a className="pl-drove__title" href={`#/map/${d.mapNode}`} title="Узел на карте методологии">{d.title} ↗</a>
            <span className="pl-drove__bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.04, d.weight)})` }} /></span>
            <span className="pl-drove__detail">{d.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
