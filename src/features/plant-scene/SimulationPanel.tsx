/**
 * Панель имитационного режима (X1 §1 п. 5): заголовок с иконкой кита, вкладки
 * «Прогон / Результаты / В НСИ» на Segmented, «Выйти» — IconButton. Состояние плеера читается
 * из изменяемого SimState тиком 4 Гц без ререндера сцены; содержимое вкладок — в
 * SimulationRuns / SimulationResults / SimulationCalib.
 */
import { useEffect, useState, type MutableRefObject } from 'react'
import { api, type CalibRow, type KpiBundle, type SimResults } from '../../lib/api'
import { invalidateNsi } from '../nsi/useNsi'
import { EmptyState, IconButton, Segmented, type SegOption } from '../../ui/kit'
import { Icon } from '../../shell/icons'
import type { SimState } from './SimulationLayer'
import { SimulationRuns, type SimLive, type SimMeta } from './SimulationRuns'
import { SimulationResults } from './SimulationResults'
import { SimulationCalib } from './SimulationCalib'
import { mergeRuns, type SimRun } from './simModel'
import './simulation.css'

type Tab = 'play' | 'results' | 'calib'

const TABS: ReadonlyArray<SegOption<Tab>> = [
  { id: 'play', label: 'Прогон', icon: 'play' },
  { id: 'results', label: 'Результаты', icon: 'chart' },
  { id: 'calib', label: 'В НСИ', icon: 'gear' },
]

const TICK_MS = 250

interface SimulationPanelProps {
  sim: MutableRefObject<SimState>
  onClose: () => void
}

export function SimulationPanel({ sim, onClose }: SimulationPanelProps) {
  const [meta, setMeta] = useState<SimMeta | null>(null)
  const [live, setLive] = useState<SimLive>({ t: 0, busy: 0, done: 0, playing: false, speed: 24, peakBusy: 0 })
  const [tab, setTab] = useState<Tab>('play')
  const [rows, setRows] = useState<CalibRow[] | null>(null)
  /** undefined — загрузка; null — нет данных. */
  const [res, setRes] = useState<SimResults | null | undefined>(null)
  const [applying, setApplying] = useState(false)
  const [runs, setRuns] = useState<SimRun[]>([])
  const [planId, setPlanId] = useState('')

  const loadPlan = (id?: string) => {
    api.simulation.plan(id)
      .then((p) => {
        const s = sim.current
        s.tasks = p.tasks; s.makespan = p.makespan; s.t = 0; s.playing = false; s.rev++
        const workers = new Set(p.tasks.map((t) => t.worker_id).filter(Boolean)).size
        setMeta({ planId: p.plan_id, n: p.tasks.length, makespan: p.makespan, workers })
        if (p.plan_id) setPlanId(p.plan_id)
        setRes(null)   // сбросить результаты при смене плана
        setLive((prev) => ({ ...prev, peakBusy: 0 }))
      })
      .catch(() => setMeta({ planId: null, n: 0, makespan: 0, workers: 0 }))
  }

  useEffect(() => {
    Promise.all([api.simulation.plans(), api.analytics.kpiSeries().catch(() => [] as KpiBundle[])])
      .then(([plans, series]) => setRuns(mergeRuns(plans, series)))
      .catch(() => setRuns([]))
    loadPlan()
    const s = sim.current
    return () => { s.playing = false }
  }, [sim])

  // Лёгкий тик панели (4 Гц): читаем изменяемое состояние без ререндера сцены.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sim.current
      let done = 0
      const machines = new Set<string>()
      for (const t of s.tasks) {
        if (t.start <= s.t && s.t < t.end) machines.add(t.machine_id)
        if (t.end <= s.t) done++
      }
      setLive((prev) => ({ t: s.t, busy: machines.size, done, playing: s.playing,
        speed: s.speed, peakBusy: Math.max(prev.peakBusy, machines.size) }))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [sim])

  const openCalib = () => {
    setTab('calib')
    if (!rows) api.simulation.calibration().then((r) => setRows(r.rows)).catch(() => setRows([]))
  }
  const openResults = () => {
    setTab('results')
    setRes(undefined)
    api.simulation.results(planId || undefined).then(setRes).catch(() => setRes(null))
  }
  const onTab = (t: Tab) => { if (t === 'results') openResults(); else if (t === 'calib') openCalib(); else setTab('play') }

  const applyAll = async (items: CalibRow[]) => {
    setApplying(true)
    try {
      await api.simulation.calibrate(items.map((r) => ({ op_id: r.op_id, t_norm: Math.round(r.realized_mean) })))
      invalidateNsi()
      const r = await api.simulation.calibration()
      setRows(r.rows)
    } finally { setApplying(false) }
  }

  return (
    <aside className="sim dk-rise" aria-label="Имитационное моделирование">
      <header className="sim__head">
        <span className="sim__head-icon" aria-hidden="true"><Icon name="factory" size={18} /></span>
        <div className="sim__head-text">
          <h3 className="sim__title">Имитационное моделирование</h3>
          <p className="sim__sub">План на 3D-схеме · очереди · операторы</p>
        </div>
        <IconButton icon="stop" size="sm" onClick={onClose} title="Выйти из симуляции">Выйти</IconButton>
      </header>

      <div className="sim__tabs">
        <Segmented options={TABS} value={tab} onChange={onTab} label="Разделы симуляции" kind="tab" size="sm" idBase="sim" />
      </div>

      <div className="sim__body" role="tabpanel" id={`sim-panel-${tab}`} aria-labelledby={`sim-tab-${tab}`}>
        {meta && !meta.planId && (
          <EmptyState size="sm" variant="flow" title="Нет построенного плана">
            Откройте экран «План», постройте расписание — и его можно будет проиграть на схеме.
          </EmptyState>
        )}
        {tab === 'play' && (
          <SimulationRuns sim={sim} runs={runs} planId={planId} meta={meta} live={live}
                          onPickPlan={loadPlan} onResults={openResults} onCalib={openCalib} />
        )}
        {tab === 'results' && <SimulationResults res={res} onCalib={openCalib} />}
        {tab === 'calib' && <SimulationCalib rows={rows} applying={applying} onApply={applyAll} />}
      </div>
    </aside>
  )
}
