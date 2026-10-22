/**
 * Сводка прогонов портфеля для шага «Программа» (X1 §5 п. 14): E[Π], CVaR и число изделий
 * по каждому прогону — из GET /api/optimize/runs/:id (в списке их нет). Держим в памяти только
 * метрики, не весь ответ; кэш в модуле — повторный заход на шаг не дёргает бэкенд.
 */
import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'

export interface RunSummary {
  expected: number
  cvar: number
  items: number
  scenarioName: string
}

const cache = new Map<string, RunSummary | null>()
const inflight = new Map<string, Promise<RunSummary | null>>()

function fetchSummary(id: string): Promise<RunSummary | null> {
  const hit = cache.get(id)
  if (hit !== undefined) return Promise.resolve(hit)
  let p = inflight.get(id)
  if (!p) {
    p = api.optimize.run_get(id)
      .then((r): RunSummary => ({ expected: r.robust.metrics.expected, cvar: r.robust.metrics.cvar, items: r.robust.items.length, scenarioName: r.scenario_name }))
      .catch(() => null)
      .then((s) => { cache.set(id, s); inflight.delete(id); return s })
    inflight.set(id, p)
  }
  return p
}

/** Сводки по списку id; отсутствующие — `undefined` (грузятся), `null` — недоступны. */
export function useRunSummaries(ids: readonly string[]): ReadonlyMap<string, RunSummary | null> {
  const key = ids.join('|')
  const [map, setMap] = useState<ReadonlyMap<string, RunSummary | null>>(() => new Map(ids.flatMap((id) => (cache.has(id) ? [[id, cache.get(id)!] as const] : []))))
  useEffect(() => {
    let alive = true
    const list = key ? key.split('|') : []
    void Promise.all(list.map((id) => fetchSummary(id).then((s) => [id, s] as const))).then((pairs) => {
      if (alive) setMap(new Map(pairs))
    })
    return () => { alive = false }
  }, [key])
  return map
}
