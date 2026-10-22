/**
 * Результат плана (UX-V2 §4.2 шаг 7): существующие PlanKpis + BottleneckBanner + GaImproverCard +
 * Гант / очереди / загрузка / правила / рабочие — с оглавлением (якоря) и двумя новыми карточками:
 * «Что определило результат» и касса (плитки CFaR / P(разрыва) / DSCR / PoL, транши). Пины →
 * «Пересчитать с правками» создаёт новый прогон, старый остаётся в истории.
 */
import { useState } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { Icon } from '../../shell/icons'
import { BottleneckBanner } from './BottleneckBanner'
import { CashTiles } from './CashTiles'
import { Gantt, orderColor } from './Gantt'
import { GaImproverCard } from './GaImproverCard'
import { LoadBars } from './LoadBars'
import { LoadTimeline } from './LoadTimeline'
import { PlanKpis } from './PlanKpis'
import { QueueChart } from './QueueChart'
import { ResultToc, type TocItem } from './ResultToc'
import { WhatDrove } from './WhatDrove'
import { Segmented } from './ui'
import './plan.css'
import './plan-screen.css'

const h1 = (v: number) => v.toFixed(1)
const pct = (v: number) => Math.round(v * 100) + '%'

export interface PlanResultProps {
  result: ScheduleResult
  pins: ReadonlyMap<number, number>
  onPin: (jobIdx: number, startHours: number) => void
  onClearPins: () => void
  onRerun: () => void
  running: boolean
  cash: { result: import('../../lib/api').CashLpResult | null; running: boolean; error: string | null; onRun: () => void }
  /** Доп. карточки сверху (например, «Сравнить с…»). */
  extra?: React.ReactNode
}

const TOC: readonly TocItem[] = [
  { id: 'res-kpi', label: 'KPI' }, { id: 'res-bn', label: 'Узкое место' }, { id: 'res-drove', label: 'Что определило' },
  { id: 'res-gantt', label: 'Гант' }, { id: 'res-queues', label: 'Очереди' }, { id: 'res-load', label: 'Загрузка' },
  { id: 'res-rules', label: 'Правила' }, { id: 'res-workers', label: 'Рабочие' }, { id: 'res-cash', label: 'Касса' },
]

/** Экспорт расписания в CSV (Excel-совместимый: BOM + «;»). */
export function exportScheduleCsv(result: ScheduleResult): void {
  const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`
  const rows = [
    ['Изделие', 'Операция', 'Тип РЦ', 'Станок', 'Начало, ч', 'Конец, ч', 'Срок, ч', 'Просрочка'],
    ...result.gantt.map((g) => [g.product_name, g.op_name, g.wc_name, g.machine_name, g.start.toFixed(2), g.end.toFixed(2), g.due.toFixed(2), g.late ? 'да' : '']),
  ]
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `план_расписание_${result.rule}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export function PlanResult({ result, pins, onPin, onClearPins, onRerun, running, cash, extra }: PlanResultProps) {
  const [loadView, setLoadView] = useState<'types' | 'machines' | 'time'>('types')
  return (
    <div className="pl-result">
      <ResultToc items={TOC} />
      <div className="pl-result__body">
        {extra}
        <section id="res-kpi" className="pl-result__sec"><PlanKpis result={result} /></section>
        <section id="res-bn" className="pl-result__sec">
          <BottleneckBanner result={result} />
          {result.improver && <GaImproverCard imp={result.improver} rule={result.rule} />}
        </section>
        <section id="res-drove" className="pl-result__sec"><WhatDrove result={result} pins={pins.size} /></section>

        <section id="res-gantt" className="pl-result__sec">
          <p className="plan__section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Диаграмма Ганта · {result.n_jobs} операций по станкам · полосы можно перетаскивать</span>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
              {pins.size > 0 && (
                <>
                  <span className="plan__pins"><Icon name="pin" size={14} /> ручных правок: {pins.size}</span>
                  <button className="btn btn--primary" style={{ height: 24, padding: '0 10px' }} onClick={onRerun} disabled={running}>Пересчитать с правками</button>
                  <button className="btn" style={{ height: 24, padding: '0 10px' }} onClick={onClearPins}>Сбросить</button>
                </>
              )}
              <button className="btn" style={{ height: 24, padding: '0 10px' }} onClick={() => exportScheduleCsv(result)} title="Выгрузить расписание (Гант) в CSV для Excel">⭳ CSV</button>
            </span>
          </p>
          <div className="plan__panel">
            <Gantt result={result} pins={pins as Map<number, number>} onPin={onPin} />
            <div className="plan__legend">
              {result.program.map((o, i) => (
                <span key={i}><i style={{ background: orderColor(i) }} />{o.product_name} ×{Math.round(o.qty)}</span>
              ))}
              <span><i style={{ background: 'transparent', outline: '1.5px solid var(--intent-danger)' }} />просрочка</span>
            </div>
          </div>
        </section>

        <section id="res-queues" className="pl-result__sec">
          {result.queue_timeline && result.queue_timeline.length > 1 ? (
            <>
              <p className="plan__section-title">Очереди операций · сколько ждёт свободного станка во времени (пик = узкое место)</p>
              <div className="plan__panel"><QueueChart data={result.queue_timeline} byWc={result.queue_by_wc} /></div>
            </>
          ) : <p className="pl-note">Очереди не возвращены бэкендом для этого плана.</p>}
        </section>

        <div className="plan__grid2">
          <section id="res-load" className="pl-result__sec">
            <div className="plan__section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Загрузка оборудования и простои</span>
              <Segmented label="Вид загрузки" value={loadView} onChange={setLoadView}
                options={[{ id: 'types', label: 'по типам' }, { id: 'machines', label: 'по станкам' }, { id: 'time', label: 'во времени' }]} />
            </div>
            <div className="plan__panel">
              {loadView === 'types' && <LoadBars rows={result.wc_load} nameKey="wc_name" />}
              {loadView === 'machines' && <LoadBars rows={result.machine_load} nameKey="machine_name" />}
              {loadView === 'time' && <LoadTimeline gantt={result.gantt} makespan={result.kpi.makespan} />}
            </div>
          </section>
          <section id="res-rules" className="pl-result__sec">
            <p className="plan__section-title">Сравнение правил (makespan ч) · score и веса</p>
            <div className="plan__panel">
              <table className="plan__rules">
                <thead><tr><th>Правило</th><th>Сред.</th><th>CVaR</th><th>Просрочка</th><th>F</th></tr></thead>
                <tbody>
                  {[...result.rules].sort((a, b) => a.score - b.score).map((r) => (
                    <tr key={r.rule} className={r.chosen ? 'chosen' : ''}>
                      <td>{r.rule}{r.chosen ? ' ←' : ''}</td>
                      <td>{h1(r.makespan)}</td><td>{h1(r.makespan_cvar)}</td><td>{h1(r.tardiness)}</td><td>{h1(r.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pl-note">w_time = {result.weights.time} · w_risk = {result.weights.risk} · w_cost = {result.weights.cost} · α = {pct(result.alpha)}</p>
            </div>
          </section>
        </div>

        <section id="res-workers" className="pl-result__sec">
          <p className="plan__section-title">Планы по рабочим (доступность и простои)</p>
          <div className="plan__panel">
            {result.worker_plan.filter((w) => w.job_count > 0).map((w) => (
              <div className="worker-row" key={w.worker_id}>
                <span>{w.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{w.job_count} операций · занят {h1(w.busy_hours)} ч</span>
                <span className="worker-row__util">{pct(w.utilization)}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="res-cash" className="pl-result__sec">
          <p className="plan__section-title">Касса под этот план · CVaR-LP с кассой, водопад по неделям, транши (слой F)</p>
          <CashTiles cash={cash.result} running={cash.running} error={cash.error} onRun={cash.onRun} scheduleRefId={result.plan_id} />
        </section>
      </div>
    </div>
  )
}
