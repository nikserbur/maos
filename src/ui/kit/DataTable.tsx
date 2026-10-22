/**
 * Таблица данных единого кита: сортируемые заголовки (aria-sort), липкий thead, числовые
 * колонки `.num` вправо с tabular-nums, группировка липкими подзаголовками, кликабельные строки
 * с клавиатурой, пустое состояние и skeleton. Числа форматирует вызывающий (src/explain/format.ts).
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { SkeletonRows } from './States'
import { cellValue, groupRows, nextSort, sortRows, type ColumnSpec, type SortState } from './tableModel'
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
}

interface DataTableProps<T> {
  columns: ReadonlyArray<DataColumn<T>>
  rows: ReadonlyArray<T>
  rowKey: (row: T, index: number) => string
  /** Подзаголовки групп (липкие); порядок — по первому появлению. */
  groupBy?: (row: T) => string
  defaultSort?: SortState | null
  sort?: SortState | null
  onSortChange?: (s: SortState | null) => void
  onRowClick?: (row: T) => void
  /** Класс/подсказка строки; index — позиция после сортировки/группировки. */
  rowClassName?: (row: T, index: number) => string | undefined
  rowTitle?: (row: T, index: number) => string | undefined
  /** Пустое состояние (строка или узел) — одна ячейка на всю ширину. */
  empty?: ReactNode
  loading?: boolean
  caption?: string
  tight?: boolean
  /** Рамка и скролл внутри (реестры); без — таблица растёт по контенту. */
  framed?: boolean
  className?: string
}

const ARROW: Record<'asc' | 'desc' | 'none', string> = { asc: '↑', desc: '↓', none: '↕' }

export function DataTable<T>({
  columns, rows, rowKey, groupBy, defaultSort = null, sort: sortProp, onSortChange, onRowClick,
  rowClassName, rowTitle, empty = 'Записей нет', loading = false, caption, tight = false, framed = false, className,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<SortState | null>(defaultSort)
  const sort = sortProp !== undefined ? sortProp : sortState
  const setSort = (s: SortState | null) => { setSortState(s); onSortChange?.(s) }

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const groups = useMemo(() => (groupBy ? groupRows(sorted, groupBy) : [{ label: '', rows: sorted }]), [sorted, groupBy])
  const clickable = Boolean(onRowClick)

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

  const cellClass = (col: DataColumn<T>) => [col.num ? 'num' : '', col.className ?? ''].filter(Boolean).join(' ') || undefined
  const wrapCls = ['dk-table-wrap', framed ? 'dk-table-wrap--framed' : '', className ?? ''].filter(Boolean).join(' ')
  const tableCls = `dk-table${tight ? ' dk-table--tight' : ''}`

  return (
    <div className={wrapCls}>
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
          {loading && (
            <tr><td colSpan={columns.length} className="dk-td-empty"><SkeletonRows rows={5} cols={Math.min(columns.length, 5)} /></td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length} className="dk-td-empty">{empty}</td></tr>
          )}
          {!loading && groups.map((g) => (
            <GroupRows key={g.label} label={groupBy ? g.label : undefined} colSpan={columns.length}>
              {g.rows.map((row, i) => (
                <tr key={rowKey(row, i)}
                    className={[clickable ? 'is-click' : '', rowClassName?.(row, i) ?? ''].filter(Boolean).join(' ') || undefined}
                    title={rowTitle?.(row, i)}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onRowClick?.(row) : undefined}
                    onKeyDown={clickable ? (e) => onRowKey(e, row) : undefined}>
                  {columns.map((col) => (
                    col.rowHeader
                      ? <th key={col.key} scope="row" className={cellClass(col)}>{renderCell(col, row, i)}</th>
                      : <td key={col.key} className={cellClass(col)}>{renderCell(col, row, i)}</td>
                  ))}
                </tr>
              ))}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Подзаголовок группы (липкий под шапкой) + её строки. */
function GroupRows({ label, colSpan, children }: { label?: string; colSpan: number; children: ReactNode }) {
  const count = Array.isArray(children) ? children.length : 0
  return (
    <>
      {label !== undefined && (
        <tr className="dk-table__group">
          <th scope="colgroup" colSpan={colSpan}>{label}<span className="num">{count}</span></th>
        </tr>
      )}
      {children}
    </>
  )
}
