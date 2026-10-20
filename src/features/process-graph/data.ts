/**
 * Загрузка данных графа: справочники через типизированный клиент `api`, связи
 * движка — через предлагаемый эндпоинт GET /api/operation_links (его пока нет в
 * src/lib/api.ts и на сервере), наложение плана — KPI + лента задач того же плана.
 * Ошибки не глотаются: отсутствие эндпоинта связей (404) — штатный откат с
 * предупреждением, всё остальное пробрасывается в состояние экрана.
 */
import { api, type KpiBundle, type SimPlan } from '../../lib/api'
import type { OperationLinks, ProcessData, ProductRow, RoutingRow, OperationRow, WorkerRow } from './types'

export const LINKS_ENDPOINT = '/operation_links'

/** GET с тем же контрактом, что request() в api.ts; 404 → null (эндпоинт не реализован). */
async function getOptional<T>(path: string): Promise<T | null> {
  const headers: Record<string, string> = {}
  try {
    const token = sessionStorage.getItem('maos.token')
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    /* приватный режим: запрос уйдёт без токена, сервер ответит 401 */
  }
  const res = await fetch(`/api${path}`, { method: 'GET', headers })
  if (res.status === 404) return null
  if (res.status === 401) {
    // Как в api.ts: сессия истекла → чистим и возвращаем на окно входа.
    try {
      sessionStorage.removeItem('maos.token')
      sessionStorage.removeItem('maos.session')
    } catch {
      /* noop */
    }
    window.location.reload()
  }
  const text = await res.text()
  if (!text) throw new Error(`${path}: HTTP ${res.status}, пустой ответ`)
  let json: { data: T | null; error: string | null }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${path}: HTTP ${res.status}, ответ не JSON`)
  }
  if (!res.ok || json.error) throw new Error(json.error ?? `${path}: HTTP ${res.status}`)
  return json.data
}

function isLinks(v: unknown): v is OperationLinks {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return Array.isArray(r.inputs) && Array.isArray(r.wc_types)
}

export async function loadProcessData(): Promise<ProcessData> {
  const [products, routings, operations, wcTypes, machines, workers, links] = await Promise.all([
    api.products.list(),
    api.routings.list(),
    api.operations.list(),
    api.workCenterTypes.list(),
    api.machines.list(),
    api.workers.list(),
    getOptional<unknown>(LINKS_ENDPOINT),
  ])
  if (links !== null && !isLinks(links)) {
    throw new Error(`${LINKS_ENDPOINT}: неожиданный формат (нужны массивы inputs и wc_types)`)
  }
  return {
    // GET отдаёт SELECT * — лишние колонки (lead_time_hours, is_default, setup_time…) в рантайме есть.
    products: products as ProductRow[],
    routings: routings as RoutingRow[],
    operations: operations as OperationRow[],
    wcTypes,
    machines,
    workers: workers as WorkerRow[],
    links,
  }
}

export interface PlanData {
  kpi: KpiBundle
  plan: SimPlan | null
}

/** Последний план с KPI; лента задач — именно этого плана (или null, если плана нет). */
export async function loadPlanData(): Promise<PlanData> {
  const kpi = await api.analytics.kpi()
  if (!kpi.plan_id) return { kpi, plan: null }
  const plan = await api.simulation.plan(kpi.plan_id)
  return { kpi, plan }
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'Неизвестная ошибка'
}
