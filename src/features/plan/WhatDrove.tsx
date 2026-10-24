/**
 * «Почему так» (UX-V2 §4.2 шаг 7; X2 — внутри секции «Узкое место»): 3–5 узлов карты с наибольшим вкладом —
 * хвост длительностей (CVaR − E), календарь (фонд против 24×7), труд (операторов меньше станков),
 * генетический алгоритм (принят/отклонён), ручные пины, узкое место. Каждый — с переходом на узел карты.
 * Чистая функция `driversOf` — вклад оценивается по полям ответа /api/schedule, без догадок.
 */
import { useState } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { hours, num, pct, plural } from '../../explain/format'
import { Meter, type MeterTone } from '../../ui/charts'
import { DataTable, type DataColumn } from '../../ui/kit'
import { GaImproverCard } from './GaImproverCard'
import { ruleWords } from './ruleWords'
import './plan-screen.css'

/** Сила драйвера — метр: отклонение — предупреждающий тон; выигрыш и норма — нейтрально (цвет — только у отклонений). */
const DRIVER_TONE: Record<Driver['tone'], MeterTone> = { warn: 'warn', good: 'neutral', neutral: 'neutral' }

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
    detail: `в худших сценариях план на ${pct(tail, 0)} длиннее среднего`, mapNode: 'dist.durations', tone: tail > 0.25 ? 'warn' : 'neutral',
  })
  if (r.calendar.enabled && r.calendar.work_fond_hours > 0 && r.n_machines > 0) {
    const full = r.n_machines * k.makespan
    const share = full > 0 ? 1 - r.calendar.work_fond_hours / full : 0
    out.push({
      id: 'calendar', title: 'Календарь смен', weight: Math.min(1, Math.max(0, share) * 1.5),
      detail: `фонд станков ${hours(r.calendar.work_fond_hours, 0)} по календарю смен (не 24×7)`, mapNode: 'int.capacity', tone: share > 0.4 ? 'warn' : 'neutral',
    })
  }
  if (r.n_workers > 0 && r.n_workers < r.n_machines) {
    out.push({
      id: 'labor', title: 'Операторов меньше станков', weight: Math.min(1, 1 - r.n_workers / r.n_machines),
      detail: `одновременно работает не больше ${num(r.n_workers, 0)} станков (по числу операторов)`, mapNode: 'int.labor', tone: 'warn',
    })
  }
  out.push({
    id: 'bottleneck', title: `Узкое место: ${r.bottleneck.wc_name}`, weight: Math.min(1, r.bottleneck.utilization),
    detail: `очередь — ${pct(k.wait_share ?? 0, 0)} времени потока`, mapNode: 'int.capacity', tone: r.bottleneck.utilization >= 0.85 ? 'warn' : 'neutral',
  })
  if (r.improver) {
    const imp = r.improver.validation?.improvement_pct ?? r.improver.improvement_pct
    out.push({
      id: 'ga', title: r.improver.adopted ? 'Генетический алгоритм принят' : 'Генетический алгоритм отклонён (нет выигрыша вне выборки)',
      weight: Math.min(1, Math.abs(imp) / 10),
      detail: `${imp >= 0 ? '+' : ''}${num(imp, 1)} % к целевой функции вне выборки · правило «${ruleWords(r.rule)}»`, mapNode: 'dec.schedule', tone: r.improver.adopted ? 'good' : 'neutral',
    })
  }
  if (pins > 0) out.push({ id: 'pins', title: 'Ручные правки Ганта', weight: Math.min(1, pins / 10), detail: `${num(pins, 0)} ${plural(pins, 'правка', 'правки', 'правок')} «не раньше»`, mapNode: 'dec.schedule', tone: 'neutral' })
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5)
}

/**
 * «Почему так» внутри секции «Узкое место» (X2): причины результата таблицей — фактор (переход на узел
 * карты) · сила · что это значит. Само узкое место — в баннере над таблицей, здесь не дублируется.
 */
export function WhatDrove({ result, pins }: { result: ScheduleResult; pins: number }) {
  const drivers = driversOf(result, pins).filter((d) => d.id !== 'bottleneck')
  const [gaOpen, setGaOpen] = useState(false)
  const hasGa = Boolean(result.improver && result.improver.method === 'ga' && result.improver.validation)
  const cols: DataColumn<Driver>[] = [
    { key: 'title', title: 'Почему так', rowHeader: true, primary: true, sortable: false,
      render: (d) => <a className="pl-drove__title" href={`#/map/${d.mapNode}`} title="Узел на карте методологии">{d.title} ↗</a> },
    { key: 'weight', title: 'Сила', sortable: false, className: 'pl-drove__bar',
      render: (d) => <Meter value={Math.max(0.04, d.weight)} tone={DRIVER_TONE[d.tone]} label={`Относительная сила: ${pct(d.weight, 0)}`} /> },
    { key: 'detail', title: 'Что это значит', sortable: false, minWidth: 20,
      render: (d) => (
        <span className="pl-drove__detail">
          {d.tone === 'warn' && <span className="glyph-setup" aria-hidden="true" />}{d.detail}
          {d.id === 'ga' && hasGa && (
            <button type="button" className="pf-link pl-drove__more" aria-expanded={gaOpen} onClick={() => setGaOpen((v) => !v)}>
              {gaOpen ? 'скрыть детали' : 'детали'}
            </button>
          )}
        </span>
      ) },
  ]
  if (drivers.length === 0) return null
  return (
    <div className="pl-drove">
      <DataTable columns={cols} rows={drivers} rowKey={(d) => d.id} tight caption="Почему так: причины результата" />
      {gaOpen && result.improver && <GaImproverCard imp={result.improver} rule={result.rule} />}
    </div>
  )
}
