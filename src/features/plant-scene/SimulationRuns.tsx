/**
 * Вкладка «Прогон»: выбор плана строками истории (дата · операций · горизонт · OTD),
 * плеер (старт/пауза, в начало, скорость, ползунок времени), живые показатели, легенда
 * обозначений 3D-сцены и итог прогона.
 */
import type { MutableRefObject } from 'react'
import { Chip, DataTable, IconButton, type DataColumn } from '../../ui/kit'
import { Legend } from '../../ui/charts'
import { hours, num, pct } from '../../explain/format'
import { LaborWarning } from '../nsi/LaborWarning'
import type { SimState } from './SimulationLayer'
import { SimKpi } from './SimKpi'
import { fmtClock, fmtHorizon, fmtRunDate, type SimRun } from './simModel'

export const SPEEDS = [1, 6, 24, 120, 720]   // модельных часов за секунду

export interface SimMeta { planId: string | null; n: number; makespan: number; workers: number }
export interface SimLive { t: number; busy: number; done: number; playing: boolean; speed: number; peakBusy: number }

/* Обозначения SimulationLayer: кольцо занятости — chart-3, очередь — chart-2, рабочие — chart-5,
   партии — слоты палитры по изделию (здесь — первый). */
const LEGEND = [
  { key: 'busy', label: 'кольцо — узел занят (ярче при большей загрузке)', color: 'var(--chart-3)', shape: 'line' as const },
  { key: 'queue', label: 'ящики — очередь партий', color: 'var(--chart-2)', shape: 'rect' as const },
  { key: 'worker', label: 'фигурки — рабочие у станков и на переходах', color: 'var(--chart-5)', shape: 'dot' as const },
  { key: 'batch', label: 'партии летят между станками по маршрутам', color: 'var(--chart-1)', shape: 'dot' as const },
]

const otdTone = (v: number) => (v >= 0.99 ? 'running' : v >= 0.9 ? 'setup' : 'down')

const COLUMNS: ReadonlyArray<DataColumn<SimRun>> = [
  { key: 'createdAt', title: 'Когда', rowHeader: true, get: (r) => r.createdAt, render: (r) => fmtRunDate(r.createdAt) },
  { key: 'nTasks', title: 'Оп.', num: true, get: (r) => r.nTasks, render: (r) => num(r.nTasks, 0) },
  { key: 'makespan', title: 'Горизонт', num: true, get: (r) => r.makespan, render: (r) => hours(r.makespan, 0) },
  { key: 'otd', title: 'OTD', num: true, get: (r) => r.otd,
    render: (r) => (Number.isFinite(r.otd) ? <Chip size="sm" tone={otdTone(r.otd)}>{pct(r.otd, 0)}</Chip> : '—') },
]

interface SimulationRunsProps {
  sim: MutableRefObject<SimState>
  runs: SimRun[]
  planId: string
  meta: SimMeta | null
  live: SimLive
  onPickPlan: (id: string) => void
  onResults: () => void
  onCalib: () => void
}

export function SimulationRuns({ sim, runs, planId, meta, live, onPickPlan, onResults, onCalib }: SimulationRunsProps) {
  const clock = fmtClock(live.t)
  const finished = !!meta && meta.n > 0 && live.done >= meta.n
  const togglePlay = () => { const s = sim.current; if (s.t >= s.makespan) s.t = 0; s.playing = !s.playing }
  const rewind = () => { sim.current.t = 0; sim.current.playing = false }

  return (
    <div className="dk-stack sim__stack">
      {runs.length > 0 && (
        <div className="sim__runs">
          <DataTable columns={COLUMNS} rows={runs} rowKey={(r) => r.id} tight framed caption="Прогоны: выберите план"
                     onRowClick={(r) => onPickPlan(r.id)} rowClassName={(r) => (r.id === planId ? 'is-chosen' : undefined)}
                     rowTitle={() => 'Проиграть этот план'} />
        </div>
      )}

      {meta?.planId && (
        <>
          <div className="sim__player">
            <div className="sim__transport">
              <button type="button" className="sim__play" aria-label={live.playing ? 'Пауза' : 'Запустить'}
                      aria-pressed={live.playing} onClick={togglePlay}>
                <IconGlyph playing={live.playing} />
              </button>
              <IconButton icon="rewind" size="sm" onClick={rewind} title="В начало" />
              <select className="sim__select" value={live.speed} aria-label="Скорость"
                      onChange={(e) => { sim.current.speed = Number(e.target.value) }}>
                {SPEEDS.map((sp) => <option key={sp} value={sp}>×{num(sp, 0)} ч/с</option>)}
              </select>
              <div className="sim__clock num">
                день {clock.day} · {clock.time}
                <small>горизонт {fmtHorizon(meta.makespan)}</small>
              </div>
            </div>
            <input className="sim__range" type="range" min={0} max={Math.max(1, meta.makespan)} aria-label="Модельное время"
                   step={meta.makespan / 500 || 1} value={live.t}
                   onChange={(e) => { sim.current.t = Number(e.target.value); sim.current.playing = false }} />
          </div>

          <div className="sim__kpis">
            <SimKpi k="Занято станков" v={num(live.busy, 0)} sub={`пик ${num(live.peakBusy, 0)}`} />
            <SimKpi k="Выполнено" v={pct(meta.n ? live.done / meta.n : 0, 0)} sub={`${num(live.done, 0)}/${num(meta.n, 0)}`} />
            <SimKpi k="Рабочих" v={num(meta.workers, 0)} />
          </div>

          <Legend items={LEGEND} className="sim__legend" />
          <LaborWarning compact />

          {/* Итог прогона: появляется, когда время дошло до конца горизонта. */}
          {finished && (
            <div className="sim__done dk-rise" role="status">
              <div className="sim__done-title glyph-running">Прогон завершён</div>
              <div className="sim__done-meta num">
                операций {num(meta.n, 0)} · горизонт {fmtHorizon(meta.makespan)} · пик занятости {num(live.peakBusy, 0)} станков
              </div>
              <div className="sim__row">
                <IconButton icon="chart" variant="primary" size="sm" onClick={onResults}>Результаты</IconButton>
                <IconButton icon="gear" size="sm" onClick={onCalib}>Калибровка НСИ</IconButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Иконка плеера (play/pause) — тем же штрихом, что и Icon кита. */
function IconGlyph({ playing }: { playing: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 4.5v15l12-7.5z" />}
    </svg>
  )
}
