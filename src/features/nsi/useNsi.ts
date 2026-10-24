import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type WorkCenterType,
  type Machine,
  type Product,
  type Operation,
  type OrgUnit,
  type Routing,
  type Worker,
} from '../../lib/api'

/* ── Кэш справочников (stale-while-revalidate) ────────────────────────────────
 * Реестры, формы и конструктор техкарт читают одни и те же справочники; кэш отдаёт последние
 * данные мгновенно и обновляет их фоновым запросом; параллельные подписчики делят один in-flight
 * промис. Ошибка не проглатывается: она хранится в записи и видна подписчикам (баннер «Повторить»). */
const TTL_MS = 30_000

interface CacheEntry<T> {
  data: T[] | null
  error: unknown
  fetchedAt: number
  inflight: Promise<T[] | null> | null
  listeners: Set<() => void>
}

const cache = new Map<string, CacheEntry<unknown>>()

function entryOf<T>(key: string): CacheEntry<T> {
  let e = cache.get(key) as CacheEntry<T> | undefined
  if (!e) {
    e = { data: null, error: null, fetchedAt: 0, inflight: null, listeners: new Set() }
    cache.set(key, e as CacheEntry<unknown>)
  }
  return e
}

const notify = (e: CacheEntry<unknown>) => e.listeners.forEach((l) => l())

/** Загрузить список; ошибка сохраняется в записи (подписчики покажут её), промис не отклоняется. */
function refetch<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[] | null> {
  const e = entryOf<T>(key)
  if (e.inflight) return e.inflight
  const chained = fetcher()
    .then((data) => {
      e.data = data
      e.error = null
      e.fetchedAt = Date.now()
      return data
    }, (err: unknown) => {
      e.error = err
      return null
    })
    .finally(() => {
      e.inflight = null
      notify(e as CacheEntry<unknown>)
    })
  e.inflight = chained
  notify(e as CacheEntry<unknown>)
  return chained
}

/** Сбросить кэш справочников (после create/update/delete): без ключа — весь. */
export function invalidateNsi(key?: string): void {
  if (key) { const e = cache.get(key); if (e) e.fetchedAt = 0 }
  else cache.forEach((e) => { e.fetchedAt = 0 })
}

export interface ListState<T> {
  data: T[]
  /** Ошибка последней загрузки (данные при этом — последние удачные, если были). */
  error: unknown
  /** Данные хоть раз пришли. */
  loaded: boolean
  loading: boolean
  /** Принудительно перезагрузить (после записи или «Повторить»). */
  reload: () => void
}

function useCachedState<T>(key: string, fetcher: () => Promise<T[]>): ListState<T> {
  const read = () => {
    const e = entryOf<T>(key)
    return { data: e.data ?? [], error: e.error, loaded: e.data !== null, loading: e.inflight !== null }
  }
  const [snap, setSnap] = useState(read)
  useEffect(() => {
    const entry = entryOf<T>(key)
    const listener = () => setSnap(read())
    entry.listeners.add(listener)
    listener()                                               // мгновенно из кэша
    if (Date.now() - entry.fetchedAt > TTL_MS) void refetch(key, fetcher) // фоновое обновление
    return () => { entry.listeners.delete(listener) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { invalidateNsi(key); void refetch(key, fetcher) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...snap, reload }
}

export const NSI_KEYS = {
  orgUnits: 'org_units',
  wcTypes: 'work_center_types',
  machines: 'machines',
  products: 'products',
  operations: 'operations',
  routings: 'routings',
  workers: 'workers',
} as const

export const useOrgUnitsState = () => useCachedState<OrgUnit>(NSI_KEYS.orgUnits, api.orgUnits.list)
export const useWorkCenterTypesState = () => useCachedState<WorkCenterType>(NSI_KEYS.wcTypes, api.workCenterTypes.list)
export const useMachinesState = () => useCachedState<Machine>(NSI_KEYS.machines, api.machines.list)
export const useProductsState = () => useCachedState<Product>(NSI_KEYS.products, api.products.list)
export const useOperationsState = () => useCachedState<Operation>(NSI_KEYS.operations, api.operations.list)
export const useRoutingsState = () => useCachedState<Routing>(NSI_KEYS.routings, api.routings.list)
export const useWorkersState = () => useCachedState<Worker>(NSI_KEYS.workers, api.workers.list)

export function useOrgUnits(): OrgUnit[] { return useOrgUnitsState().data }
export function useWorkCenterTypes(): WorkCenterType[] { return useWorkCenterTypesState().data }
export function useMachines(): Machine[] { return useMachinesState().data }
export function useProducts(): Product[] { return useProductsState().data }
export function useOperations(): Operation[] { return useOperationsState().data }
export function useRoutings(): Routing[] { return useRoutingsState().data }
export function useWorkers(): Worker[] { return useWorkersState().data }
