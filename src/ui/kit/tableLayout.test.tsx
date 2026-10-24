/**
 * Ширины таблиц (владелец: «И…», «НАИ», «сокращения — нечитаемо»): одна гибкая колонка имени
 * выбирается сама, числа — по содержимому, бывшие `clip`-колонки переносятся, а не схлопываются;
 * заголовки не получают классов обрезки; в CSS нет «max-width: 0 + многоточие».
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DataTable, type DataColumn } from './DataTable'
import { columnLayouts, layoutClass, primaryIndex } from './columnLayout'

interface Row { id: string; name: string; type: string; n: number; date: string }
const rows: Row[] = [
  { id: 'a', name: 'Токарный станок с ЧПУ DOOSAN PUMA 240 — участок валов', type: 'Механообработка', n: 3, date: '06.07.2026' },
  { id: 'b', name: 'Индукционная плавильная печь', type: 'Литьё', n: 12, date: '07.07.2026' },
]

describe('columnLayouts — выбор гибкой колонки и ширины', () => {
  it('явная primary побеждает; иначе — текстовый rowHeader; иначе — первая clip; иначе — первая текстовая', () => {
    expect(primaryIndex([{ key: 'a' }, { key: 'b', primary: true }])).toBe(1)
    expect(primaryIndex([{ key: 'n', num: true, rowHeader: true }, { key: 'x', clip: true }, { key: 'y' }])).toBe(1)
    expect(primaryIndex([{ key: 'd', width: 'fit' }, { key: 'x' }, { key: 'y', rowHeader: true }])).toBe(2)
    expect(primaryIndex([{ key: 'n', num: true }, { key: 'x' }])).toBe(1)
    expect(primaryIndex([{ key: 'n', num: true }])).toBe(-1)
    // номер прогона без `num` (значение — число) уступает текстовой clip-колонке
    expect(primaryIndex([{ key: 'no', rowHeader: true }, { key: 'src', clip: true }], [true, false])).toBe(1)
  })

  it('числа — по содержимому и вправо; имя и бывшая clip — без обрезки строк, clip не-primary — минимум 12 знаков', () => {
    const [name, type, n] = columnLayouts([{ key: 'name', rowHeader: true, clip: true }, { key: 'type', clip: true }, { key: 'n', num: true }])
    expect(name).toMatchObject({ primary: true, clamp: undefined, fit: false })
    expect(type).toMatchObject({ primary: false, clamp: undefined, minWidth: 12 })
    expect(columnLayouts([{ key: 'x', wrap: 1 }])[0].clamp).toBe(1)
    expect(n).toMatchObject({ fit: true, right: true })
    expect(layoutClass(n)).toBe('num dk-col-fit')
    expect(layoutClass(type)).toBe('dk-minw-12')
  })

  it('приоритет 3 и 2 дают классы скрытия в узком контейнере', () => {
    const [a, b] = columnLayouts([{ key: 'a', priority: 3 }, { key: 'b', priority: 1 }])
    expect(layoutClass(a)).toContain('dk-col-p3')
    expect(layoutClass(b) ?? '').not.toContain('dk-col-p')
  })
})

describe('DataTable — разметка без обрезки', () => {
  const columns: ReadonlyArray<DataColumn<Row>> = [
    { key: 'name', title: 'Наименование', rowHeader: true, clip: true },
    { key: 'type', title: 'Тип оборудования', clip: true },
    { key: 'n', title: 'Станков в парке, шт', num: true },
    { key: 'date', title: 'Обновлено', width: 'fit' },
  ]
  const html = renderToStaticMarkup(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)

  it('нет класса обрезки; есть ровно одна гибкая колонка; полный текст имени в разметке', () => {
    expect(html).not.toContain('dk-td-clip')
    expect(html).toContain('dk-col-primary')
    expect(html).toContain('Токарный станок с ЧПУ DOOSAN PUMA 240 — участок валов')
    expect(html).not.toContain('dk-cell-text--l')
    const heads = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
    expect((heads.match(/dk-col-primary/g) ?? []).length).toBe(1)
  })

  it('заголовки — полный текст в обёртке-подписи; без title-подсказки на ячейках по умолчанию', () => {
    expect(html).toContain('<span class="dk-th__label">Станков в парке, шт</span>')
    const body = html.slice(html.indexOf('<tbody'))
    expect(body).not.toMatch(/<t[dh][^>]* title=/)
  })

  it('числовой заголовок строки выравнивается вправо, как его колонка', () => {
    const t = renderToStaticMarkup(<DataTable columns={[{ key: 'n', title: 'Сценарий', rowHeader: true, num: true }, { key: 'name', title: 'Имя' }]}
      rows={rows} rowKey={(r) => r.id} />)
    expect(t).toMatch(/<th scope="row" class="num dk-col-fit">/)
  })

  it('подпись группы — в липкой обёртке слева', () => {
    const t = renderToStaticMarkup(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} groupBy={(r) => r.type} />)
    expect(t).toContain('dk-table__grouplabel')
  })
})

describe('CSS таблицы', () => {
  const css = readFileSync(fileURLToPath(new URL('./table.css', import.meta.url)), 'utf8')
  it('нет «max-width: 0 + многоточие», шапка не в капители и переносится', () => {
    expect(css).not.toContain('dk-td-clip')
    expect(css).not.toMatch(/text-overflow:\s*ellipsis/)
    const thead = css.slice(css.indexOf('.dk-table thead th {'), css.indexOf('}', css.indexOf('.dk-table thead th {')))
    expect(thead).not.toContain('uppercase')
    expect(thead).toContain('white-space: normal')
    expect(css).toMatch(/\.dk-table__group th \{[^}]*text-align: left/)
  })
})
