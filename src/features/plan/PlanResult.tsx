/**
 * Результат плана (X2 «ответ сначала», композиция X1 §5.1): липкое оглавление (6 разделов; «Ходы
 * агента» — только при настоящем пакете агента) → вердикт и KPI → узкое место с причинами → Гант →
 * очереди и загрузка → таблицы → касса. Виды связаны одной выборкой (`?wc=…`). Касса показывается,
 * только если посчитана под ЭТОТ план; исход — один селектор для плитки и раздела (cashOutcome).
 * Пины → «Пересчитать с правками» создаёт новый прогон со своим адресом, старый остаётся в истории.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CashLpResult, ScheduleResult } from '../../lib/api'
import { num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
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
import { MovesNone } from './moves/MovesNone'
import { MovesPanel } from './moves/MovesPanel'
import { movesSource } from './moves/movesSource'
import { PlanDiffView } from './diff/PlanDiffView'
import { RESULT_SECTIONS } from './planNav'
import { revealPlanSection, usePlanSelection } from './usePlanSelection'
import { Section, Segmented } from '../../ui/kit'
import './plan.css'
import './plan-screen.css'

export interface PlanCashProps {
  result: CashLpResult | null
  running: boolean
  error: string | null
  /** План, под который запущен последний расчёт кассы (schedule_ref_id). */
  refId: string | null
  onRun: (financing: 'recourse' | 'first') => void
  financing: 'recourse' | 'first'
}

export interface PlanResultProps {
  result: ScheduleResult
  pins: ReadonlyMap<number, number>
  onPin: (jobIdx: number, startHours: number) => void
  onClearPins: () => void
  onRerun: () => void
  running: boolean
  cash: PlanCashProps
  /** Начало горизонта (ISO-дата) для оси дат Ганта. */
  startDate?: string | null
  /** Раздел из адреса (slug) и запись раздела в адрес. */
  section?: string | null
  onSection?: (slug: string) => void
}

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

/** Касса относится к этому плану, если считалась с его профилем отгрузок. */
const samePlan = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? '') === (b ?? '')

export function PlanResult({ result, pins, onPin, onClearPins, onRerun, running, cash, startDate = null, section = null, onSection }: PlanResultProps) {
  const [loadView, setLoadView] = useState<'types' | 'machines' | 'time'>('types')
  const sel = usePlanSelection()
  const inQueue = (wc: string | null) => Boolean(wc) && Boolean(result.queue_by_wc?.some((q) => q.wc_type_id === wc))
  // Фильтр очередей по умолчанию — узкое место; общая выборка `?wc=` его переключает.
  const [queueWc, setQueueWc] = useState(() => (inQueue(sel.wc) ? (sel.wc as string) : inQueue(result.bottleneck.wc_type_id) ? result.bottleneck.wc_type_id : ''))
  useEffect(() => { if (sel.wc && result.queue_by_wc?.some((q) => q.wc_type_id === sel.wc)) setQueueWc(sel.wc) }, [sel.wc, result.queue_by_wc])
  const hasPins = pins.size > 0
  const moves = useMemo(() => movesSource(result), [result])
  const toc = useMemo<TocItem[]>(() => RESULT_SECTIONS.filter((s) => s.slug !== 'moves' || moves.kind === 'agent').map((s) => ({ ...s })), [moves.kind])

  const mine = samePlan(cash.refId, result.plan_id)
  const cashResult = cash.result && samePlan(cash.result.shipment_profile?.plan_id, result.plan_id) ? cash.result : null
  const cashRunning = cash.running && mine
  const cashError = mine ? cash.error : null

  const ganttTools = (
    <>
      {hasPins && (
        <>
          <span className="plan__pins"><Icon name="pin" size={14} /> правок: {num(pins.size, 0)}</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onRerun} aria-disabled={running}>{running ? 'Пересчитываем…' : 'Пересчитать с правками'}</button>
          <button type="button" className="btn btn--sm" onClick={onClearPins}>Сбросить</button>
        </>
      )}
      <button type="button" className="btn btn--sm" onClick={() => exportScheduleCsv(result)} title="Выгрузить расписание в CSV для Excel">CSV</button>
    </>
  )

  return (
    <div className="pl-result">
      <ResultToc items={toc} initial={section} onSection={onSection} />
      <div className="pl-result__body">
        <section id="res-kpi" className="pl-result__sec" aria-label="Вердикт и KPI плана">
          <PlanKpis result={result} cash={cashResult} cashRunning={cashRunning} cashError={cashError} onGoCash={() => revealPlanSection('res-cash')} />
        </section>

        <Section id="res-bn" title="Узкое место" meta="одно определение — загрузка фонда; перегрузка — от 85 %">
          <BottleneckBanner result={result} />
          <WhatDrove result={result} pins={pins.size} />
          {result.rl && <RlEvalCard rl={result.rl} rules={result.rules} />}
        </Section>

        {moves.kind === 'agent' || moves.kind === 'agent-empty' ? (
          <Section id="res-moves" title="Ходы агента" meta="агент предлагает — вы утверждаете; оба видят одни и те же сценарии"
            tools={<a className="btn btn--sm" href="#/map/ag.rl">[6] на карте ↗</a>}>
            <ErrorBoundary variant="inline" label="ходы агента"><MovesPanel result={result} source={moves} /></ErrorBoundary>
          </Section>
        ) : (
          <MovesNone result={result} source={moves} />
        )}

        <Section id="res-gantt" title="Диаграмма Ганта" meta={<>{num(result.n_jobs, 0)} операций · {num(result.n_orders, 0)} заказов · полосу можно перетащить («не раньше»)</>} tools={ganttTools}>
          <div className="pl-card pl-card--flush">
            <ErrorBoundary variant="inline" label="диаграмма Ганта">
              <PlanDiffView result={result} source={moves} startDate={startDate}
                plan={<Gantt result={result} pins={pins} onPin={onPin} startDate={startDate} />} />
            </ErrorBoundary>
          </div>
        </Section>

        <Section id="res-load" title="Очереди и загрузка" meta="где операции ждут станка и насколько занят фонд">
          <div className="pl-card">
            <div className="pl-card__hd">
              <span className="pl-card__title text-caps">Очереди операций</span>
              <QueueFilter byWc={result.queue_by_wc} value={queueWc} onChange={(wc) => { setQueueWc(wc); sel.select({ wc: wc || null }) }} />
            </div>
            {result.queue_timeline && result.queue_timeline.length > 1
              ? <QueueChart data={result.queue_timeline} byWc={result.queue_by_wc} wc={queueWc} startDate={startDate} />
              : <p className="pl-note">Очереди не возвращены сервером для этого плана.</p>}
          </div>
          <div className="pl-card">
            <div className="pl-card__hd">
              <span className="pl-card__title text-caps">Загрузка оборудования и простои</span>
              <Segmented label="Вид загрузки" size="sm" value={loadView} onChange={setLoadView}
                options={[{ id: 'types', label: 'по типам' }, { id: 'machines', label: 'по станкам' }, { id: 'time', label: 'по дням' }]} />
            </div>
            {loadView === 'types' && <LoadBars rows={result.wc_load} nameKey="wc_name" />}
            {loadView === 'machines' && <LoadBars rows={result.machine_load} nameKey="machine_name" />}
            {loadView === 'time' && <LoadTimeline gantt={result.gantt} makespan={result.kpi.makespan} startDate={startDate} />}
          </div>
        </Section>

        <section id="res-tables" className="pl-result__sec pl-tables" aria-label="Таблицы: правила и рабочие">
          <details className="pl-more">
            <summary className="pl-more__sum">
              <span className="pl-more__caret" aria-hidden="true">▸</span>
              Сравнение правил <span className="num">{num(result.rules.length, 0)}</span>
              <span className="pl-more__hint">срок, хвост, просрочка и цель F по каждому правилу; Δ к выбранному</span>
            </summary>
            <div className="pl-card"><RulesTable result={result} /></div>
          </details>
          <details className="pl-more">
            <summary className="pl-more__sum">
              <span className="pl-more__caret" aria-hidden="true">▸</span>
              Планы по рабочим <span className="num">{num(result.worker_plan.filter((w) => w.job_count > 0).length, 0)}</span>
              <span className="pl-more__hint">назначения и загрузка; сортировка по колонкам</span>
            </summary>
            <div className="pl-card"><WorkersTable result={result} /></div>
          </details>
        </section>

        <Section id="res-cash" title="Касса под этот план" meta="недельный остаток кассы (P5–P50–P95), транши и цена ликвидности">
          <ErrorBoundary variant="inline" label="касса">
            <CashTiles cash={cashResult} running={cashRunning} error={cashError} onRun={cash.onRun} financing={cash.financing}
              scheduleRefId={result.plan_id} primary={!hasPins} />
          </ErrorBoundary>
        </Section>
      </div>
    </div>
  )
}
