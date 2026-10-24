/**
 * История прогонов Стадии 1 (UX-V2 §4.5, X2 «таблицы, а не стены карточек»): одна строка — один прогон
 * с номером №N и временем сервера (runIndex), правилом и источником (паспорт прогона runMeta),
 * средняя длина плана · длина в худших сценариях · заказы в срок · узкое место (заголовки — словами,
 * аббревиатуры E[Cmax], CVaR, OTD — в подсказках). Строка открывает `#/plan/run/<id>`: полный результат есть для
 * прогонов из кэша этой машины, остальные — «только KPI». «Повторить» — в каждой строке; две отметки
 * или «сравнить с текущим» — сравнение бок о бок с Δ к базе (DiffTable).
 */
import { useMemo, useRef, useState } from 'react'
import { dateTimeShort, hours, money, num, pct } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import { DiffTable, type DiffTableRow } from '../../ui/DiffList'
import { Chip, DataTable, ErrorBanner, SkeletonRows, useDelayedFlag, type DataColumn } from '../../ui/kit'
import { openRun, repeatRun } from './planNav'
import { ruleWords } from './ruleWords'
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
  return `${ruleWords(meta.rule)}${meta.adopted ? ' + генетический алгоритм' : ''}`
}

/** Аббревиатуры правила для подсказки: «EDD + ГА». */
const ruleAbbr = (meta: RunMeta | undefined): string | undefined =>
  meta ? `${ruleLabel(meta.rule)}${meta.adopted ? ' + ГА (генетический алгоритм)' : ''}` : undefined

export function sourceText(meta: RunMeta | undefined): string {
  if (!meta) return '—'
  return [SOURCE_LABEL[meta.source], meta.scenarioName ? `«${meta.scenarioName}»` : ''].filter(Boolean).join(' · ')
}

const COMPARE_ROWS: ReadonlyArray<DiffTableRow<RunRow>> = [
  { key: 'mk', label: 'Средняя длина плана', get: (r) => kpiOf(r.kpi, 'makespan_mean'), fmt: (v) => hours(v, 1), better: 'low', always: true },
  { key: 'cvar', label: 'Длина плана в худших сценариях', get: (r) => kpiOf(r.kpi, 'makespan_cvar'), fmt: (v) => hours(v, 1), better: 'low', always: true },
  { key: 'otd', label: 'Заказов в срок', get: (r) => kpiOf(r.kpi, 'otd'), fmt: (v) => pct(v, 0), better: 'high', always: true },
  { key: 'tard', label: 'Суммарная просрочка', get: (r) => kpiOf(r.kpi, 'tardiness'), fmt: (v) => hours(v, 1), better: 'low' },
  { key: 'util', label: 'Загрузка оборудования', get: (r) => kpiOf(r.kpi, 'utilization'), fmt: (v) => pct(v, 0), better: 'high', always: true },
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
    { key: 'cmp', title: <span className="dk-vh">Сравнить</span>, sortable: false, width: 'fit', hint: 'Отметьте два прогона для сравнения', className: 'pl-runs__pick',
      render: (r) => (
        // Вся ячейка — метка чекбокса; клик по ней не открывает прогон
        <label className="pl-runs__pick-label" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" aria-label={`сравнить прогон ${runNo(r)}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />
        </label>
      ) },
    { key: 'no', title: 'Прогон', rowHeader: true, width: 'fit', get: (r) => r.seq ?? -1, className: 'dk-td-name',
      render: (r) => <>{runNo(r)}{r.id === currentId && <Chip size="sm">открыт</Chip>}</> },
    { key: 'when', title: 'Когда', width: 'fit', get: (r) => r.createdAt, render: (r) => dateTimeShort(r.createdAt) },
    { key: 'rule', title: 'Правило', minWidth: 14, get: (r) => ruleText(meta.get(r.id)),
      render: (r) => <span title={ruleAbbr(meta.get(r.id))}>{ruleText(meta.get(r.id))}</span> },
    { key: 'src', title: 'Источник и сценарий', primary: true, get: (r) => sourceText(meta.get(r.id)), render: (r) => sourceText(meta.get(r.id)) },
    { key: 'mk', title: 'Средняя длина плана, ч', num: true, hint: 'E[Cmax] — средняя по сценариям длина расписания',
      get: (r) => kpiOf(r.kpi, 'makespan_mean'), render: (r) => num(kpiOf(r.kpi, 'makespan_mean'), 1) },
    { key: 'cvar', title: 'Длина в худших сценариях, ч', num: true, hint: 'CVaR — средняя длина плана в худших α сценариях (обычно 10 %)',
      get: (r) => kpiOf(r.kpi, 'makespan_cvar'), render: (r) => num(kpiOf(r.kpi, 'makespan_cvar'), 1) },
    { key: 'otd', title: 'Заказов в срок, %', num: true, hint: 'OTD — доля заказов, выполненных в срок', get: (r) => kpiOf(r.kpi, 'otd'),
      render: (r) => { const otd = kpiOf(r.kpi, 'otd'); return Number.isFinite(otd) && otd < OTD_FULL ? <span className="glyph-setup" title="есть опоздания">{num(otd * 100, 0)}</span> : num(otd * 100, 0) } },
    { key: 'bn', title: 'Узкое место', minWidth: 14, get: (r) => r.kpi?.bottleneck?.wc_name ?? '', render: (r) => r.kpi?.bottleneck?.wc_name ?? '—' },
    { key: 'act', title: <span className="dk-vh">Действия</span>, sortable: false, width: 'fit', className: 'pl-runs__act',
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
          <DiffTable columns={columns} rows={COMPARE_ROWS} caption="Сравнение двух прогонов — отличающиеся показатели и разница с первым" />
        </section>
      )}
    </div>
  )
}
