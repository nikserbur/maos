/**
 * Правая колонка в режиме «Симуляция» (X2 P-29): вкладки «Прогон · Результаты · В справочники»
 * рисуются на месте инспектора (360 px), плеер — в полосе времени внизу канваса; плавающей
 * панели поверх сцены нет. Клик по станку в сцене показывает его занятость, очередь и операцию.
 */
import { useMemo, useState, type MutableRefObject } from 'react'
import { api, type CalibRow, type SimResults } from '../../lib/api'
import { IconButton, TabPanel, Tabs, type TabItem } from '../../ui/kit'
import { entityLegend, type LegendItem } from '../../ui/charts'
import type { SceneNode } from './graph/sceneModel'
import type { SimState } from './SimulationLayer'
import { SimNodeInfo } from './SimNodeInfo'
import { SimulationRuns } from './SimulationRuns'
import { SimulationResults } from './SimulationResults'
import { SimulationCalib } from './SimulationCalib'
import type { SimSession } from './useSimSession'
import './simulation.css'

type Tab = 'play' | 'results' | 'calib'

/** Разделы колонки; «Результаты» и «В справочники» грузят данные — выбор по Enter/Space (activation="manual"). */
const TABS: ReadonlyArray<TabItem<Tab>> = [
  { id: 'play', label: 'Прогон', icon: 'play' },
  { id: 'results', label: 'Результаты', icon: 'chart' },
  { id: 'calib', label: 'В справочники', icon: 'nsi' },
]

/** Обозначения слоя симуляции (SimulationLayer): у каждого кольца одна работа. */
const LAYER_LEGEND: ReadonlyArray<LegendItem> = [
  { key: 'load', label: 'кольцо — загрузка за последние 8 ч: светлее → темнее', color: 'var(--chart-1)', shape: 'line' },
  { key: 'over', label: '▲ над объектом — загрузка выше 85 %', color: 'transparent', glyph: 'glyph-setup' },
  { key: 'queue', label: 'ящики — партии в очереди к станку', color: 'var(--text-muted)', shape: 'rect' },
  { key: 'worker', label: 'фигурки — рабочие у станков', color: 'var(--text-secondary)', shape: 'dot' },
]

interface SimulationPanelProps {
  sim: MutableRefObject<SimState>
  session: SimSession
  selectedNode: SceneNode | null
  /** Станки выбранного объекта (сам станок или станки цеха). */
  selectedMachines: ReadonlySet<string>
  onExit: () => void
}

export function SimulationPanel({ sim, session, selectedNode, selectedMachines, onExit }: SimulationPanelProps) {
  const [tab, setTab] = useState<Tab>('play')
  const [rows, setRows] = useState<CalibRow[] | null>(null)
  const [calibError, setCalibError] = useState<unknown>(null)
  /** undefined — загрузка; null — нет данных. */
  const [res, setRes] = useState<SimResults | null | undefined>(null)
  const [resError, setResError] = useState<unknown>(null)

  const loadCalib = () => {
    setCalibError(null)
    api.simulation.calibration().then((r) => setRows(r.rows)).catch((e: unknown) => setCalibError(e))
  }
  const loadResults = () => {
    setRes(undefined)
    setResError(null)
    api.simulation.results(session.planId || undefined).then(setRes).catch((e: unknown) => { setRes(null); setResError(e) })
  }
  const onTab = (t: Tab) => {
    setTab(t)
    if (t === 'results') loadResults()
    if (t === 'calib' && rows === null) loadCalib()
  }

  // Партии окрашены по изделию — слоты по справочнику изделий, как на Ганте «Плана».
  const legend = useMemo(() => {
    const tasks = sim.current.tasks
    const names = new Map<string, string>()
    for (const t of tasks) if (!names.has(t.product_id)) names.set(t.product_id, t.product_name || 'изделие')
    const universe = session.productIds.length ? session.productIds : [...names.keys()]
    const products = entityLegend('product', [...names].map(([id, label]) => ({ id, label: `партии: ${label}` })), universe)
    return [...LAYER_LEGEND, ...products]
    // meta меняется при загрузке нового плана (sim.current.tasks — изменяемое состояние)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.meta, session.productIds])

  const nodeInfo = selectedNode
    ? <SimNodeInfo node={selectedNode} tasks={sim.current.tasks} machineIds={selectedMachines} t={session.live.t} />
    : <p className="sim__note">Выберите станок или цех в сцене — здесь появятся занятость, очередь и текущая операция.</p>

  return (
    <aside className="sim-col" aria-label="Имитационное моделирование">
      <header className="sim-col__head">
        <h2 className="sim-col__title">Симуляция плана</h2>
        <IconButton icon="stop" variant="ghost" size="sm" onClick={onExit} title="Выйти из симуляции">Выйти</IconButton>
      </header>
      <div className="sim-col__tabs">
        <Tabs items={TABS} value={tab} onChange={onTab} label="Разделы симуляции" size="panel" activation="manual" idBase="sim" />
      </div>
      <TabPanel idBase="sim" id={tab} className="sim-col__body">
        {tab === 'play' && <SimulationRuns session={session} nodeInfo={nodeInfo} legend={legend} onResults={() => onTab('results')} />}
        {tab === 'results' && <SimulationResults res={res} error={resError} labor={session.labor} onRetry={loadResults} onCalib={() => onTab('calib')} />}
        {tab === 'calib' && <SimulationCalib rows={rows} loadError={calibError} onReload={loadCalib} />}
      </TabPanel>
    </aside>
  )
}
