import { useState, useEffect } from 'react'
import { REGISTRIES } from './registries'
import { CreateDialog } from './CreateDialog'
import { api, type WorkCenterType, type Product } from '../../lib/api'
import { KIND_META } from '../plant-scene/graph/sceneModel'
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

function cellText(
  col: string,
  val: unknown,
  wcTypes: WorkCenterType[],
  products: Product[],
): string {
  if (val === null || val === undefined || val === '') return '—'
  const s = String(val)

  if (col === 'wc_type_id') {
    const t = wcTypes.find((x) => x.id === s)
    return t ? t.name : s
  }
  if (col === 'parent_id') {
    const p = products.find((x) => x.id === s)
    return p ? `${p.code} ${p.name}` : s
  }
  if (col === 'kind') return KIND_LABELS[s] ?? s
  if (col === 'status') return STATUS_LABELS[s] ?? s
  if (col === 'interchangeable') return s === '1' ? 'Да' : 'Нет'
  if (col === 'purchased') return s === '1' ? 'Да' : 'Нет'
  if (Array.isArray(val)) return String((val as unknown[]).length)
  return s
}

export function NsiScreen() {
  const [activeId, setActiveId]     = useState(REGISTRIES[0].id)
  const [createOpen, setCreateOpen] = useState(false)
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

  useEffect(() => { fetchRows() }, [activeId])

  const filtered = search.trim()
    ? rows.filter((r) =>
        Object.values(r).some((v) =>
          String(v ?? '').toLowerCase().includes(search.toLowerCase()),
        ),
      )
    : rows

  const handleCreated = () => {
    setCreateOpen(false)
    fetchRows()
    // Обновляем справочные данные если изменился тип оборудования/изделие
    if (activeId === 'workcentertype') api.workCenterTypes.list().then(setWcTypes).catch(() => {})
    if (activeId === 'product')        api.products.list().then(setProducts).catch(() => {})
  }

  return (
    <div className="nsi">
      {createOpen && (
        <CreateDialog registryId={activeId} onClose={handleCreated} />
      )}

      <aside className="nsi__list">
        <div className="nsi__list-title">Реестры</div>
        {REGISTRIES.map((registry) => (
          <button
            key={registry.id}
            className={registry.id === activeId ? 'nsi__item nsi__item--active' : 'nsi__item'}
            onClick={() => { setActiveId(registry.id); setSearch('') }}
          >
            {registry.title}
          </button>
        ))}
      </aside>

      <section className="nsi__panel">
        <header className="nsi__head">
          <div>
            <h1 className="nsi__title">{active.title}</h1>
            <p className="nsi__desc">{active.description}</p>
          </div>
          <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>
            + Создать
          </button>
        </header>

        <div className="nsi__toolbar">
          <input
            className="nsi__search"
            placeholder="Поиск по реестру…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="nsi__count mono">
            {loading ? 'Загрузка…' : `${filtered.length} записей`}
          </span>
        </div>

        <div className="nsi__table-wrap">
          <table className="nsi__table">
            <thead>
              <tr>
                {active.columns.map((col) => (
                  <th key={col.key}>{col.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="nsi__empty">
                  <td colSpan={active.columns.length}>Загрузка…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr className="nsi__empty">
                  <td colSpan={active.columns.length}>
                    {rows.length === 0
                      ? 'Записей нет — нажмите «+ Создать» для добавления.'
                      : 'Ничего не найдено.'}
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => (
                  <tr key={String(row.id ?? row.tab_no ?? i)}>
                    {active.columns.map((col) => (
                      <td key={col.key}>
                        {cellText(col.key, row[col.key], wcTypes, products)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
