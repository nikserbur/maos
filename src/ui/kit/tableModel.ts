/**
 * Чистая модель таблицы данных: сортировка (числа — по значению, строки — по локали ru,
 * пустые — в конец) и группировка с сохранением порядка первого появления. Без DOM — vitest.
 */
export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: string
  dir: SortDir
}

export interface ColumnSpec<T> {
  key: string
  /** Значение для сортировки (по умолчанию — поле `key` строки). */
  get?: (row: T) => unknown
  num?: boolean
  sortable?: boolean
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))

/** Значение ячейки для сортировки: явный get, иначе поле строки. */
export function cellValue<T>(row: T, col: ColumnSpec<T>): unknown {
  if (col.get) return col.get(row)
  return (row as Record<string, unknown>)[col.key]
}

function compare(a: unknown, b: unknown, num: boolean): number {
  const ea = isEmpty(a)
  const eb = isEmpty(b)
  if (ea && eb) return 0
  if (ea) return 1
  if (eb) return -1
  if (num || (typeof a === 'number' && typeof b === 'number')) return Number(a) - Number(b)
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return collator.compare(String(a), String(b))
}

/** Отсортированная копия строк (исходный массив не меняется); без сортировки — тот же порядок. */
export function sortRows<T>(rows: ReadonlyArray<T>, columns: ReadonlyArray<ColumnSpec<T>>, sort: SortState | null): T[] {
  if (!sort) return [...rows]
  const col = columns.find((c) => c.key === sort.key)
  if (!col) return [...rows]
  const sign = sort.dir === 'desc' ? -1 : 1
  return rows
    .map((row, i) => ({ row, i, v: cellValue(row, col) }))
    .sort((x, y) => {
      const c = compare(x.v, y.v, Boolean(col.num))
      // пустые всегда в конце, остальное — по направлению; стабильность — по индексу
      const empty = isEmpty(x.v) || isEmpty(y.v)
      return (empty ? c : c * sign) || x.i - y.i
    })
    .map((x) => x.row)
}

export interface RowGroup<T> {
  label: string
  rows: T[]
}

/** Группы в порядке первого появления; внутри группы — переданный порядок строк. */
export function groupRows<T>(rows: ReadonlyArray<T>, groupBy: (row: T) => string): RowGroup<T>[] {
  const index = new Map<string, RowGroup<T>>()
  const out: RowGroup<T>[] = []
  rows.forEach((row) => {
    const label = groupBy(row)
    const hit = index.get(label)
    if (hit) { hit.rows = [...hit.rows, row]; return }
    const g: RowGroup<T> = { label, rows: [row] }
    index.set(label, g)
    out.push(g)
  })
  return out
}

/** Следующее состояние сортировки по клику на заголовок: asc → desc → без сортировки. */
export function nextSort(current: SortState | null, key: string, numeric = false): SortState | null {
  if (!current || current.key !== key) return { key, dir: numeric ? 'desc' : 'asc' }
  const first: SortDir = numeric ? 'desc' : 'asc'
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}
