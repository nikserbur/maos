/**
 * Экран конструктора техкарты `#/nsi/routing/:id` (`new` — новая; `?view=table`, `?mode=io|wc|time` —
 * в адресе): шапка с одной primary «Сохранить» (⌘/Ctrl+S), инструменты (вкладки, режим, «+ Операция»,
 * «Вписать»), канвас + инспектор 360, полоса маршрута. Крошки «Справочники › Техкарты › …» — в верхней
 * панели (setCrumbTitle). 404 — пустое состояние «не найдена», а не пустой редактор (P-44).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { navigateTo, setHashParams, useHashParams } from '../../../shell/router'
import { setCrumbTitle } from '../../../shell/crumbs'
import { useEscapeLayer } from '../../../shell/overlays'
import { useLeaveGuard } from '../../../shell/useLeaveGuard'
import { Icon } from '../../../shell/icons'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { EmptyState, ErrorBanner, PillTabs } from '../../../ui/kit'
import type { GraphCanvasHandle } from '../../../ui/graph-canvas'
import type { Routing } from '../../../lib/api'
import { isDefaultRouting } from '../registries'
import { useMachines, useOperations, useProducts, useRoutings, useWorkCenterTypesState } from '../useNsi'
import { RoutingCanvas, type CanvasMode } from './RoutingCanvas'
import { RoutingHeader } from './RoutingHeader'
import { RoutingInspector } from './RoutingInspector'
import { RouteStrip, RoutingTable } from './RoutingTable'
import { capacityBottleneck, sortOps, totalMinutes, type RoutingOp } from './routingModel'
import { movedProduct } from './routingVersion'
import { useRoutingDoc, useRoutingSave } from './useRoutingDoc'
import './routing.css'

type Tab = 'route' | 'table'

const TABS = [{ id: 'route' as const, label: 'Маршрут' }, { id: 'table' as const, label: 'Таблица' }]
const MODES = [{ id: 'io' as const, label: 'Входы/выходы' }, { id: 'wc' as const, label: 'Оборудование' }, { id: 'time' as const, label: 'Время' }]

export function RoutingScreen({ id }: { id: string }) {
  const doc = useRoutingDoc(id)
  const { isNew, state, dispatch, meta, loading, loadError, notFound, message } = doc
  const products = useProducts()
  const registryOps = useOperations()
  const wcState = useWorkCenterTypesState()
  const wcTypes = wcState.data
  const machines = useMachines()
  const routings = useRoutings()
  const save = useRoutingSave({ id, isNew, state, meta, routings, products, wcTypes })
  const [params] = useHashParams()
  const tab: Tab = params.view === 'table' ? 'table' : 'route'
  const mode: CanvasMode = params.mode === 'io' || params.mode === 'time' ? params.mode : 'wc'
  const [fitToken, setFitToken] = useState(0)
  const [addFocus, setAddFocus] = useState(0)
  const canvasRef = useRef<GraphCanvasHandle>(null)
  useLeaveGuard(state.dirty)

  const crumb = state.name || (isNew ? 'Новая техкарта' : notFound ? 'Техкарта не найдена' : '')
  useEffect(() => {
    setCrumbTitle('nsi', `routing/${id}`, crumb)
    return () => setCrumbTitle('nsi', `routing/${id}`, null)
  }, [id, crumb])

  const sorted = useMemo(() => sortOps(state.ops), [state.ops])
  const total = useMemo(() => totalMinutes(sorted), [sorted])
  const selected = sorted.find((o) => o.id === state.selectedId) ?? null
  // Пока справочник типов не загружен, судить «тип не найден» нельзя — null: проверка не делается.
  const knownWc = useMemo(() => (wcState.loaded ? new Set(wcTypes.map((t) => t.name)) : null), [wcState.loaded, wcTypes])
  const machinesOf = useCallback((op: RoutingOp) => {
    const lead = wcTypes.find((t) => t.name === op.wcType)?.id
    const ids = new Set([...(lead ? [lead] : []), ...op.wcTypeIds])
    return machines.filter((m) => ids.has(m.wc_type_id) && (m.status || 'active') === 'active').length
  }, [wcTypes, machines])
  const bottleneck = useMemo(() => (machines.length ? capacityBottleneck(sorted, machinesOf) : null), [sorted, machinesOf, machines.length])

  // «Отмена»/Esc — к списку; несохранённое охраняет страж ухода (один вопрос «уйти?»).
  const leave = useCallback(() => navigateTo('nsi', 'routing'), [])
  useEscapeLayer('scene', leave, !save.plan)
  const requestRef = useRef(save.request)
  requestRef.current = save.request
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && /^[sSыЫ]$/.test(e.key)) { e.preventDefault(); requestRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Первый Esc в поле ввода только снимает фокус (textarea/select — так делает стек Esc).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (e.key === 'Escape' && t.tagName === 'INPUT') { e.preventDefault(); t.blur() }
  }

  if (notFound) return <RoutingMissing id={id} routings={routings} productCode={(pid) => products.find((p) => p.id === pid)?.code ?? ''} />
  if (loadError) {
    return (
      <div className="rt rt--state">
        <ErrorBanner error={loadError} title="Техкарта не загрузилась" onRetry={doc.reload} />
        <a className="btn" href="#/nsi/routing">К списку техкарт</a>
      </div>
    )
  }

  const select = (sid: string | null) => dispatch({ type: 'SELECT', id: sid })
  const startAdd = () => { select(null); setAddFocus((t) => t + 1) }

  return (
    <div className="rt" onKeyDown={onKeyDown}>
      <header className="rt-head">
        <RoutingHeader state={state} dispatch={dispatch} products={products} meta={meta} opsCount={sorted.length} totalMin={total}
          saving={save.saving} onCancel={leave} onSave={save.request} />
        {message.warning && <ErrorBanner tone="setup" title={message.warning} />}
        {save.error ? <ErrorBanner tone={typeof save.error === 'string' ? 'setup' : 'down'} error={typeof save.error === 'string' ? undefined : save.error}
          title={typeof save.error === 'string' ? save.error : undefined} /> : null}
        {wcState.error && !wcState.loaded ? (
          <ErrorBanner tone="setup" title="Справочник «Типы оборудования» не загрузился" message="Типы станков операций не проверены, список выбора пуст." onRetry={wcState.reload} />
        ) : null}
        <p className="rt-status" role="status" aria-live="polite">{save.note ?? (state.dirty ? '' : message.status ?? '')}</p>
      </header>

      <div className="rt-tools">
        <PillTabs tabs={TABS} value={tab} onChange={(v) => setHashParams({ view: v === 'table' ? 'table' : null })} ariaLabel="Представление маршрута" idBase="rt" />
        {tab === 'route' && (
          <PillTabs tabs={MODES} value={mode} onChange={(v) => setHashParams({ mode: v === 'wc' ? null : v })} ariaLabel="Что показывать на узлах" />
        )}
        <span className="rt-tools__spacer" />
        {tab === 'route' && (
          <button type="button" className="btn btn--ghost btn--sm" aria-keyshortcuts="F" title="Вписать маршрут (F)" onClick={() => setFitToken((t) => t + 1)}>Вписать</button>
        )}
        <button type="button" className="btn btn--sm" onClick={startAdd}><Icon name="plus" size={14} />Операция</button>
      </div>

      <div className="rt-body">
        {loading ? (
          <div className="rt-loading" role="status">Загружаем техкарту…</div>
        ) : tab === 'route' ? (
          <RoutingCanvas ref={canvasRef} ops={sorted} selectedId={state.selectedId} mode={mode} fitToken={fitToken} knownWc={knownWc}
            bottleneck={bottleneck} onSelect={select} />
        ) : (
          <div id="rt-panel-table" role="tabpanel" aria-labelledby="rt-tab-table" className="rt-tablepanel">
            <RoutingTable ops={sorted} selectedId={state.selectedId} knownWc={knownWc} bottleneck={bottleneck} onSelect={select} />
          </div>
        )}
        <RoutingInspector selected={selected} selectedIndex={selected ? sorted.indexOf(selected) : -1} count={sorted.length} dispatch={dispatch}
          products={products} registryOps={registryOps} wcTypes={wcTypes} addFocus={addFocus} />
      </div>

      {tab === 'route' && (
        <RouteStrip ops={sorted} selectedId={state.selectedId} bottleneckId={sorted.length > 1 ? bottleneck?.id ?? null : null}
          onSelect={(sid) => { select(sid); setFitToken((t) => t + 1) }}
          onMoveTo={(sid, index) => dispatch({ type: 'MOVE_TO', id: sid, index })} />
      )}

      {save.plan && (
        <ConfirmDialog title={save.plan.title} objectName={state.name} consequence={save.plan.consequence}
          confirmLabel={save.plan.confirmLabel} busy={save.saving} onCancel={save.cancel} onConfirm={() => void save.perform()}>
          {save.plan.notes.length > 0 ? <ul className="rt-confirm-notes">{save.plan.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        </ConfirmDialog>
      )}
    </div>
  )
}

/** Несуществующая техкарта: объяснение и выход, без редактора и без «Сохранить». */
function RoutingMissing({ id, routings, productCode }: { id: string; routings: ReadonlyArray<Routing>; productCode: (pid: string) => string }) {
  const pid = movedProduct(id)
  const active = pid ? routings.find((r) => r.product_id === pid && isDefaultRouting(r)) : undefined
  return (
    <div className="rt rt--state">
      <EmptyState
        kind="unavailable"
        title="Техкарта не найдена — возможно, её пересохранили как новую версию"
        text="При сохранении создаётся новая версия с новым адресом, а прежняя удаляется."
        action={(
          <span className="rt-missing__actions">
            <a className="btn" href="#/nsi/routing">К списку техкарт</a>
            {active && <a className="btn" href={`#/nsi/routing/${encodeURIComponent(active.id)}`}>Открыть действующую для {productCode(active.product_id) || 'изделия'}</a>}
          </span>
        )}
      />
    </div>
  )
}
