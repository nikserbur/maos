import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import { countLabel, groupLabel, groupRows, nextSort, sortRows, type ColumnSpec } from './tableModel'

interface Row { name: string; qty: number | null; shop: string }

const COLS: ColumnSpec<Row>[] = [
  { key: 'name' },
  { key: 'qty', num: true },
  { key: 'shop' },
]

const ROWS: Row[] = [
  { name: 'Вал', qty: 10, shop: 'Цех 2' },
  { name: 'Ротор', qty: null, shop: 'Цех 1' },
  { name: 'Ось', qty: 3, shop: 'Цех 2' },
  { name: 'Корпус', qty: 25, shop: 'Цех 1' },
]

describe('sortRows', () => {
  it('без сортировки возвращает копию в исходном порядке', () => {
    const out = sortRows(ROWS, COLS, null)
    expect(out.map((r) => r.name)).toEqual(['Вал', 'Ротор', 'Ось', 'Корпус'])
    expect(out).not.toBe(ROWS)
  })

  it('числовая колонка сортируется по значению, пустые — в конце при любом направлении', () => {
    expect(sortRows(ROWS, COLS, { key: 'qty', dir: 'asc' }).map((r) => r.qty)).toEqual([3, 10, 25, null])
    expect(sortRows(ROWS, COLS, { key: 'qty', dir: 'desc' }).map((r) => r.qty)).toEqual([25, 10, 3, null])
  })

  it('строки сортируются по локали ru без учёта регистра', () => {
    expect(sortRows(ROWS, COLS, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['Вал', 'Корпус', 'Ось', 'Ротор'])
  })

  it('неизвестный ключ не меняет порядок', () => {
    expect(sortRows(ROWS, COLS, { key: 'nope', dir: 'asc' }).map((r) => r.name)).toEqual(['Вал', 'Ротор', 'Ось', 'Корпус'])
  })

  it('исходный массив не мутируется', () => {
    const copy = [...ROWS]
    sortRows(ROWS, COLS, { key: 'qty', dir: 'desc' })
    expect(ROWS).toEqual(copy)
  })
})

describe('groupRows', () => {
  it('группы в порядке первого появления, строки внутри сохраняют порядок', () => {
    const g = groupRows(ROWS, (r) => r.shop)
    expect(g.map((x) => x.label)).toEqual(['Цех 2', 'Цех 1'])
    expect(g[0].rows.map((r) => r.name)).toEqual(['Вал', 'Ось'])
    expect(g[1].rows.map((r) => r.name)).toEqual(['Ротор', 'Корпус'])
  })
})

describe('nextSort', () => {
  it('текст: asc → desc → нет; число: desc → asc → нет', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toBeNull()
    expect(nextSort(null, 'qty', true)).toEqual({ key: 'qty', dir: 'desc' })
    expect(nextSort({ key: 'qty', dir: 'desc' }, 'qty', true)).toEqual({ key: 'qty', dir: 'asc' })
    expect(nextSort({ key: 'qty', dir: 'asc' }, 'qty', true)).toBeNull()
  })

  it('клик по другой колонке начинает с её первого направления', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, 'qty', true)).toEqual({ key: 'qty', dir: 'desc' })
  })
})

describe('group and count labels', () => {
  it('group header reads «Сегодня · 24»', () => {
    expect(groupLabel('Сегодня', 24)).toBe('Сегодня · 24')
    expect(groupLabel('', 3)).toBe('Без группы · 3')
  })
  it('count reads «12 из 82 записей», all shown — «82 записи»', () => {
    const sp = (t: string) => t.replace(/ (?=[а-я])(?!из)/g, NBSP)
    expect(countLabel(12, 82)).toBe(sp('12 из 82 записей'))
    expect(countLabel(82, 82)).toBe(sp('82 записи'))
    expect(countLabel(3, 21)).toBe(sp('3 из 21 записи'))
    expect(countLabel(1, 1)).toBe(sp('1 запись'))
    expect(countLabel(5, 11, ['заказ', 'заказа', 'заказов'])).toBe(sp('5 из 11 заказов'))
  })
})
