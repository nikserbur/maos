/**
 * Данные схемы из реестров НСИ (единственный источник истины). Ошибка списка не превращается
 * в пустую схему (X2 P-35): `error` — «недоступно» с «Повторить», а пустой успешный ответ —
 * первое использование. Прежняя схема остаётся на экране, если перезагрузка не удалась.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import { api, type Machine, type Operation, type OrgUnit, type WorkCenterType } from '../../lib/api'
import type { GraphAction } from './graph/graphReducer'
import { buildGraphFromDb } from './graph/sceneModel'

export interface SceneData {
  machines: Machine[]
  wcTypes: WorkCenterType[]
  operations: Operation[]
  /** Подразделения как в справочнике (для точной отмены правок цеха). */
  orgUnits: OrgUnit[]
  /** Первая загрузка идёт (схемы ещё нет). */
  loading: boolean
  /** Хотя бы одна загрузка удалась. */
  loaded: boolean
  error: unknown
  reload: () => Promise<void>
  /** Локальная правка сырых позиций станков (центроид цеха для следующих перемещений). */
  patchMachine: (id: string, patch: Partial<Machine>) => void
}

export function useSceneData(dispatch: Dispatch<GraphAction>): SceneData {
  const [machines, setMachines] = useState<Machine[]>([])
  const [wcTypes, setWcTypes] = useState<WorkCenterType[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const [m, t, f, ops, ous] = await Promise.all([
        api.machines.list(), api.workCenterTypes.list(), api.flows.list(), api.operations.list(), api.orgUnits.list(),
      ])
      if (!alive.current) return
      setMachines(m)
      setWcTypes(t)
      setOperations(ops)
      setOrgUnits(ous)
      // Дороги — из flows: линия внутри цеха + магистраль цех→цех (из техкарт).
      dispatch({ type: 'LOAD_GRAPH', graph: buildGraphFromDb(m, t, f, ous) })
      setError(null)
      setLoaded(true)
    } catch (e) {
      if (alive.current) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [dispatch])

  useEffect(() => {
    alive.current = true
    void reload()
    return () => { alive.current = false }
  }, [reload])

  const patchMachine = useCallback((id: string, patch: Partial<Machine>) => {
    setMachines((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }, [])

  return { machines, wcTypes, operations, orgUnits, loading, loaded, error, reload, patchMachine }
}
