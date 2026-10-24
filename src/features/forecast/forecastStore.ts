/**
 * Хранилище прогноза (модульное, как optStore): последний опубликованный прогноз с родословной
 * (сценарий, источник, N прогонов, время) — читают «Мониторинг», карта и полоса методологии; кэш
 * ответов /api/forecast по ключу `${сценарий}|${режим}|${месяцы}` — повторный вход на вкладку не
 * пересчитывает, «Обновить» пересчитывает, не убирая прежний ответ. Обновления иммутабельные.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { api, type ForecastParams, type ForecastResult } from '../../lib/api'

export interface ForecastMeta {
  scenarioId: string | null
  scenarioName: string | null
  /** scenario — условия сценария; manual — ручные параметры «Мониторинга». */
  source: 'scenario' | 'manual'
  runs: number
  /** Когда рассчитан (ms epoch). */
  at: number
}

export interface PublishedForecast { result: ForecastResult; meta: ForecastMeta }

let published: PublishedForecast | null = null
const listeners = new Set<() => void>()

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): PublishedForecast | null => published

/** Опубликовать прогноз (экран «Мониторинг», вкладка сценария). */
export function publishForecast(result: ForecastResult, meta: ForecastMeta): void {
  if (published?.result === result && published.meta.source === meta.source) return
  published = { result, meta }
  listeners.forEach((l) => l())
}

export function getForecastResult(): PublishedForecast | null {
  return published
}

export function useForecastResult(): PublishedForecast | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/* ── Кэш ответов по ключу ─────────────────────────────────────────────────── */

interface CacheEntry { result: ForecastResult; at: number }

const CACHE_MAX = 12
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry>>()

export function forecastKey(scenarioId: string, macroMode: string | undefined, months: number): string {
  return `${scenarioId}|${macroMode || 'base'}|${months}`
}

export function getCachedForecast(key: string): CacheEntry | undefined {
  return cache.get(key)
}

/** Ответ из кэша или запрос (одновременные запросы одного ключа — один); force — пересчитать. */
export function fetchForecast(key: string, params: ForecastParams, force = false): Promise<CacheEntry> {
  const hit = cache.get(key)
  if (hit && !force) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running
  const p = api.forecast(params).then((result) => {
    const entry = { result, at: Date.now() }
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
    return entry
  }).finally(() => { inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/** Только для тестов. */
export function resetForecastStore(): void {
  cache.clear()
  inflight.clear()
  published = null
  listeners.forEach((l) => l())
}

export interface CachedForecast {
  result: ForecastResult | null
  at: number | null
  loading: boolean
  error: unknown
  refresh: () => void
}

/** Прогноз по ключу: из кэша сразу, иначе загрузка; «Обновить» оставляет прежний ответ на экране. */
export function useCachedForecast(key: string, params: ForecastParams, enabled = true): CachedForecast {
  const [entry, setEntry] = useState<CacheEntry | null>(() => cache.get(key) ?? null)
  const [loading, setLoading] = useState(!cache.has(key))
  const [error, setError] = useState<unknown>(null)
  const [force, setForce] = useState<{ key: string; n: number }>({ key, n: 0 })
  const forced = force.key === key ? force.n : 0
  const paramsJson = JSON.stringify(params)

  useEffect(() => {
    let alive = true
    const cached = cache.get(key)
    setEntry(cached ?? null)
    if (!enabled || (cached && forced === 0)) { setLoading(false); setError(null); return undefined }
    setLoading(true)
    setError(null)
    fetchForecast(key, JSON.parse(paramsJson) as ForecastParams, forced > 0)
      .then((e) => { if (alive) setEntry(e) })
      .catch((e: unknown) => { if (alive) setError(e) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [key, paramsJson, forced, enabled])

  const refresh = useCallback(() => setForce((f) => ({ key, n: (f.key === key ? f.n : 0) + 1 })), [key])
  return { result: entry?.result ?? null, at: entry?.at ?? null, loading, error, refresh }
}
