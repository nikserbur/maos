/**
 * Сессия симуляции (X2 P-29, P-36, P-37): общий для полосы времени (внизу канваса) и правой
 * колонки источник — выбранный план, живые показатели (тик 4 Гц читает изменяемый SimState без
 * ререндера сцены), история прогонов, справочник изделий (цвет партии = цвет изделия на Ганте) и
 * нехватка операторов по допускам. Работает только пока режим «Симуляция» включён.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { api, type Machine, type WorkCenterType } from '../../lib/api'
import { laborBottlenecks, type LaborLoad } from '../nsi/labor'
import { getPlanState } from '../plan/planStore'
import type { SimState } from './SimulationLayer'
import { mergeRuns, type SimRun } from './simModel'

export interface SimMeta {
  planId: string | null
  n: number
  makespan: number
  workers: number
  /** Начало плана (дата календаря или отметка сервера) — для часов «24.10 · смена 2 · 14:00». */
  startAt: string | number | null
}
export interface SimLive { t: number; busy: number; done: number; playing: boolean; speed: number; peakBusy: number }

export interface SimSession {
  meta: SimMeta | null
  planError: unknown
  live: SimLive
  runs: SimRun[] | null
  runsError: unknown
  planId: string
  /** Все изделия справочника (порядок слотов цвета, как на Ганте). */
  productIds: string[]
  /** Типы оборудования, где операторов с допуском меньше, чем станков; null — ещё не известно. */
  labor: LaborLoad[] | null
  loadPlan: (id?: string) => void
  reloadRuns: () => void
}

const TICK_MS = 250
const IDLE_LIVE: SimLive = { t: 0, busy: 0, done: 0, playing: false, speed: 24, peakBusy: 0 }

export function useSimSession(sim: MutableRefObject<SimState>, active: boolean, machines: Machine[], wcTypes: WorkCenterType[]): SimSession {
  const [meta, setMeta] = useState<SimMeta | null>(null)
  const [planError, setPlanError] = useState<unknown>(null)
  const [live, setLive] = useState<SimLive>(IDLE_LIVE)
  const [runs, setRuns] = useState<SimRun[] | null>(null)
  const [runsError, setRunsError] = useState<unknown>(null)
  const [planId, setPlanId] = useState('')
  const [productIds, setProductIds] = useState<string[]>([])
  const [labor, setLabor] = useState<LaborLoad[] | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const loadPlan = useCallback((id?: string) => {
    api.simulation.plan(id)
      .then((p) => {
        if (!alive.current) return
        const s = sim.current
        s.tasks = p.tasks; s.makespan = p.makespan; s.t = 0; s.playing = false; s.rev++
        const plan = getPlanState()
        const startAt = plan.result?.plan_id && plan.result.plan_id === p.plan_id && plan.startDate ? plan.startDate : p.created_at ?? null
        const workers = new Set(p.tasks.map((t) => t.worker_id).filter(Boolean)).size
        setMeta({ planId: p.plan_id, n: p.tasks.length, makespan: p.makespan, workers, startAt })
        if (p.plan_id) setPlanId(p.plan_id)
        setPlanError(null)
        setLive((prev) => ({ ...prev, peakBusy: 0 }))
      })
      .catch((e: unknown) => { if (alive.current) setPlanError(e) })
  }, [sim])

  const reloadRuns = useCallback(() => {
    Promise.all([api.simulation.plans(), api.analytics.kpiSeries()])
      .then(([plans, series]) => { if (alive.current) { setRuns(mergeRuns(plans, series)); setRunsError(null) } })
      .catch((e: unknown) => { if (alive.current) setRunsError(e) })
  }, [])

  useEffect(() => {
    if (!active) return undefined
    loadPlan()
    reloadRuns()
    api.products.list()
      .then((ps) => { if (alive.current) setProductIds(ps.map((p) => p.id)) })
      .catch(() => { if (alive.current) setProductIds([]) /* без справочника — слоты по изделиям плана */ })
    const s = sim.current
    return () => { s.playing = false }
  }, [active, loadPlan, reloadRuns, sim])

  // Нехватка операторов по допускам — одна правда для «Прогона» и «Результатов».
  useEffect(() => {
    if (!active) return
    api.workers.list()
      .then((w) => { if (alive.current) setLabor(laborBottlenecks(machines, w, wcTypes)) })
      .catch(() => { if (alive.current) setLabor(null) /* неизвестно — строку не показываем */ })
  }, [active, machines, wcTypes])

  // Лёгкий тик (4 Гц): читаем изменяемое состояние без ререндера сцены.
  useEffect(() => {
    if (!active) return undefined
    const id = window.setInterval(() => {
      const s = sim.current
      let done = 0
      const busyMachines = new Set<string>()
      for (const t of s.tasks) {
        if (t.start <= s.t && s.t < t.end) busyMachines.add(t.machine_id)
        if (t.end <= s.t) done++
      }
      setLive((prev) => {
        const next = { t: s.t, busy: busyMachines.size, done, playing: s.playing, speed: s.speed, peakBusy: Math.max(prev.peakBusy, busyMachines.size) }
        return next.t === prev.t && next.playing === prev.playing && next.speed === prev.speed && next.done === prev.done && next.busy === prev.busy ? prev : next
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [active, sim])

  return { meta, planError, live, runs, runsError, planId, productIds, labor, loadPlan, reloadRuns }
}
