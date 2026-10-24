/**
 * Таблица данных единого кита (X2 «таблицы, а не стены карточек»): липкий thead, человеческая первая
 * колонка, числа вправо с tabular-nums, сортировка (стрелка — только у отсортированной колонки,
 * у остальных — при наведении), группы «Сегодня · 24», счётчик «12 из 82 записей», топ-N + «Показать
 * все N», загрузка без мигания (прежние строки приглушены), пустое состояние кита вместо пустой шапки.
 * Ширины (владелец: «сокращения — нечитаемо»): одна гибкая колонка имени (`primary`, выбирается сама)
 * забирает свободное место и переносится до 2 строк; числовые — по содержимому; заголовки
 * переносятся и никогда не обрезаются; подсказка `title` — только если текст действительно урезан.
 * Числа форматирует вызывающий (src/explain/format.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { PluralForms } from '../../explain/format'
import { EmptyState, SkeletonRows, type EmptyKind } from './States'
import { cellValue, countLabel, groupLabel as defaultGroupLabel, groupRows, nextSort, sortRows, type ColumnSpec, type SortState } from './tableModel'
import { columnLayouts, explicitPrimaryCount, headWidth, layoutClass, type ColumnLayout, type ColumnLayoutSpec } from './columnLayout'
import './kit.css'

export type { MinWidthCh } from './columnLayout'

export interface DataColumn<T> extends ColumnSpec<T>, Omit<ColumnLayoutSpec, 'key' | 'num'> {
  /** Полная фраза по-русски, без сокращений; у числовой колонки — «…, единица». */
  title: ReactNode
  /** Отрисовка ячейки; по умолчанию — строковое значение `get`/поля. */
  render?: (row: T, index: number) => ReactNode
  /** Колонка как заголовок строки (`th scope="row"`). */
  rowHeader?: boolean
  className?: string
  /** Подсказка к заголовку колонки (аббревиатуры и формулы — сюда, не в заголовок). */
  hint?: string
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
  /** 'content' — короткая аналитическая таблица по содержимому (имя 16–32rem рядом с числами); 'full' — во всю ширину (реестры). */
  width?: 'full' | 'content'
  /** Свои пороги скрытия колонок priority 3 / 2 по ширине обёртки, px (по умолчанию 760 / 560 — @container). */
  collapseAt?: { p3?: number; p2?: number }
  /** Не выводить колонку, если во всех строках она пуста («», «—», null) — пустая колонка выглядит поломкой. */
  hideEmptyColumns?: boolean
  className?: string
}

const ARROW: Record<'asc' | 'desc' | 'none', string> = { asc: '↑', desc: '↓', none: '↕' }

/** Замер до отрисовки в браузере; на сервере (SSR-тесты) — обычный эффект, без предупреждения React. */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Простой текст ячейки (без `render` или `render` вернул строку/число) — его можно ограничить по строкам. */
const isPlain = (n: ReactNode): n is string | number => typeof n === 'string' || typeof n === 'number'

/** Подсказка — последнее средство: ставится, только если текст действительно урезан (измерено при наведении). */
function titleIfClamped(e: MouseEvent<HTMLElement>, full: string) {
  const el = e.currentTarget
  const cut = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  el.title = cut ? full : ''
}

export function DataTable<T>({
  columns: allColumns, rows, rowKey, groupBy, groupLabel = defaultGroupLabel, defaultSort = null, sort: sortProp, onSortChange, onRowClick,
  rowClassName, rowTitle, empty = 'Записей нет', emptyKind, onResetFilters, loading = false, caption, tight = false, framed = false,
  countSlot, total, countForms, limit, width = 'full', collapseAt, hideEmptyColumns = false, className,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<SortState | null>(defaultSort)
  const [expanded, setExpanded] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const sort = sortProp !== undefined ? sortProp : sortState
  const setSort = (s: SortState | null) => { setSortState(s); onSortChange?.(s) }

  const columns = useMemo(() => (hideEmptyColumns ? withoutEmptyColumns(allColumns, rows) : allColumns), [allColumns, rows, hideEmptyColumns])
  // Колонка, чьё значение в данных — число (номер прогона без `num`), не становится гибкой колонкой имени.
  const first = rows[0]
  const layouts = useMemo(() => columnLayouts(columns, columns.map((c) => first !== undefined && typeof cellValue(first, c) === 'number')), [columns, first])
  useDevPrimaryWarning(columns)
  useTheadHeight(wrapRef, theadRef, Boolean(groupBy) && rows.length > 0)
  const hasRows = rows.length > 0
  const collapse = useCollapseAt(wrapRef, hasRows, collapseAt)
  const overflowing = useOverflowX(wrapRef, tableRef, hasRows)

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const capped = limit && !expanded && sorted.length > limit ? sorted.slice(0, limit) : sorted
  const groups = useMemo(() => (groupBy ? groupRows(capped, groupBy) : [{ label: '', rows: capped }]), [capped, groupBy])
  const clickable = Boolean(onRowClick)
  // Свои пороги (collapseAt) — классы от ResizeObserver; иначе — @container с порогами по умолчанию.
  const responsive = !collapseAt && layouts.some((l) => l.priority)
  // Без рамки обёртка не прокручивается сама (шапка липнет к прокрутке экрана); шире обёртки — видимая прокрутка.
  const wrapCls = ['dk-table-wrap', framed ? 'dk-table-wrap--framed' : 'dk-table-wrap--flow', responsive ? 'dk-table-wrap--responsive' : '',
    width === 'content' ? 'dk-table-wrap--content' : '',
    collapse.p3 ? 'is-hide-p3' : '', collapse.p2 ? 'is-hide-p2' : '', overflowing ? 'is-overflowing' : '',
    loading && rows.length > 0 ? 'is-refetching' : '', className ?? ''].filter(Boolean).join(' ')
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

  const tableCls = `dk-table${tight ? ' dk-table--tight' : ''}${width === 'content' ? ' dk-table--content' : ''}`
  const hidden = sorted.length - capped.length

  return (
    <div ref={wrapRef} className={wrapCls} aria-busy={loading || undefined}>
      {count && <div className="dk-table__count" aria-live="polite">{count}</div>}
      <table ref={tableRef} className={tableCls}>
        {caption && <caption className="dk-vh">{caption}</caption>}
        <thead ref={theadRef}>
          <tr>
            {columns.map((col, ci) => (
              <HeadCell key={col.key} col={col} layout={layouts[ci]} sort={sort} onSort={setSort} />
            ))}
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
                  {columns.map((col, ci) => <BodyCell key={col.key} col={col} layout={layouts[ci]} row={row} index={i} />)}
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

/** Заголовок колонки: переносится (до 2–3 строк), не обрезается; стрелка сортировки — в конце последней строки. */
function HeadCell<T>({ col, layout, sort, onSort }: {
  col: DataColumn<T>; layout: ColumnLayout; sort: SortState | null; onSort: (s: SortState | null) => void
}) {
  const sortable = col.sortable !== false
  const active = sort?.key === col.key ? sort.dir : 'none'
  const ariaSort = active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined
  // Узкая колонка (числа, fit) не уже половины заголовка — шапка в 1–2 строки, а не столбиком по слову.
  const hw = headWidth(col.title, layout)
  return (
    <th scope="col" className={layoutClass(layout, [col.className, hw ? `dk-thw-${hw}` : ''].filter(Boolean).join(' '))}
        aria-sort={sortable ? ariaSort : undefined} title={col.hint}>
      {sortable ? (
        <button type="button" className="dk-table__sort" onClick={() => onSort(nextSort(sort, col.key, Boolean(col.num)))}
                aria-label={typeof col.title === 'string' ? `Сортировать: ${col.title}` : undefined}>
          <span className="dk-th__label">{col.title}</span>
          <span className="dk-table__arrow" aria-hidden="true">{ARROW[active]}</span>
        </button>
      ) : <span className="dk-th__label">{col.title}</span>}
    </th>
  )
}

/** Ячейка: имя (primary) — в обёртке с минимальной шириной, целиком; простой текст колонки с явным `wrap` — до N строк. */
function BodyCell<T>({ col, layout, row, index }: { col: DataColumn<T>; layout: ColumnLayout; row: T; index: number }) {
  const content = renderCell(col, row, index)
  const cls = layoutClass(layout, col.className)
  const clampCls = layout.clamp ? ` dk-cell-text--l${layout.clamp}` : ''
  const body = layout.clamp && isPlain(content)
    ? <span className={`dk-cell-text${clampCls}`} onMouseEnter={(e) => titleIfClamped(e, String(content))}>{content}</span>
    : layout.primary ? <span className="dk-cell-block">{content}</span> : content
  return col.rowHeader ? <th scope="row" className={cls}>{body}</th> : <td className={cls}>{body}</td>
}

/** Пустое значение ячейки для hideEmptyColumns: нет значения, пустая строка или «—». */
const isBlankNode = (n: ReactNode): boolean => n === null || n === undefined || n === false || n === '' || n === '—'

/** Колонки, у которых хоть одна строка непуста (заголовок строки и primary не скрываются никогда). */
export function withoutEmptyColumns<T>(cols: ReadonlyArray<DataColumn<T>>, rows: ReadonlyArray<T>): ReadonlyArray<DataColumn<T>> {
  if (rows.length === 0) return cols
  const kept = cols.filter((c) => c.rowHeader || c.primary || rows.some((r, i) => !isBlankNode(renderCell(c, r, i))))
  return kept.length === cols.length ? cols : kept
}

function renderCell<T>(col: DataColumn<T>, row: T, i: number): ReactNode {
  if (col.render) return col.render(row, i)
  const v = cellValue(row, col)
  return v === null || v === undefined || v === '' ? '—' : String(v)
}

/** Высота шапки → `--dk-thead-h` обёртки: липкие подзаголовки групп встают ровно под многострочную шапку. */
function useTheadHeight(wrapRef: RefObject<HTMLDivElement>, theadRef: RefObject<HTMLTableSectionElement>, on: boolean) {
  useEffect(() => {
    const wrap = wrapRef.current
    const thead = theadRef.current
    if (!on || !wrap || !thead || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => wrap.style.setProperty('--dk-thead-h', `${Math.round(thead.getBoundingClientRect().height)}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(thead)
    return () => ro.disconnect()
  }, [wrapRef, theadRef, on])
}

/** Скрытие колонок priority 3 / 2 по своим порогам: ширина обёртки меряется до отрисовки (без мигания). */
function useCollapseAt(wrapRef: RefObject<HTMLDivElement>, on: boolean, at?: { p3?: number; p2?: number }): { p3: boolean; p2: boolean } {
  const [state, setState] = useState({ p3: false, p2: false })
  const p3 = at?.p3
  const p2 = at?.p2
  useBrowserLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!on || (p3 === undefined && p2 === undefined) || !wrap || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => {
      const w = wrap.clientWidth
      const next = { p3: p3 !== undefined && w <= p3, p2: p2 !== undefined && w <= p2 }
      setState((cur) => (cur.p3 === next.p3 && cur.p2 === next.p2 ? cur : next))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [wrapRef, on, p3, p2])
  return state
}

/** Таблица шире обёртки → класс is-overflowing: видимая горизонтальная прокрутка и липкая первая колонка. */
function useOverflowX(wrapRef: RefObject<HTMLDivElement>, tableRef: RefObject<HTMLTableElement>, on: boolean): boolean {
  const [over, setOver] = useState(false)
  useBrowserLayoutEffect(() => {
    const wrap = wrapRef.current
    const table = tableRef.current
    if (!on || !wrap || !table || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => {
      const next = table.offsetWidth > wrap.clientWidth + 1
      setOver((cur) => (cur === next ? cur : next))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(wrap)
    ro.observe(table)
    return () => ro.disconnect()
  }, [wrapRef, tableRef, on])
  return over
}

/** В разработке: больше одной явной primary-колонки — ошибка вызывающего кода. */
function useDevPrimaryWarning<T>(columns: ReadonlyArray<DataColumn<T>>) {
  const n = explicitPrimaryCount(columns)
  useEffect(() => {
    if (import.meta.env.DEV && n > 1) console.warn(`[DataTable] primary-колонок: ${n} — должна быть одна (колонки: ${columns.map((c) => c.key).join(', ')})`)
  }, [n, columns])
}

/** Подзаголовок группы (липкий под шапкой; подпись прижата влево и не уезжает при горизонтальном скролле) + её строки. */
function GroupRows({ label, colSpan, children }: { label?: ReactNode; colSpan: number; children: ReactNode }) {
  return (
    <>
      {label !== undefined && (
        <tr className="dk-table__group">
          <th scope="colgroup" colSpan={colSpan}><span className="dk-table__grouplabel">{label}</span></th>
        </tr>
      )}
      {children}
    </>
  )
}
