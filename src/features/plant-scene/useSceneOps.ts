/**
 * Хук «Схема ↔ план» (X2 P-27): последний KpiBundle из истории, запасной — результат «Плана»
 * этой сессии. Перезапрашивает историю, когда «План» построил новый результат. Ошибка истории
 * не прячется: сцена показывает «загрузка недоступна», а не нули.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type KpiBundle, type Machine } from '../../lib/api'
import { usePlanStore } from '../plan/planStore'
import type { SceneGraph } from './graph/sceneModel'
import { buildSceneOps, pickOpsSource, type SceneOps } from './sceneOps'

export interface SceneOpsState extends SceneOps {
  /** История KPI не загрузилась (сервер недоступен) — показать «недоступно», не нули. */
  error: unknown
  loading: boolean
}

export function useSceneOps(graph: SceneGraph, machines: ReadonlyArray<Machine>): SceneOpsState {
  const plan = usePlanStore()
  const [series, setSeries] = useState<KpiBundle[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.analytics.kpiSeries()
      .then((s) => { if (alive) { setSeries(s); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(e) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [plan.builtAt])

  const ops = useMemo(
    () => buildSceneOps(graph, machines, pickOpsSource(series, plan.result, plan.builtAt)),
    [graph, machines, series, plan.result, plan.builtAt],
  )
  return { ...ops, error: ops.source ? null : error, loading }
}
