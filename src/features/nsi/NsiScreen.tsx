import { useState, useEffect, useMemo } from 'react'
import { REGISTRIES, type RegistryColumn } from './registries'
import { CreateDialog } from './CreateDialog'
import { RoutingScreen } from './routing/RoutingScreen'
import { api, type WorkCenterType, type Product } from '../../lib/api'
import { KIND_META } from '../plant-scene/graph/sceneModel'
import { useHashRoute } from '../../shell/router'
import { dateTime, fmtValue } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { DataTable, ScreenHeader, type DataColumn } from '../../ui/kit'
import './nsi.css'

type AnyRow = Record<string, unknown>

const FETCHERS: Record<string, () => Promise<unknown[]>> = {
  workcentertype: () => api.workCenterTypes.list(),
  machine:        () => api.machines.list(),
  product:        () => api.products.list(),
  routing:        () => api.routings.list(),
  operation:      () => api.operations.list(),
  worker:         () => api.workers.list(),
}

const KIND_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(KIND_META).map(([k, v]) => [k, v.label]),
)

const STATUS_LABELS: Record<string, string> = {
  active: 'В работе',
  maintenance: 'ТО',
  decommissioned: 'Выведено',
  '1': 'Да',
  '0': 'Нет',
}

const YES_NO = (s: string) => (s === '1' ? 'Да' : 'Нет')

/** Текст ячейки: FK → имя, коды → подписи, числа/даты — через format.ts. */
function cellText(col: RegistryColumn, val: unknown, wcTypes: WorkCenterType[], products: Product[]): string {
  if (val === null || val === undefined || val === '') return '—'
  if (col.num) return fmtValue(typeof val === 'number' ? val : Number(val), col.unit)
  const s = String(val)
  switch (col.key) {
    case 'wc_type_id': return wcTypes.find((x) => x.id === s)?.name ?? s
    case 'parent_id': { const p = products.find((x) => x.id === s); return p ? `${p.code} ${p.name}` : s }
    case 'product_id': { const p = products.find((x) => x.id === s); return p ? `${p.code} ${p.name}` : s }
    case 'kind': return KIND_LABELS[s] ?? s
    case 'status': return STATUS_LABELS[s] ?? s
    case 'created_at': return dateTime(s)
    case 'interchangeable':
    case 'purchased':
    case 'setup_required': return YES_NO(s)
    default: return Array.isArray(val) ? String((val as unknown[]).length) : s
  }
}

const roleOf = (row: AnyRow) =>
  String(row.purchased) === '1' ? 'Сырьё (вход)' : String(row.sellable) === '1' ? 'Товар' : 'Полуфабрикат'

/**
 * Справочники: `#/nsi/<реестр>` — реестр в адресе (переживает F5), `#/nsi/routing/<id|new>` —
 * конструктор техкарты экраном вместо модала (G3 1.4). Таблица — DataTable кита (G3 2.1).
 */
export function NsiScreen() {
  const { anchor, navigate } = useHashRoute()
  const [seg, routingId] = (anchor ?? '').split('/')
  const activeId = REGISTRIES.some((r) => r.id === seg) ? seg : REGISTRIES[0].id
  const setActiveId = (id: string) => navigate('nsi', id)
  const [createOpen, setCreateOpen] = useState(false)
  const [editRow, setEditRow]       = useState<AnyRow | null>(null)
  const [rows, setRows]             = useState<AnyRow[]>([])
  const [loading, setLoading]       = useState(false)
  const [search, setSearch]         = useState('')

  // Справочные данные для резолвинга FK в таблице
  const [wcTypes,  setWcTypes]  = useState<WorkCenterType[]>([])
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    api.workCenterTypes.list().then(setWcTypes).catch(() => {})
    api.products.list().then(setProducts).catch(() => {})
  }, [])

  const active = REGISTRIES.find((r) => r.id === activeId) ?? REGISTRIES[0]

  const fetchRows = () => {
    const fetcher = FETCHERS[activeId]
    if (!fetcher) return
    setLoading(true)
    setRows([])
    fetcher()
      .then((d) => setRows(d as AnyRow[]))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRows() }, [activeId, routingId])

  const filtered = search.trim()
    ? rows.filter((r) =>
        Object.values(r).some((v) =>
          String(v ?? '').toLowerCase().includes(search.toLowerCase()),
        ),
      )
    : rows

  const columns = useMemo<DataColumn<AnyRow>[]>(() => active.columns.map((col, i) => ({
    key: col.key,
    title: col.title,
    num: col.num,
    rowHeader: i === 0,
    get: (row) => (col.key === 'role' ? roleOf(row) : col.num ? Number(row[col.key]) : cellText(col, row[col.key], wcTypes, products)),
    render: (row) => (col.key === 'role' ? roleOf(row) : cellText(col, row[col.key], wcTypes, products)),
  })), [active, wcTypes, products])

  const groupBy = active.groupBy
  const groupFn = useMemo(() => (groupBy ? (row: AnyRow) => String(row[groupBy] ?? '—') : undefined), [groupBy])

  const handleCreated = () => {
    setCreateOpen(false)
    fetchRows()
    // Обновляем справочные данные если изменился тип оборудования/изделие
    if (activeId === 'workcentertype') api.workCenterTypes.list().then(setWcTypes).catch(() => {})
    if (activeId === 'product')        api.products.list().then(setProducts).catch(() => {})
  }

  if (activeId === 'routing' && routingId) return <RoutingScreen key={routingId} id={routingId} />

  const openCreate = () => (activeId === 'routing' ? navigate('nsi', 'routing/new') : setCreateOpen(true))
  const openRow = (row: AnyRow) => (activeId === 'routing' ? navigate('nsi', `routing/${String(row.id ?? '')}`) : setEditRow(row))
  const rowHint = activeId === 'routing' ? 'Открыть конструктор техкарты' : 'Открыть для редактирования'

  return (
    <div className="nsi">
      {createOpen && (
        <CreateDialog registryId={activeId} onClose={handleCreated} />
      )}
      {editRow && (
        <CreateDialog
          registryId={activeId}
          edit={{ id: String(editRow.id ?? ''), row: editRow }}
          onClose={() => { setEditRow(null); handleCreated() }}
        />
      )}

      <aside className="nsi__list">
        <div className="nsi__list-title text-caps">Реестры</div>
        {REGISTRIES.map((registry) => (
          <button
            key={registry.id}
            type="button"
            className={registry.id === activeId ? 'nsi__item nsi__item--active' : 'nsi__item'}
            aria-current={registry.id === activeId ? 'true' : undefined}
            onClick={() => { setActiveId(registry.id); setSearch('') }}
          >
            {registry.title}
          </button>
        ))}
      </aside>

      <section className="nsi__panel">
        <ScreenHeader
          eyebrow="Модель · справочники"
          title={active.title}
          subtitle={active.description}
          blocks={['internal']}
          actions={(
            <button type="button" className="btn btn--primary" onClick={openCreate}>
              <Icon name="plus" size={14} />Создать
            </button>
          )}
        />

        <div className="nsi__toolbar">
          <label className="nsi__search-wrap">
            <Icon name="search" size={14} />
            <input
              className="nsi__search"
              placeholder="Поиск по реестру…"
              aria-label="Поиск по реестру"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="nsi__count num" aria-live="polite">
            {loading ? 'Загрузка…' : `${filtered.length} записей`}
          </span>
        </div>

        <DataTable
          className="nsi__table-wrap"
          framed
          columns={columns}
          rows={filtered}
          rowKey={(row, i) => String(row.id ?? row.tab_no ?? i)}
          groupBy={groupFn}
          loading={loading}
          onRowClick={openRow}
          rowTitle={() => rowHint}
          caption={`Реестр: ${active.title}`}
          empty={rows.length === 0 ? 'Записей нет — нажмите «Создать», чтобы добавить первую.' : 'Ничего не найдено.'}
        />
      </section>
    </div>
  )
}
