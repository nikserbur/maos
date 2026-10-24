import { useEffect, useMemo, useState } from 'react'
import { RecordPanel, createLabelFor } from './CreateDialog'
import { RegistryNav } from './RegistryNav'
import { LaborWarning } from './LaborWarning'
import { RoutingScreen } from './routing/RoutingScreen'
import { REGISTRIES } from './registries'
import { rowSearchText, useNsiData, viewFor } from './useNsiData'
import type { AnyRow } from './registryColumns'
import { anchorParts, confirmLeave, setHashParams, useHashRoute } from '../../shell/router'
import { markInputsChanged } from '../../shell/context'
import { screenTitle } from '../../shell/screens'
import { Icon } from '../../shell/icons'
import { Chip, DataTable, EmptyState, ErrorBanner, ScreenHeader, Segmented, countLabel, type SortState } from '../../ui/kit'
import { currentSession, workerAccess } from '../../shell/session'
import './nsi.css'

const STATUS_MS = 6000

/** `name.asc` ⇄ { key, dir }: сортировка живёт в адресе (F5 сохраняет вид). */
function parseSort(raw: string | undefined): SortState | null {
  const m = /^([\w-]+)\.(asc|desc)$/.exec(raw ?? '')
  return m ? { key: m[1], dir: m[2] as SortState['dir'] } : null
}

/**
 * Справочники: `#/nsi/<реестр>?q=…&sort=…&edit=<id>` — реестр, поиск, сортировка и открытая запись
 * в адресе (F5 восстанавливает вид); `#/nsi/routing/<id|new>` — конструктор техкарты экраном.
 * Таблица — DataTable кита; запись правится в боковой панели рядом с таблицей (P-50).
 */
export function NsiScreen() {
  const { anchor, params } = useHashRoute()
  const [seg, routingId] = anchorParts(anchor)
  const activeId = REGISTRIES.some((r) => r.id === seg) ? seg : REGISTRIES[0].id
  const active = REGISTRIES.find((r) => r.id === activeId) ?? REGISTRIES[0]
  const { lists, data, lk, lookupFailures } = useNsiData()
  // Права: full — правит весь НСИ; shop — начальник цеха нанимает только в свой цех; read — просмотр.
  const session = useMemo(() => currentSession(), [])
  const access = workerAccess(session)
  const q = params.q ?? ''
  const [search, setSearch] = useState(q)
  useEffect(() => { setSearch(q) }, [q])
  const [status, setStatus] = useState('')
  // Подтверждение записи видно несколько секунд рядом со счётчиком (и диктору — через role=status).
  useEffect(() => {
    if (!status) return undefined
    const t = window.setTimeout(() => setStatus(''), STATUS_MS)
    return () => window.clearTimeout(t)
  }, [status])
  const shopView = params.shop === 'all' ? 'all' : 'mine'
  const sort = parseSort(params.sort)

  const view = useMemo(() => viewFor(activeId, data, lk), [activeId, data, lk])
  const list = lists[activeId]
  const isWorkers = activeId === 'worker'
  const allRows = list.data as AnyRow[]
  const scoped = useMemo(() => (isWorkers && access === 'shop' && shopView === 'mine'
    ? allRows.filter((r) => String(r.org_unit_id ?? '') === session.orgUnitId)
    : allRows), [allRows, isWorkers, access, shopView, session.orgUnitId])
  const prepared = useMemo(() => (view.prepare ? view.prepare(scoped) : scoped), [view, scoped])
  const needle = search.trim().toLowerCase()
  const rows = useMemo(() => (needle ? prepared.filter((r) => rowSearchText(r, view).includes(needle)) : prepared), [prepared, needle, view])

  const editId = params.edit ?? null
  const creating = params.new === '1'
  const editRow = editId ? allRows.find((r) => String(r.id ?? '') === editId) ?? null : null
  // Открытая запись исчезла (удалена, другой реестр) — снимаем её из адреса.
  useEffect(() => {
    if (editId && list.loaded && !editRow) setHashParams({ edit: null })
  }, [editId, list.loaded, editRow])

  if (activeId === 'routing' && routingId) return <RoutingScreen key={routingId} id={routingId} />

  const canCreate = access === 'full' || (isWorkers && access === 'shop' && Boolean(session.orgUnitId))
  const canEditRow = (row: AnyRow) =>
    access === 'full' || (isWorkers && access === 'shop' && String(row.org_unit_id ?? '') === session.orgUnitId)
  const createLabel = isWorkers && access === 'shop' ? 'Нанять сотрудника' : activeId === 'routing' ? 'Создать техкарту' : createLabelFor(activeId)
  const readOnlyNote = isWorkers && access === 'shop' ? 'вы не привязаны к цеху — обратитесь к администратору' : 'только просмотр'

  const openPanel = (patch: Record<string, string | null>) => {
    if (!confirmLeave()) return
    setStatus('')
    setHashParams({ edit: null, new: null, ...patch })
  }
  const openCreate = () => {
    if (activeId === 'routing') { window.location.hash = '#/nsi/routing/new'; return }
    openPanel({ new: '1' })
  }
  const openRow = (row: AnyRow) => {
    if (activeId === 'routing') { window.location.hash = `#/nsi/routing/${encodeURIComponent(String(row.id ?? ''))}`; return }
    if (canEditRow(row)) openPanel({ edit: String(row.id ?? '') })
  }
  const rowHint = (row: AnyRow) => {
    if (activeId === 'routing') return 'Открыть конструктор техкарты'
    if (canEditRow(row)) return 'Открыть для правки'
    return isWorkers && access === 'shop' ? 'Сотрудник другого цеха — только просмотр' : 'Только просмотр'
  }
  const closePanel = () => setHashParams({ edit: null, new: null })
  const onSaved = (message?: string) => {
    list.reload()
    markInputsChanged('nsi')
    setStatus(message ?? 'Сохранено')
    closePanel()
  }
  const setQuery = (v: string) => { setSearch(v); setHashParams({ q: v.trim() ? v : null }) }

  const failures = lookupFailures(activeId)
  const showPanel = activeId !== 'routing' && ((creating && canCreate) || (editRow !== null && canEditRow(editRow)))
  const emptyNode = scoped.length === 0 ? (
    <EmptyState kind="first-use" size="sm" quiet title="В реестре пока нет записей"
      text={canCreate ? `Нажмите «${createLabel}», чтобы добавить первую.` : 'Записи добавляет администратор НСИ.'} />
  ) : (
    <EmptyState kind="no-results" size="sm" quiet title="Ничего не найдено" text={`По запросу «${search.trim()}» записей нет.`}
      action={<button type="button" className="btn" onClick={() => setQuery('')}>Сбросить поиск</button>} />
  )

  return (
    <div className={showPanel ? 'nsi nsi--with-panel' : 'nsi'}>
      <RegistryNav activeId={activeId} lists={lists} data={data} lk={lk} />

      <section className="nsi__panel" aria-labelledby="nsi-reg-title">
        {/* Реестр — в строке заголовка («Справочники › Типы оборудования · 39 записей»): на 1440×900 видно ≥ 20 строк. */}
        <ScreenHeader
          title={screenTitle('nsi')}
          subtitle={active.description}
          blocks={['internal']}
          provenance={(
            <span className="nsi__reg">
              <span className="nsi__reg-sep" aria-hidden="true">›</span>
              <h2 className="nsi__reg-title" id="nsi-reg-title">{active.title}</h2>
              <span className="nsi__count num" aria-live="polite">
                {list.loaded ? countLabel(rows.length, scoped.length) : list.error ? '' : 'загрузка…'}
                {list.loaded && view.note?.(rows) ? ` · ${view.note(rows)}` : ''}
              </span>
              <span className="nsi__saved" role="status">{status}</span>
            </span>
          )}
          actions={(
            <span className="nsi__toolbar">
              <label className="nsi__search-wrap">
                <Icon name="search" size={14} />
                <input className="nsi__search" type="search" placeholder="Поиск по реестру…" aria-label={`Поиск: ${active.title}`}
                  value={search} onChange={(e) => setQuery(e.target.value)} />
              </label>
              {isWorkers && access === 'shop' && (
                <Segmented label="Чьи сотрудники" value={shopView} onChange={(v) => setHashParams({ shop: v === 'all' ? 'all' : null })}
                  options={[{ id: 'mine', label: 'Мой цех' }, { id: 'all', label: 'Все цеха' }]} />
              )}
              {canCreate ? (
                <button type="button" className="btn" onClick={openCreate}><Icon name="plus" size={14} />{createLabel}</button>
              ) : (
                <Chip tone="idle" size="sm">{readOnlyNote}</Chip>
              )}
            </span>
          )}
        />

        {list.error ? (
          <ErrorBanner
            error={list.error}
            title={list.loaded ? `Реестр «${active.title}» не обновился — показаны прежние данные` : `Реестр «${active.title}» не загрузился`}
            onRetry={list.reload}
            tone={list.loaded ? 'setup' : 'down'}
          />
        ) : null}
        {failures.names.length > 0 && (
          <ErrorBanner tone="setup" title={`Не загрузились справочники: ${failures.names.join(', ')}`}
            message="Связанные названия и числа в таблице не показаны, пока справочник не загрузится." onRetry={failures.retry} />
        )}
        {(isWorkers || activeId === 'workcentertype') && list.loaded && (
          <LaborWarning compact data={data} />
        )}

        {!(list.error && !list.loaded) && (
          <DataTable
            className="nsi__table-wrap"
            framed
            tight
            hideEmptyColumns
            columns={view.columns}
            rows={rows}
            rowKey={(row, i) => String(row.id ?? row.tab_no ?? i)}
            groupBy={view.groupBy}
            groupLabel={view.groupLabel}
            sort={sort}
            onSortChange={(s) => setHashParams({ sort: s ? `${s.key}.${s.dir}` : null })}
            loading={!list.loaded || list.loading}
            onRowClick={openRow}
            rowTitle={rowHint}
            rowClassName={(row) => (editId && String(row.id ?? '') === editId ? 'is-chosen' : undefined)}
            caption={`Реестр: ${active.title}`}
            empty={emptyNode}
          />
        )}
      </section>

      {showPanel && (
        <RecordPanel
          key={creating ? `new:${activeId}` : `edit:${editId}`}
          registryId={activeId}
          edit={!creating && editRow ? { id: String(editRow.id ?? ''), row: editRow } : undefined}
          createLabel={createLabel}
          onClose={closePanel}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
