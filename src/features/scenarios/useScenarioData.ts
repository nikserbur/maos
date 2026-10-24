/**
 * Данные экрана «Сценарии»: реестр (полные сценарии с распределениями), изделия, режимы генератора;
 * правки — с задержкой 400 мс (один PUT на серию движений ползунка), уход с экрана досылает
 * несохранённое. Ошибки не глотаются: загрузка, сохранение и действия (клон, удаление, создание)
 * возвращают понятный текст для баннера. Успешное сохранение отмечает «входы изменились» —
 * полоса методологии покажет «портфель ▲ устарело».
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type MacroRegimes, type PriceDistribution, type PriceScenario, type Product } from '../../lib/api'
import { markInputsChanged } from '../../shell/context'
import { ensureRefs, invalidateScenario } from '../method-map/useMethodMapState'
import { payloadOf } from './scenarioPayload'
import type { ScenarioTemplate } from './scenarioTemplates'
import { SIGMA_DEFAULT, BETA_DEFAULT } from './distModel'

/** Ползунки сохраняются с задержкой: один PUT на серию движений, а не на каждый тик (UX-V2 §5.1). */
const SAVE_DEBOUNCE_MS = 400

export type SaveStatus = 'pending' | 'saved' | 'error'
export type LoadStatus = 'loading' | 'ready' | 'error'

export interface ActionError { title: string; error: unknown; retry?: () => void }

export interface ScenarioData {
  scenarios: PriceScenario[]
  products: Product[]
  productsFailed: boolean
  regimes: MacroRegimes | null
  status: LoadStatus
  loadError: unknown
  saveStatus: Readonly<Record<string, SaveStatus>>
  actionError: ActionError | null
  dismissError: () => void
  reload: () => Promise<void>
  patch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
  setDists: (sc: PriceScenario, rows: PriceDistribution[]) => Promise<void>
  setDist: (sc: PriceScenario, productId: string, p: Partial<PriceDistribution>) => Promise<void>
  clone: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<boolean>
  create: (name: string, description: string, tpl: ScenarioTemplate | null) => Promise<string | null>
  /** Отмена удаления: сценарий создаётся заново из сохранённой копии (новый id). */
  restore: (sc: PriceScenario) => Promise<string | null>
}

export function useScenarioData(): ScenarioData {
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [productsFailed, setProductsFailed] = useState(false)
  const [regimes, setRegimes] = useState<MacroRegimes | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({})
  const [actionError, setActionError] = useState<ActionError | null>(null)
  const saveTimers = useRef(new Map<string, number>())
  const pending = useRef(new Map<string, PriceScenario>())
  const productsRef = useRef<Product[]>([])
  productsRef.current = products

  const reload = useCallback(async () => {
    try {
      const list = await api.scenarios.list()
      // Полные сценарии (с распределениями); сбой одного не роняет список — остаётся краткая запись.
      const full = await Promise.all(list.map((s) => api.scenarios.get(s.id).catch(() => s)))
      setScenarios(full)
      setStatus('ready')
      setLoadError(null)
    } catch (e) {
      setStatus('error')
      setLoadError(e)
    }
  }, [])

  useEffect(() => {
    void reload()
    void ensureRefs()
    api.products.list()
      .then((ps) => { setProducts(ps.filter((p) => p.sellable === '1' || p.purchased === '1')); setProductsFailed(false) })
      .catch(() => setProductsFailed(true))
    api.macro.regimes().then(setRegimes).catch(() => setRegimes(null))
  }, [reload])

  const markSaved = (id: string) => {
    setSaveStatus((st) => ({ ...st, [id]: 'saved' }))
    invalidateScenario(id)
    markInputsChanged('scenario')
  }

  const flushSave = (id: string) => {
    const next = pending.current.get(id)
    saveTimers.current.delete(id)
    if (!next) return
    pending.current.delete(id)
    api.scenarios.update(id, payloadOf(next))
      .then(() => markSaved(id))
      .catch(() => setSaveStatus((st) => ({ ...st, [id]: 'error' })))
  }

  const patch = (sc: PriceScenario, p: Partial<PriceScenario>) => {
    const next = { ...(pending.current.get(sc.id) ?? sc), ...p }
    setScenarios((list) => list.map((x) => (x.id === sc.id ? next : x)))
    pending.current.set(sc.id, next)
    setSaveStatus((st) => ({ ...st, [sc.id]: 'pending' }))
    const prev = saveTimers.current.get(sc.id)
    if (prev) window.clearTimeout(prev)
    saveTimers.current.set(sc.id, window.setTimeout(() => flushSave(sc.id), SAVE_DEBOUNCE_MS))
  }

  useEffect(() => () => {
    for (const id of [...saveTimers.current.keys()]) { window.clearTimeout(saveTimers.current.get(id)); flushSave(id) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const distDefault = (productId: string): PriceDistribution => {
    const p = productsRef.current.find((x) => x.id === productId)
    const base = Number((p?.purchased === '1' ? p?.base_cost : p?.base_price) || 0)
    return { product_id: productId, dist_type: 'normal', mean: base, stddev: Math.round(base * SIGMA_DEFAULT), beta: BETA_DEFAULT }
  }

  const setDists = async (sc: PriceScenario, rows: PriceDistribution[]) => {
    const ids = new Set(rows.map((r) => r.product_id))
    const cur = pending.current.get(sc.id) ?? sc
    const distributions = [...(cur.distributions ?? []).filter((d) => !ids.has(d.product_id)), ...rows]
    const next = { ...cur, distributions }
    setScenarios((list) => list.map((x) => (x.id === sc.id ? next : x)))
    setSaveStatus((st) => ({ ...st, [sc.id]: 'pending' }))
    try {
      await api.scenarios.update(sc.id, payloadOf(next, { distributions }))
      markSaved(sc.id)
    } catch (e) {
      setSaveStatus((st) => ({ ...st, [sc.id]: 'error' }))
      setActionError({ title: 'Распределения не сохранены', error: e, retry: () => { void setDists(sc, rows) } })
    }
  }
  const setDist = (sc: PriceScenario, productId: string, p: Partial<PriceDistribution>) => {
    const cur = (sc.distributions ?? []).find((d) => d.product_id === productId) ?? distDefault(productId)
    return setDists(sc, [{ ...cur, ...p }])
  }

  const clone = async (id: string): Promise<string | null> => {
    try {
      const sc = await api.scenarios.clone(id)
      await reload()
      return sc?.id ?? null
    } catch (e) {
      setActionError({ title: 'Копия сценария не создана', error: e, retry: () => { void clone(id) } })
      return null
    }
  }

  const remove = async (id: string): Promise<boolean> => {
    try {
      await api.scenarios.delete(id)
      await reload()
      return true
    } catch (e) {
      setActionError({ title: 'Сценарий не удалён', error: e })
      return false
    }
  }

  const createFrom = async (payload: Parameters<typeof api.scenarios.create>[0], title: string): Promise<string | null> => {
    try {
      const sc = await api.scenarios.create(payload)
      await reload()
      return sc?.id ?? null
    } catch (e) {
      setActionError({ title, error: e })
      return null
    }
  }

  const create = (name: string, description: string, tpl: ScenarioTemplate | null) => createFrom({
    name, description: description || undefined, ...(tpl?.values ?? {}),
    distributions: productsRef.current.map((p) => distDefault(p.id)),
  }, 'Сценарий не создан')

  const restore = (sc: PriceScenario) => createFrom(
    payloadOf(sc, { distributions: sc.distributions ?? [], overrides: sc.overrides ?? [] }), 'Сценарий не восстановлен',
  )

  return {
    scenarios, products, productsFailed, regimes, status, loadError, saveStatus, actionError,
    dismissError: () => setActionError(null), reload, patch, setDists, setDist, clone, remove, create, restore,
  }
}
