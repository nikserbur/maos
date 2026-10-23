/**
 * Результат плана (UX-V2 §4.2 шаг 7, композиция X1 §5.1): липкое оглавление → KPI в ярусах
 * (ярус A: E[Cmax] · OTD · CFaR; остальное — свёрнутая таблица) → узкое место одной строкой →
 * «Что определило» (ГА свёрнут внутрь) → Гант (цвет ≤ 7 изделий, ось в датах, по цехам) →
 * очереди → загрузка → правила и рабочие (свёрнутые таблицы) → касса. Пины →
 * «Пересчитать с правками» создаёт новый прогон, старый остаётся в истории.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { CashLpResult, ScheduleResult } from '../../lib/api'
import { num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { BottleneckBanner } from './BottleneckBanner'
import { CashTiles } from './CashTiles'
import { Gantt } from './Gantt'
import { LoadBars } from './LoadBars'
import { LoadTimeline } from './LoadTimeline'
import { PlanKpis } from './PlanKpis'
import { QueueChart, QueueFilter } from './QueueChart'
import { ResultToc, type TocItem } from './ResultToc'
import { RulesTable, WorkersTable } from './ResultTables'
import { WhatDrove } from './WhatDrove'
import { RlEvalCard } from './RlEvalCard'
import { MovesPanel } from './moves/MovesPanel'
import { movesSource } from './moves/movesSource'
import { PlanDiffView } from './diff/PlanDiffView'
import { Section, Segmented } from '../../ui/kit'
import './plan.css'
import './plan-screen.css'

export interface PlanResultProps {
  result: ScheduleResult
  pins: ReadonlyMap<number, number>
  onPin: (jobIdx: number, startHours: number) => void
  onClearPins: () => void
  onRerun: () => void
  running: boolean
  cash: { result: CashLpResult | null; running: boolean; error: string | null; onRun: () => void }
  /** Начало горизонта (ISO-дата) для оси дат Ганта. */
  startDate?: string | null
  /** Доп. карточки сверху (например, «Сравнить с…»). */
  extra?: ReactNode
}

const TOC: readonly TocItem[] = [
  { id: 'res-kpi', label: 'KPI' }, { id: 'res-bn', label: 'Узкое место' }, { id: 'res-drove', label: 'Что определило' },
  { id: 'res-moves', label: 'Ходы агента' }, { id: 'res-gantt', label: 'Гант' }, { id: 'res-queues', label: 'Очереди' }, { id: 'res-load', label: 'Загрузка' },
  { id: 'res-tables', label: 'Правила · рабочие' }, { id: 'res-cash', label: 'Касса' },
]

/** Экспорт расписания в CSV (Excel-совместимый: BOM + «;»). Числа — с точкой, как ждёт Excel при импорте. */
export function exportScheduleCsv(result: ScheduleResult): void {
  const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`
  const cell = (v: number) => num(v, 2)
  const rows = [
    ['Изделие', 'Операция', 'Тип РЦ', 'Станок', 'Начало, ч', 'Конец, ч', 'Срок, ч', 'Просрочка'],
    ...result.gantt.map((g) => [g.product_name, g.op_name, g.wc_name, g.machine_name, cell(g.start), cell(g.end), cell(g.due), g.late ? 'да' : '']),
  ]
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `план_расписание_${result.rule}.csv`; a.click()
  URL.revokeObjectURL(url)
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export function PlanResult({ result, pins, onPin, onClearPins, onRerun, running, cash, startDate = null, extra }: PlanResultProps) {
  const [loadView, setLoadView] = useState<'types' | 'machines' | 'time'>('types')
  const [queueWc, setQueueWc] = useState('')
  const hasPins = pins.size > 0
  const moves = useMemo(() => movesSource(result), [result])
  const ganttTools = (
    <>
      {hasPins && (
        <>
          <span className="plan__pins"><Icon name="pin" size={14} /> правок: {num(pins.size, 0)}</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onRerun} disabled={running}>Пересчитать с правками</button>
          <button type="button" className="btn btn--sm" onClick={onClearPins}>Сбросить</button>
        </>
      )}
      <button type="button" className="btn btn--sm" onClick={() => exportScheduleCsv(result)} title="Выгрузить расписание в CSV для Excel">CSV</button>
    </>
  )

  return (
    <div className="pl-result">
      <ResultToc items={TOC} />
      <div className="pl-result__body">
        {extra}
        <section id="res-kpi" className="pl-result__sec" aria-label="KPI плана">
          <PlanKpis result={result} cash={cash.result} cashRunning={cash.running} onGoCash={() => scrollTo('res-cash')} />
        </section>
        <section id="res-bn" className="pl-result__sec"><BottleneckBanner result={result} /></section>
        <section id="res-drove" className="pl-result__sec">
          <WhatDrove result={result} pins={pins.size} />
          {result.rl && <RlEvalCard rl={result.rl} rules={result.rules} />}
        </section>

        {moves.kind !== 'none' && (
          <Section id="res-moves" title="Структурные ходы агента"
            meta={moves.kind === 'demo' ? 'пример на фикстурах: правило «RL» в этом прогоне не работало' : 'агент предлагает — вы утверждаете; оба видят одни и те же сценарии'}
            tools={<a className="btn btn--sm" href="#/map/ag.rl">[6] на карте ↗</a>}>
            <MovesPanel result={result} source={moves} />
          </Section>
        )}

        <Section id="res-gantt" title="Диаграмма Ганта" meta={<>{num(result.n_jobs, 0)} операций · {num(result.n_orders, 0)} заказов · полосы можно перетаскивать («не раньше»)</>} tools={ganttTools}>
          <div className="pl-card pl-card--flush">
            <PlanDiffView result={result} source={moves} startDate={startDate}
              plan={<Gantt result={result} pins={pins} onPin={onPin} startDate={startDate} />} />
          </div>
        </Section>

        <Section id="res-queues" title="Очереди операций" meta="сколько операций ждёт свободного станка во времени; пик — узкое место"
          tools={<QueueFilter byWc={result.queue_by_wc} value={queueWc} onChange={setQueueWc} />}>
          {result.queue_timeline && result.queue_timeline.length > 1
            ? <div className="pl-card"><QueueChart data={result.queue_timeline} byWc={result.queue_by_wc} wc={queueWc} /></div>
            : <p className="pl-note">Очереди не возвращены бэкендом для этого плана.</p>}
        </Section>

        <Section id="res-load" title="Загрузка оборудования и простои" tools={
          <Segmented label="Вид загрузки" value={loadView} onChange={setLoadView}
            options={[{ id: 'types', label: 'по типам' }, { id: 'machines', label: 'по станкам' }, { id: 'time', label: 'во времени' }]} />
        }>
          <div className="pl-card">
            {loadView === 'types' && <LoadBars rows={result.wc_load} nameKey="wc_name" />}
            {loadView === 'machines' && <LoadBars rows={result.machine_load} nameKey="machine_name" />}
            {loadView === 'time' && <LoadTimeline gantt={result.gantt} makespan={result.kpi.makespan} />}
          </div>
        </Section>

        <section id="res-tables" className="pl-result__sec pl-tables" aria-label="Правила и рабочие">
          <details className="pl-more">
            <summary className="pl-more__sum">
              <span className="pl-more__caret" aria-hidden="true">▸</span>
              Сравнение правил <span className="num">{num(result.rules.length, 0)}</span>
              <span className="pl-more__hint">E[Cmax], CVaR, просрочка и F по каждому диспетчерскому правилу; выбранное — ●</span>
            </summary>
            <div className="pl-card"><RulesTable result={result} /></div>
          </details>
          <details className="pl-more">
            <summary className="pl-more__sum">
              <span className="pl-more__caret" aria-hidden="true">▸</span>
              Планы по рабочим <span className="num">{num(result.worker_plan.filter((w) => w.job_count > 0).length, 0)}</span>
              <span className="pl-more__hint">доступность и загрузка по назначениям; сортировка по колонкам</span>
            </summary>
            <div className="pl-card"><WorkersTable result={result} /></div>
          </details>
        </section>

        <Section id="res-cash" title="Касса под этот план" meta="CVaR-LP с кассой, водопад по неделям, транши (слой F)">
          <CashTiles cash={cash.result} running={cash.running} error={cash.error} onRun={cash.onRun} scheduleRefId={result.plan_id} primary={!hasPins} />
        </Section>
      </div>
    </div>
  )
}
