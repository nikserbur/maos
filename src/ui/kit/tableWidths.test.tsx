/**
 * Ширины и шапки таблиц (владелец: «надписи странно отрисовались», «сокращения — нечитаемо»):
 * шапка узкой колонки — не столбиком по слову (класс dk-thw-N по длине заголовка); кнопка сортировки
 * не уже ячейки (последняя буква не срезается); короткая таблица — по содержимому; пустые колонки
 * скрываются; липкая шапка встаёт под полосу вкладок экрана (`--dk-sticky-top`); нулевая Δ — словами.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DataTable, withoutEmptyColumns, type DataColumn } from './DataTable'
import { headWidth } from './columnLayout'
import { DeltaChip, isZeroDelta } from './DeltaChip'

const css = readFileSync(fileURLToPath(new URL('./table.css', import.meta.url)), 'utf8')
const rule = (sel: string): string => {
  const i = css.indexOf(`${sel} {`)
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
}

describe('headWidth — шапка узкой колонки в 1–2 строки', () => {
  const fit = { fit: true, right: true, primary: false }
  it('≈ половина текста + запас, не уже самого длинного слова; шкала 8–22 с шагом 2', () => {
    expect(headWidth('Суммарное время по норме, мин', fit)).toBe(18)
    expect(headWidth('Целевая функция (меньше — лучше)', fit)).toBe(18)
    expect(headWidth('Доля в риске, %', fit)).toBe(10)
    expect(headWidth('Шт', fit)).toBe(8)
    expect(headWidth('Наработка на отказ до первого ремонта и обслуживания, ч', fit)).toBe(22)
    // одно длинное слово — не уже слова
    expect(headWidth('Переналадка', fit)).toBe(14)
  })
  it('гибкая и обычная текстовая колонки, а также заголовок-узел — без ограничения', () => {
    expect(headWidth('Наименование', { fit: false, right: false, primary: true })).toBeUndefined()
    expect(headWidth('Тип оборудования', { fit: false, right: false, primary: false })).toBeUndefined()
    expect(headWidth(<b>узел</b>, fit)).toBeUndefined()
  })
})

interface Row { id: string; name: string; type: string; n: number }
const rows: Row[] = [
  { id: 'a', name: 'Токарный станок с ЧПУ', type: '', n: 3 },
  { id: 'b', name: 'Индукционная печь', type: '', n: 12 },
]
const columns: ReadonlyArray<DataColumn<Row>> = [
  { key: 'name', title: 'Наименование', rowHeader: true },
  { key: 'type', title: 'Тип оборудования' },
  { key: 'n', title: 'Суммарное время по норме, мин', num: true },
]

describe('DataTable — шапка, ширина, пустые колонки', () => {
  it('числовая шапка получает класс ширины по заголовку', () => {
    const html = renderToStaticMarkup(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(html).toMatch(/<th scope="col" class="num dk-col-fit dk-thw-18"/)
  })
  it('width="content" — таблица по содержимому', () => {
    const html = renderToStaticMarkup(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} width="content" />)
    expect(html).toContain('class="dk-table dk-table--content"')
  })
  it('hideEmptyColumns убирает колонку без значений во всех строках; заголовок строки остаётся', () => {
    expect(withoutEmptyColumns(columns, rows).map((c) => c.key)).toEqual(['name', 'n'])
    const html = renderToStaticMarkup(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} hideEmptyColumns />)
    expect(html).not.toContain('Тип оборудования')
    expect(withoutEmptyColumns(columns, [{ id: 'c', name: '', type: 'Литьё', n: 1 }]).length).toBe(3)
  })
  it('collapseAt отключает @container-обёртку (пороги ставит ResizeObserver)', () => {
    const cols: ReadonlyArray<DataColumn<Row>> = [...columns.slice(0, 1), { key: 'n', title: 'Шт', num: true, priority: 3 }]
    const auto = renderToStaticMarkup(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} />)
    const own = renderToStaticMarkup(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} collapseAt={{ p3: 1000 }} />)
    expect(auto).toContain('dk-table-wrap--responsive')
    expect(own).not.toContain('dk-table-wrap--responsive')
  })
})

describe('CSS таблицы — шапка не срезается и встаёт под липкую полосу экрана', () => {
  it('кнопка сортировки шире ячейки ровно на свои поля', () => {
    const sort = rule('.dk-table__sort')
    expect(sort).not.toMatch(/max-width:\s*100%;/)
    expect(sort).toContain('max-width: calc(100% + 2 * var(--space-2))')
  })
  it('липкая шапка и подзаголовки групп — от --dk-sticky-top', () => {
    expect(css).toMatch(/\.dk-table thead th \{[^}]*top: var\(--dk-sticky-top, 0px\)/)
    expect(css).toMatch(/\.dk-table__group th \{[^}]*top: calc\(var\(--dk-sticky-top, 0px\) \+ var\(--dk-thead-h, 34px\)\)/)
  })
  it('шкала dk-thw-8…22 есть в CSS', () => {
    for (const n of [8, 10, 12, 14, 16, 18, 20, 22]) expect(css).toContain(`.dk-thw-${n} { min-width: ${n}ch; }`)
  })
})

describe('DeltaChip — нулевая разница словами', () => {
  it('ноль и округлённый до нуля — «без изменений», без стрелки и знака', () => {
    expect(isZeroDelta(0, '0 ч')).toBe(true)
    expect(isZeroDelta(0.0004, '+0,0 п. п.')).toBe(true)
    expect(isZeroDelta(0.4, '+0,4 ч')).toBe(false)
    const html = renderToStaticMarkup(<DeltaChip value={0} unit="ч" better="low" />)
    expect(html).toContain('без изменений')
    expect(html).not.toContain('dk-delta__arrow')
    expect(html).not.toMatch(/>[=+−-]/)
  })
})
