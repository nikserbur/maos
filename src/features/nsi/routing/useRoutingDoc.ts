/**
 * Техкарта конструктора: загрузка (GET /routings/:id с операциями), 404 отдельно от прочих ошибок
 * (P-44: несуществующая техкарта — не пустой редактор), и сохранение (P-42): без изменений — без
 * запроса; проверка и блокировка с объяснением при нажатии; подтверждение версии; сначала создаётся
 * новая версия, потом удаляется открытая (сбой создания ничего не теряет); переход на новый id без
 * новой записи истории — «Назад» не ведёт на удалённую техкарту.
 */
import { useEffect, useReducer, useState } from 'react'
import { api, type Product, type Routing, type WorkCenterType } from '../../../lib/api'
import { markInputsChanged } from '../../../shell/context'
import { replaceRoute } from '../../../shell/router'
import { invalidateNsi } from '../useNsi'
import { INIT_STATE, opsFromApi, payloadFromState, routingReducer, saveBlocker, setupLossCount, validateRouting } from './routingModel'
import { rememberMove, versionPlan, type VersionPlan } from './routingVersion'

const isNotFound = (e: unknown): boolean => {
  const status = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : NaN
  return status === 404 || (e instanceof Error && /not found/i.test(e.message))
}

/** Сообщения для экрана, открывшегося после сохранения (экран пересоздаётся на новом id). */
const flash = new Map<string, { status?: string; warning?: string }>()

export function useRoutingDoc(id: string) {
  const isNew = id === 'new'
  const [state, dispatch] = useReducer(routingReducer, INIT_STATE)
  const [meta, setMeta] = useState<Routing | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [notFound, setNotFound] = useState(false)
  const [tick, setTick] = useState(0)
  const [message] = useState(() => { const m = flash.get(id) ?? {}; flash.delete(id); return m })

  useEffect(() => {
    if (isNew) return undefined
    let alive = true
    setLoading(true); setLoadError(null); setNotFound(false)
    // Типы станков нужны, чтобы прочитать связи операций; их сбой не мешает открыть техкарту.
    const types = api.workCenterTypes.list().then((t) => t, () => [] as WorkCenterType[])
    Promise.all([api.routings.get(id), types])
      .then(([routing, wc]) => {
        if (!alive) return
        setMeta(routing)
        dispatch({ type: 'INIT', name: routing.name ?? '', productId: routing.product_id ?? '', ops: opsFromApi(routing.operations ?? [], id, wc) })
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (isNotFound(e)) setNotFound(true)
        else setLoadError(e)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id, isNew, tick])

  return { isNew, state, dispatch, meta, loading, loadError, notFound, message, reload: () => setTick((t) => t + 1) }
}

interface SaveDeps {
  id: string
  isNew: boolean
  state: ReturnType<typeof useRoutingDoc>['state']
  meta: Routing | null
  routings: ReadonlyArray<Routing>
  products: ReadonlyArray<Product>
  wcTypes: ReadonlyArray<WorkCenterType>
}

export function useRoutingSave({ id, isNew, state, meta, routings, products, wcTypes }: SaveDeps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [note, setNote] = useState<string | null>(null)
  const [plan, setPlan] = useState<VersionPlan | null>(null)

  /** Нажатие «Сохранить»: объяснить, почему нельзя, или спросить подтверждение версии. */
  const request = () => {
    setNote(null)
    setError(null)
    if (!state.dirty) { setNote('Изменений нет — сохранять нечего'); return }
    const problem = validateRouting(state) ?? saveBlocker(state)
    if (problem) { setError(problem); return }
    setPlan(versionPlan({ productId: state.productId, products, routings, editing: isNew ? null : meta, setupLoss: setupLossCount(state.ops) }))
  }

  const perform = async () => {
    if (!plan) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.routings.create(payloadFromState(state, wcTypes))
      let warning: string | undefined
      if (!isNew && created.id !== id) {
        try {
          await api.routings.delete(id)
        } catch {
          warning = 'Новая версия сохранена, но прежнюю удалить не удалось — она осталась недействующей. Повторите удаление позже.'
        }
        rememberMove(id, created.id, state.productId)
      }
      invalidateNsi('operations')
      invalidateNsi('routings')
      markInputsChanged('nsi')
      flash.set(created.id, { status: `Сохранено как v${plan.next}`, warning })
      setPlan(null)
      replaceRoute('nsi', `routing/${created.id}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    } catch (e) {
      setError(e)
      setPlan(null)
    } finally {
      setSaving(false)
    }
  }

  return { saving, error, note, plan, request, perform, cancel: () => setPlan(null) }
}
