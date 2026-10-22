/**
 * Кэш паспорта параметров (GET /api/passport, 125 строк со статусом Н/О/К/НОРМ/UI/техн./синтетика)
 * и финансовых параметров водопада (GET/PUT /api/fin_params). Один запрос на сессию (TTL),
 * подписка через useSyncExternalStore — карта, мастер плана и сценарии читают одно и то же.
 * Сбой запроса не роняет экраны: паспорт просто пуст, бейджи выводятся по умолчаниям кода.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, type FinParams, type PassportParam } from '../../lib/api'

export type PassportStatusLoad = 'idle' | 'loading' | 'ready' | 'error'

export interface PassportState {
  status: PassportStatusLoad
  /** Паспорт по коду (`fin.c0`, `macro.generator`, `r1.03`…). */
  byCode: Readonly<Record<string, PassportParam>>
  count: number
  byStatus: Readonly<Record<string, number>>
  note: string
  fin: FinParams | null
  finStatus: PassportStatusLoad
  loadedAt: number | null
  error: string | null
}

const TTL_MS = 120_000

let state: PassportState = {
  status: 'idle', byCode: {}, count: 0, byStatus: {}, note: '', fin: null, finStatus: 'idle', loadedAt: null, error: null,
}
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(next: PassportState): void {
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const getSnapshot = (): PassportState => state

export function getPassportState(): PassportState {
  return state
}

async function fetchAll(): Promise<void> {
  const [pass, fin] = await Promise.allSettled([api.finance.passport(), api.finance.params()])
  const next: PassportState = { ...state, loadedAt: Date.now() }
  if (pass.status === 'fulfilled') {
    const byCode = Object.fromEntries(pass.value.params.map((p) => [p.code, p]))
    Object.assign(next, { status: 'ready', byCode, count: pass.value.count, byStatus: pass.value.by_status, note: pass.value.note, error: null })
  } else {
    Object.assign(next, { status: 'error', error: 'паспорт недоступен — бейджи по умолчаниям кода' })
  }
  if (fin.status === 'fulfilled') Object.assign(next, { fin: fin.value, finStatus: 'ready' })
  else Object.assign(next, { finStatus: 'error' })
  emit(next)
}

/** Загрузить паспорт и fin_params, если кэш пуст или старше TTL. */
export function ensurePassport(force = false): Promise<void> {
  if (inflight) return inflight
  const fresh = state.loadedAt !== null && Date.now() - state.loadedAt < TTL_MS
  if (fresh && !force) return Promise.resolve()
  emit({ ...state, status: state.loadedAt === null ? 'loading' : state.status, finStatus: state.fin ? state.finStatus : 'loading' })
  inflight = fetchAll()
    .catch(() => emit({ ...state, status: 'error', finStatus: 'error', error: 'нет связи с сервером' }))
    .finally(() => { inflight = null })
  return inflight
}

/** PUT /api/fin_params → обновлённые параметры в кэш (иммутабельно). */
export async function saveFinParams(patch: Partial<FinParams>): Promise<FinParams> {
  const fin = await api.finance.saveParams(patch)
  emit({ ...state, fin, finStatus: 'ready' })
  return fin
}

/** PUT /api/passport/:code (бэкенд отвергает «О» без source и n_obs). */
export async function savePassportParam(code: string, patch: Partial<PassportParam> & { n_obs?: number }): Promise<PassportParam> {
  const p = await api.finance.updatePassport(code, patch)
  emit({ ...state, byCode: { ...state.byCode, [p.code]: p } })
  return p
}

export function usePassport(): PassportState {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { void ensurePassport() }, [])
  return s
}

/** Только для тестов. */
export function resetPassportStore(next?: Partial<PassportState>): void {
  emit({ status: 'idle', byCode: {}, count: 0, byStatus: {}, note: '', fin: null, finStatus: 'idle', loadedAt: null, error: null, ...next })
}
