import { useState, useEffect } from 'react'
import {
  api,
  type WorkCenterType,
  type Machine,
  type Product,
  type Operation,
  type OrgUnit,
} from '../../lib/api'

/* ── Кэш справочников (stale-while-revalidate) ────────────────────────────────
 * Формы НСИ маунтятся при каждом открытии диалога, редактор техкарт — при каждом
 * переходе; без кэша каждый маунт = новый GET по всем справочникам. Кэш отдаёт
 * последние данные мгновенно и обновляет их фоновым запросом; параллельные
 * маунты делят один in-flight промис. */
const TTL_MS = 30_000

interface CacheEntry<T> {
  data: T[] | null
  fetchedAt: number
  inflight: Promise<T[]> | null
  listeners: Set<(data: T[]) => void>
}

const cache = new Map<string, CacheEntry<unknown>>()

function entryOf<T>(key: string): CacheEntry<T> {
  let e = cache.get(key) as CacheEntry<T> | undefined
  if (!e) {
    e = { data: null, fetchedAt: 0, inflight: null, listeners: new Set() }
    cache.set(key, e as CacheEntry<unknown>)
  }
  return e
}

function refetch<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  const e = entryOf<T>(key)
  if (e.inflight) return e.inflight
  e.inflight = fetcher()
    .then((data) => {
      e.data = data
      e.fetchedAt = Date.now()
      e.listeners.forEach((l) => l(data))
      return data
    })
    .finally(() => { e.inflight = null })
  return e.inflight
}

/** Сбросить кэш справочников (после create/update/delete): без ключа — весь. */
export function invalidateNsi(key?: string): void {
  if (key) { const e = cache.get(key); if (e) e.fetchedAt = 0 }
  else cache.forEach((e) => { e.fetchedAt = 0 })
}

function useCachedList<T>(key: string, fetcher: () => Promise<T[]>): T[] {
  const e = entryOf<T>(key)
  const [data, setData] = useState<T[]>(e.data ?? [])
  useEffect(() => {
    const entry = entryOf<T>(key)
    const listener = (d: T[]) => setData(d)
    entry.listeners.add(listener)
    if (entry.data) setData(entry.data)                    // мгновенно из кэша
    if (Date.now() - entry.fetchedAt > TTL_MS)             // фоновое обновление
      refetch(key, fetcher).catch(() => {})
    return () => { entry.listeners.delete(listener) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return data
}

export function useOrgUnits(): OrgUnit[] {
  return useCachedList('org_units', api.orgUnits.list)
}

export function useWorkCenterTypes(): WorkCenterType[] {
  return useCachedList('work_center_types', api.workCenterTypes.list)
}

export function useMachines(): Machine[] {
  return useCachedList('machines', api.machines.list)
}

export function useProducts(): Product[] {
  return useCachedList('products', api.products.list)
}

export function useOperations(): Operation[] {
  return useCachedList('operations', api.operations.list)
}
