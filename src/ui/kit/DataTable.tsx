/**
 * Таблица данных единого кита (X2 «таблицы, а не стены карточек»): липкий thead, человеческая первая
 * колонка, числа вправо с tabular-nums, сортировка (стрелка — только у отсортированной колонки,
 * у остальных — при наведении), группы «Сегодня · 24», счётчик «12 из 82 записей», топ-N + «Показать
 * все N», обрезка длинного текста с подсказкой, загрузка без мигания (прежние строки приглушены),
 * пустое состояние кита вместо пустой шапки. Числа форматирует вызывающий (src/explain/format.ts).
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PluralForms } from '../../explain/format'
import { EmptyState, SkeletonRows, type EmptyKind } from './States'
import { cellValue, countLabel, groupLabel as defaultGroupLabel, groupRows, nextSort, sortRows, type ColumnSpec, type SortState } from './tableModel'
import './kit.css'

export interface DataColumn<T> extends ColumnSpec<T> {
  title: ReactNode
  /** Отрисовка ячейки; по умолчанию — строковое значение `get`/поля. */
  render?: (row: T, index: number) => ReactNode
  /** Первая колонка как заголовок строки (`th scope="row"`). */
  rowHeader?: boolean
  className?: string
  /** Подсказка к заголовку колонки. */
  hint?: string
  /** Длинный текст: одна строка с многоточием, полный текст — в title. */
  clip?: boolean
}

interface DataTableProps<T> {
  columns: ReadonlyArray<DataColumn<T>>
  rows: ReadonlyArray<T>
  rowKey: (row: T, index: number) => string
  /** Подзаголовки групп (липкие); порядок — по первому появлению. */
  groupBy?: (row: T) => string
  /** Подпись группы; по умолчанию «Сегодня · 24». */
  groupLabel?: (key: string, count: number) => ReactNode
  defaultSort?: SortState | null
  sort?: SortState | null
  onSortChange?: (s: SortState | null) => void
  onRowClick?: (row: T) => void
  /** Класс/подсказка строки; index — позиция после сортировки/группировки. */
  rowClassName?: (row: T, index: number) => string | undefined
  rowTitle?: (row: T, index: number) => string | undefined
  /** Пустое состояние: строка — заголовок EmptyState кита; узел — как есть. Шапка таблицы при этом не рисуется. */
  empty?: ReactNode
  /** Вид пустоты (первое использование · ничего не найдено · недоступно). */
  emptyKind?: EmptyKind
  /** «Сбросить фильтры» для emptyKind='no-results'. */
  onResetFilters?: () => void
  loading?: boolean
  caption?: string
  /** Плотные строки 32 px — реестры и журналы. */
  tight?: boolean
  /** Рамка и скролл внутри (реестры); без — таблица растёт по контенту. */
  framed?: boolean
  /** Счётчик над таблицей: true — «12 из 82 записей» по `total`; узел — как есть. */
  countSlot?: ReactNode | boolean
  /** Всего записей до фильтра (для «N из M»); по умолчанию — число строк. */
  total?: number
  countForms?: PluralForms
  /** Показать первые N строк и кнопку «Показать все N». */
  limit?: number
  className?: string
}

const ARROW: Record<'asc' | 'desc' | 'none', string> = { asc: '↑', desc: '↓', none: '↕' }

export function DataTable<T>({
  columns, rows, rowKey, groupBy, groupLabel = defaultGroupLabel, defaultSort = null, sort: sortProp, onSortChange, onRowClick,
  rowClassName, rowTitle, empty = 'Записей нет', emptyKind, onResetFilters, loading = false, caption, tight = false, framed = false,
  countSlot, total, countForms, limit, className,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<SortState | null>(defaultSort)
  const [expanded, setExpanded] = useState(false)
  const sort = sortProp !== undefined ? sortProp : sortState
  const setSort = (s: SortState | null) => { setSortState(s); onSortChange?.(s) }

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const capped = limit && !expanded && sorted.length > limit ? sorted.slice(0, limit) : sorted
  const groups = useMemo(() => (groupBy ? groupRows(capped, groupBy) : [{ label: '', rows: capped }]), [capped, groupBy])
  const clickable = Boolean(onRowClick)
  const wrapCls = ['dk-table-wrap', framed ? 'dk-table-wrap--framed' : '', loading && rows.length > 0 ? 'is-refetching' : '', className ?? ''].filter(Boolean).join(' ')
  const count = countSlot === true ? countLabel(rows.length, total ?? rows.length, countForms) : countSlot || null

  // Пусто и не грузится — пустое состояние кита вместо таблицы с одной шапкой.
  if (!loading && rows.length === 0) {
    return (
      <div className={wrapCls}>
        {typeof empty === 'string'
          ? <EmptyState quiet size="sm" title={empty} kind={emptyKind} onReset={onResetFilters} />
          : <div className="dk-table-empty">{empty}</div>}
      </div>
    )
  }

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    e.preventDefault()
    onRowClick?.(row)
  }

  const renderCell = (col: DataColumn<T>, row: T, i: number): ReactNode => {
    if (col.render) return col.render(row, i)
    const v = cellValue(row, col)
    return v === null || v === undefined || v === '' ? '—' : String(v)
  }
  const clipTitle = (col: DataColumn<T>, row: T): string | undefined => {
    if (!col.clip) return undefined
    const v = cellValue(row, col)
    return v === null || v === undefined ? undefined : String(v)
  }
  const cellClass = (col: DataColumn<T>) => [col.num ? 'num' : '', col.clip ? 'dk-td-clip' : '', col.className ?? ''].filter(Boolean).join(' ') || undefined
  const tableCls = `dk-table${tight ? ' dk-table--tight' : ''}`
  const hidden = sorted.length - capped.length

  return (
    <div className={wrapCls} aria-busy={loading || undefined}>
      {count && <div className="dk-table__count" aria-live="polite">{count}</div>}
      <table className={tableCls}>
        {caption && <caption className="dk-vh">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = col.sortable !== false
              const active = sort?.key === col.key ? sort.dir : 'none'
              const ariaSort = active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined
              return (
                <th key={col.key} scope="col" className={cellClass(col)} aria-sort={sortable ? ariaSort : undefined} title={col.hint}>
                  {sortable ? (
                    <button type="button" className="dk-table__sort" onClick={() => setSort(nextSort(sort, col.key, Boolean(col.num)))}
                            aria-label={typeof col.title === 'string' ? `Сортировать: ${col.title}` : undefined}>
                      {col.title}
                      <span className="dk-table__arrow" aria-hidden="true">{ARROW[active]}</span>
                    </button>
                  ) : col.title}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && (
            <tr><td colSpan={columns.length} className="dk-td-empty"><SkeletonRows rows={5} cols={Math.min(columns.length, 5)} rowH={tight ? 20 : 24} /></td></tr>
          )}
          {groups.map((g) => (
            <GroupRows key={g.label} label={groupBy ? groupLabel(g.label, g.rows.length) : undefined} colSpan={columns.length}>
              {g.rows.map((row, i) => (
                <tr key={rowKey(row, i)}
                    className={[clickable ? 'is-click' : '', rowClassName?.(row, i) ?? ''].filter(Boolean).join(' ') || undefined}
                    title={rowTitle?.(row, i)}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onRowClick?.(row) : undefined}
                    onKeyDown={clickable ? (e) => onRowKey(e, row) : undefined}>
                  {columns.map((col) => (
                    col.rowHeader
                      ? <th key={col.key} scope="row" className={cellClass(col)} title={clipTitle(col, row)}>{renderCell(col, row, i)}</th>
                      : <td key={col.key} className={cellClass(col)} title={clipTitle(col, row)}>{renderCell(col, row, i)}</td>
                  ))}
                </tr>
              ))}
            </GroupRows>
          ))}
        </tbody>
      </table>
      {limit !== undefined && sorted.length > limit && (
        <div className="dk-table__more">
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? `Свернуть до ${limit}` : `Показать все ${sorted.length} (ещё ${hidden})`}
          </button>
        </div>
      )}
    </div>
  )
}

/** Подзаголовок группы (липкий под шапкой) + её строки. */
function GroupRows({ label, colSpan, children }: { label?: ReactNode; colSpan: number; children: ReactNode }) {
  return (
    <>
      {label !== undefined && (
        <tr className="dk-table__group">
          <th scope="colgroup" colSpan={colSpan}>{label}</th>
        </tr>
      )}
      {children}
    </>
  )
}
