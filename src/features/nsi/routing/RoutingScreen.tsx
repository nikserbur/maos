/**
 * Экран конструктора техкарты `#/nsi/routing/:id` (`new` — новая) вместо модала (X1 §2.1):
 * шапка «НСИ › Техкарты › …» с одной primary «Сохранить» (Cmd/Ctrl+S) и «Отмена» (Esc);
 * полоса инструментов: вкладки «Маршрут | Таблица», режим канваса; тело: канвас + инспектор;
 * внизу — мини-полоса маршрута. Сохранённая модель и API — те же (routingModel.payloadFromState).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../../../lib/api'
import { navigateTo } from '../../../shell/router'
import { PillTabs } from '../kit/PillTabs'
import { fmtValue } from '../../../explain/format'
import { invalidateNsi, useOperations, useProducts, useWorkCenterTypes } from '../useNsi'
import type { GraphCanvasHandle } from '../../../ui/graph-canvas'
import { RoutingCanvas, type CanvasMode } from './RoutingCanvas'
import { RoutingInspector } from './RoutingInspector'
import { RouteStrip, RoutingTable } from './RoutingTable'
import { INIT_STATE, opsFromApi, payloadFromState, routingReducer, sortOps, totalMinutes, validateRouting } from './routingModel'
import './routing.css'

type Tab = 'route' | 'table'

const TABS = [{ id: 'route' as const, label: 'Маршрут' }, { id: 'table' as const, label: 'Таблица' }]
const MODES = [{ id: 'io' as const, label: 'Входы/выходы' }, { id: 'wc' as const, label: 'Оборудование' }, { id: 'time' as const, label: 'Время' }]

interface RoutingScreenProps {
  /** id техкарты или `new`. */
  id: string
}

export function RoutingScreen({ id }: RoutingScreenProps) {
  const isNew = id === 'new'
  const [state, dispatch] = useReducer(routingReducer, INIT_STATE)
  const products = useProducts()
  const registryOps = useOperations()
  const wcTypes = useWorkCenterTypes()
  const [tab, setTab] = useState<Tab>('route')
  const [mode, setMode] = useState<CanvasMode>('wc')
  const [fitToken, setFitToken] = useState(0)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const canvasRef = useRef<GraphCanvasHandle>(null)

  // Редактирование: техкарта + её операции из реестра.
  useEffect(() => {
    if (isNew) return
    let alive = true
    setLoading(true); setLoadError(null)
    Promise.all([api.routings.get(id), api.operations.list()])
      .then(([routing, ops]) => {
        if (!alive) return
        dispatch({ type: 'INIT', name: routing.name ?? '', productId: routing.product_id ?? '', ops: opsFromApi(ops, id) })
      })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить техкарту') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id, isNew])

  const sorted = useMemo(() => sortOps(state.ops), [state.ops])
  const total = useMemo(() => totalMinutes(sorted), [sorted])
  const selected = sorted.find((o) => o.id === state.selectedId) ?? null
  const selectedIndex = selected ? sorted.indexOf(selected) : -1
  const knownWc = useMemo(() => new Set(wcTypes.map((t) => t.name)), [wcTypes])
  const product = products.find((p) => p.id === state.productId)

  const leave = useCallback(() => navigateTo('nsi', 'routing'), [])

  const cancel = useCallback(() => {
    if (state.dirty && !window.confirm('Есть несохранённые изменения. Закрыть конструктор без сохранения?')) return
    leave()
  }, [state.dirty, leave])

  const save = useCallback(async () => {
    const problem = validateRouting(state)
    if (problem) { setSaveError(problem); return }
    setSaving(true); setSaveError(null)
    try {
      // Редактирование = замена: старая техкарта удаляется (операции уходят каскадом), создаётся новая.
      if (!isNew) await api.routings.delete(id)
      await api.routings.create(payloadFromState(state, wcTypes))
      invalidateNsi('operations')
      leave()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }, [state, isNew, id, wcTypes, leave])

  // Esc — отмена, Cmd/Ctrl+S — сохранить (на всём экране).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'ы')) { e.preventDefault(); void save(); return }
    if (e.key === 'Escape') {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') { t.blur(); return }
      e.preventDefault(); cancel()
    }
  }

  const title = state.name || (isNew ? 'Новая техкарта' : 'Техкарта')

  return (
    <div className="rt" onKeyDown={onKeyDown}>
      <header className="rt-head">
        <nav className="rt-crumbs" aria-label="Путь">
          <button type="button" className="rt-crumbs__link" onClick={cancel}>НСИ</button>
          <span aria-hidden="true">›</span>
          <button type="button" className="rt-crumbs__link" onClick={cancel}>Техкарты</button>
          <span aria-hidden="true">›</span>
          <span className="rt-crumbs__cur">{title}</span>
        </nav>
        <div className="rt-head__main">
          <input className="rt-head__name" value={state.name} placeholder="Название техкарты" aria-label="Название техкарты"
            onChange={(e) => dispatch({ type: 'SET_NAME', value: e.target.value })} />
          <select className="form__select rt-head__product" value={state.productId} aria-label="Изделие"
            onChange={(e) => dispatch({ type: 'SET_PRODUCT', value: e.target.value })}>
            <option value="">— изделие —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
          </select>
          <span className="rt-head__meta num">{sorted.length} оп · {fmtValue(total, 'мин')}{product ? '' : ''}</span>
          {state.dirty && <span className="rt-head__dirty" title="Есть несохранённые изменения">● изменено</span>}
          <span className="rt-head__actions">
            <button type="button" className="btn btn--ghost" onClick={cancel} disabled={saving}>Отмена</button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving || loading} title="Cmd/Ctrl+S">
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </span>
        </div>
        {(saveError || loadError) && (
          <p className="rt-error" role="alert"><span className="glyph-down" aria-hidden="true" /> {saveError ?? loadError}</p>
        )}
      </header>

      <div className="rt-tools">
        <PillTabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Представление маршрута" idBase="rt" />
        {tab === 'route' && (
          <PillTabs tabs={MODES} value={mode} onChange={setMode} ariaLabel="Что показывать на узлах" />
        )}
        <span className="rt-tools__hint rt-muted">
          {tab === 'route' ? 'Колесо — масштаб · перетаскивание — сдвиг · F — вписать · Esc — закрыть · Cmd+S — сохранить' : 'Клик по строке — выбрать операцию'}
        </span>
      </div>

      <div className="rt-body">
        {loading ? (
          <div className="rt-loading" role="status">Загружаем техкарту…</div>
        ) : tab === 'route' ? (
          <RoutingCanvas ref={canvasRef} ops={sorted} selectedId={state.selectedId} mode={mode} fitToken={fitToken} knownWc={knownWc}
            onSelect={(sid) => dispatch({ type: 'SELECT', id: sid })} />
        ) : (
          <div id="rt-panel-table" role="tabpanel" aria-labelledby="rt-tab-table" className="rt-tablepanel">
            <RoutingTable ops={sorted} selectedId={state.selectedId} onSelect={(sid) => dispatch({ type: 'SELECT', id: sid })} />
          </div>
        )}
        <RoutingInspector selected={selected} selectedIndex={selectedIndex} count={sorted.length} dispatch={dispatch}
          products={products} registryOps={registryOps} wcTypes={wcTypes} />
      </div>

      <RouteStrip ops={sorted} selectedId={state.selectedId}
        onSelect={(sid) => { dispatch({ type: 'SELECT', id: sid }); if (tab === 'route') setFitToken((t) => t + 1) }}
        onMoveTo={(sid, index) => dispatch({ type: 'MOVE_TO', id: sid, index })} />
    </div>
  )
}
