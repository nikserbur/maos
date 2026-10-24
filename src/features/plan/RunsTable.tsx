/**
 * История прогонов Стадии 1 (UX-V2 §4.5, X2 «таблицы, а не стены карточек»): одна строка — один прогон
 * с номером №N и временем сервера (runIndex), правилом и источником (паспорт прогона runMeta),
 * E[Cmax] · CVaR · OTD · узкое место. Строка открывает `#/plan/run/<id>`: полный результат есть для
 * прогонов из кэша этой машины, остальные — «только KPI». «Повторить» — в каждой строке; две отметки
 * или «сравнить с текущим» — сравнение бок о бок с Δ к базе (DiffTable).
 */
import { useMemo, useRef, useState } from 'react'
import { dateTimeShort, hours, money, num, pct } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import { DiffTable, type DiffTableRow } from '../../ui/DiffList'
import { Chip, DataTable, ErrorBanner, SkeletonRows, useDelayedFlag, type DataColumn } from '../../ui/kit'
import { openRun, repeatRun } from './planNav'
import { kpiOf, refreshRunIndex, useRunIndex, type RunRow } from './runIndex'
import { browserStorage, runMetaMap, type RunMeta } from './runMeta'
import type { ProgramSource } from './wizard/wizardStore'
import './plan-screen.css'
import './runs.css'

const OTD_FULL = 0.99

export const SOURCE_LABEL: Readonly<Record<ProgramSource, string>> = { portfolio: 'портфель', orders: 'реестр заказов', manual: 'вручную' }

/** «План №28» без хэшей; без номера — «прогон» (номер появится после индексации KPI). */
export const runNo = (r: Pick<RunRow, 'seq'>): string => (r.seq !== null ? `№${num(r.seq, 0)}` : '—')

export function ruleText(meta: RunMeta | undefined): string {
  if (!meta) return '—'
  return `${ruleLabel(meta.rule)}${meta.adopted ? ' + ГА' : ''}`
}

export function sourceText(meta: RunMeta | undefined): string {
  if (!meta) return '—'
  return [SOURCE_LABEL[meta.source], meta.scenarioName ? `«${meta.scenarioName}»` : ''].filter(Boolean).join(' · ')
}

const COMPARE_ROWS: ReadonlyArray<DiffTableRow<RunRow>> = [
  { key: 'mk', label: 'E[Cmax]', get: (r) => kpiOf(r.kpi, 'makespan_mean'), fmt: (v) => hours(v, 1), better: 'low', always: true },
  { key: 'cvar', label: 'CVaR длины', get: (r) => kpiOf(r.kpi, 'makespan_cvar'), fmt: (v) => hours(v, 1), better: 'low', always: true },
  { key: 'otd', label: 'OTD', get: (r) => kpiOf(r.kpi, 'otd'), fmt: (v) => pct(v, 0), better: 'high', always: true },
  { key: 'tard', label: 'Просрочка', get: (r) => kpiOf(r.kpi, 'tardiness'), fmt: (v) => hours(v, 1), better: 'low' },
  { key: 'util', label: 'Загрузка', get: (r) => kpiOf(r.kpi, 'utilization'), fmt: (v) => pct(v, 0), better: 'high', always: true },
  { key: 'wait', label: 'Доля ожидания', get: (r) => kpiOf(r.kpi, 'wait_share'), fmt: (v) => pct(v, 0), better: 'low' },
  { key: 'cost', label: 'Себестоимость работ', get: (r) => kpiOf(r.kpi, 'cost'), fmt: (v) => money(v), better: 'low' },
  { key: 'setups', label: 'Переналадок', get: (r) => kpiOf(r.kpi, 'n_setups'), fmt: (v) => num(v, 0), better: 'low' },
  { key: 'bn', label: 'Узкое место', get: (r) => r.kpi?.bottleneck?.wc_name ?? '—' },
  { key: 'ops', label: 'Операций', get: (r) => r.nTasks, fmt: (v) => num(v, 0) },
]

interface RunsTableProps {
  /** Прогон, открытый сейчас (адрес результата) — «текущий», база сравнения. */
  currentId?: string | null
  /** Какие прогоны открываются целиком (есть в кэше этой машины). */
  canOpen?: (id: string) => boolean
  limit?: number
}

export function RunsTable({ currentId = null, canOpen, limit = 12 }: RunsTableProps) {
  const idx = useRunIndex()
  const [sel, setSel] = useState<string[]>([])
  const cmpRef = useRef<HTMLElement>(null)
  const meta = useMemo(() => runMetaMap(browserStorage()), [idx.rows])
  const showSkeleton = useDelayedFlag(idx.rows === null && idx.loading)
  const rows = idx.rows

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : [s[1], id]))
  const compareWithCurrent = (id: string) => {
    if (!currentId) return
    setSel([currentId, id])
    window.setTimeout(() => cmpRef.current?.scrollIntoView({ block: 'nearest' }), 0)
  }

  if (idx.error && !rows) {
    return <ErrorBanner error={idx.error} title="История прогонов недоступна" message="Сервер не ответил — повторите или откройте последний прогон из кэша этой машины." onRetry={() => void refreshRunIndex()} />
  }
  if (!rows) return showSkeleton ? <SkeletonRows rows={4} label="Загрузка прогонов" /> : null

  const openable = (r: RunRow) => r.id === currentId || (canOpen ? canOpen(r.id) : false)
  const columns = sel.map((id) => rows.find((r) => r.id === id)).filter((r): r is RunRow => Boolean(r))
    .map((r) => ({ id: r.id, title: `${runNo(r)} · ${dateTimeShort(r.createdAt)}`, item: r }))
  const cols: DataColumn<RunRow>[] = [
    { key: 'cmp', title: <span className="dk-vh">Сравнить</span>, sortable: false, hint: 'Отметьте два прогона для сравнения', className: 'pl-runs__pick',
      render: (r) => (
        // Вся ячейка — метка чекбокса; клик по ней не открывает прогон
        <label className="pl-runs__pick-label" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" aria-label={`сравнить прогон ${runNo(r)}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />
        </label>
      ) },
    { key: 'no', title: 'Прогон', rowHeader: true, get: (r) => r.seq ?? -1, className: 'dk-td-name',
      render: (r) => <>{runNo(r)}{r.id === currentId && <Chip size="sm">открыт</Chip>}</> },
    { key: 'when', title: 'Когда', get: (r) => r.createdAt, render: (r) => dateTimeShort(r.createdAt) },
    { key: 'rule', title: 'Правило', get: (r) => ruleText(meta.get(r.id)), render: (r) => ruleText(meta.get(r.id)) },
    { key: 'src', title: 'Источник · сценарий', get: (r) => sourceText(meta.get(r.id)), clip: true, render: (r) => sourceText(meta.get(r.id)) },
    { key: 'mk', title: 'E[Cmax], ч', num: true, get: (r) => kpiOf(r.kpi, 'makespan_mean'), render: (r) => num(kpiOf(r.kpi, 'makespan_mean'), 1) },
    { key: 'cvar', title: 'CVaR, ч', num: true, get: (r) => kpiOf(r.kpi, 'makespan_cvar'), render: (r) => num(kpiOf(r.kpi, 'makespan_cvar'), 1) },
    { key: 'otd', title: 'OTD', num: true, get: (r) => kpiOf(r.kpi, 'otd'),
      render: (r) => { const otd = kpiOf(r.kpi, 'otd'); return Number.isFinite(otd) && otd < OTD_FULL ? <span className="glyph-setup" title="есть опоздания">{pct(otd, 0)}</span> : pct(otd, 0) } },
    { key: 'bn', title: 'Узкое место', get: (r) => r.kpi?.bottleneck?.wc_name ?? '', clip: true, render: (r) => r.kpi?.bottleneck?.wc_name ?? '—' },
    { key: 'act', title: <span className="dk-vh">Действия</span>, sortable: false, className: 'pl-runs__act',
      render: (r) => (
        <span className="pl-runs__acts" onClick={(e) => e.stopPropagation()}>
          {openable(r)
            ? (r.id !== currentId && <button type="button" className="pf-link" onClick={() => openRun(r.id)}>открыть</button>)
            : (
              <>
                <Chip size="sm" title="Полный результат (Гант, касса) построен на другой машине или вытеснен из кэша — доступны KPI">только KPI</Chip>
                {currentId && <button type="button" className="pf-link" onClick={() => compareWithCurrent(r.id)}>сравнить с текущим</button>}
              </>
            )}
          <button type="button" className="pf-link" onClick={() => repeatRun(r.id)}
            title={meta.has(r.id) ? 'Те же параметры — на шаге «Запуск»' : 'Параметры этого прогона не сохранены — откроется мастер с текущими значениями'}>
            повторить
          </button>
        </span>
      ) },
  ]
  return (
    <div className="pl-runs">
      <DataTable
        className="pl-runs__table"
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        tight
        caption="История прогонов"
        loading={idx.loading}
        empty="Прогонов ещё нет"
        emptyKind="first-use"
        limit={limit}
        onRowClick={(r) => openRun(r.id)}
        rowClassName={(r) => (r.id === currentId ? 'is-chosen' : undefined)}
        rowTitle={(r) => (openable(r) ? 'Открыть прогон' : 'Открыть KPI прогона')}
      />
      {columns.length === 2 && (
        <section ref={cmpRef} className="pl-runs__cmp" aria-label="Сравнение прогонов">
          <DiffTable columns={columns} rows={COMPARE_ROWS} caption="Сравнение A / B — отличающиеся KPI и Δ к первому" />
        </section>
      )}
    </div>
  )
}
