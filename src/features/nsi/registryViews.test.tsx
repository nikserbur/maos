/**
 * Колонки реестров НСИ без «сокращений и непонятных чисел» (владелец): у типов — 4 числовые колонки
 * вместо «400 / 6»; у изделий — код своей колонкой; допуски рабочего — одной строкой; станки — пустые
 * «Тип» и «Статус» скрываются, над таблицей «все N в работе»; единица «компл» — словом.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Machine, Product, Worker, WorkCenterType } from '../../lib/api'
import { DataTable } from '../../ui/kit'
import { buildLookups, type NsiData } from './nsiLookups'
import { machineView, workerView, wcTypeView, type AnyRow } from './registryColumns'
import { productView } from './registryColumnsGoods'

const wct = (id: string, name: string): WorkCenterType =>
  ({ id, name, group_name: 'Цех №1 — Литейный', kind: '', characteristics: '', description: '', interchangeable: '0', created_at: '', mtbf_hours: '400', repair_hours: '6' } as WorkCenterType)
const machine = (id: string, name: string, type: string): Machine =>
  ({ id, name, wc_type_id: type, org_unit: 'Цех №1', inv_no: '', serial_no: '', year_made: '', schedule: '', status: 'active', subtitle: '', pos_x: '', pos_z: '', rotation_y: '', parent_machine_id: '', created_at: '' })
const worker = (skills: string): Worker =>
  ({ id: 'w', tab_no: 'T0001', last_name: 'Иванов', first_name: 'Иван', middle_name: '', org_unit: 'Цех №1', position: '', grade: '3', skills, created_at: '' })

const types = [wct('t1', 'Пила ленточная'), wct('t2', 'Молот ковочный'), wct('t3', 'Печь плавильная')]
const data: NsiData = {
  wcTypes: types,
  machines: [machine('m1', 'Пила ленточная №1', 't1'), machine('m2', 'Пила ленточная №2', 't1')],
  workers: [], products: [] as Product[], operations: [], routings: [],
}
const ctx = { data, lk: buildLookups(data) }
const rows = (xs: readonly object[]) => xs as unknown as AnyRow[]

describe('реестры НСИ', () => {
  it('типы оборудования: наработка и ремонт — отдельными колонками', () => {
    const titles = wcTypeView(ctx).columns.map((c) => c.title)
    expect(titles).toEqual(expect.arrayContaining(['Наработка на отказ, ч', 'Ремонт, ч', 'Техобслуживание: интервал, ч', 'Техобслуживание: длительность, ч']))
    expect(titles.join(' ')).not.toContain(' / ')
  })

  it('станки: пустые «Тип» и «Статус» скрыты, пояснение «все 2 в работе»', () => {
    const v = machineView(ctx)
    const html = renderToStaticMarkup(<DataTable columns={v.columns} rows={rows(data.machines)} rowKey={(r) => String(r.id)} hideEmptyColumns />)
    expect(html).not.toContain('Тип оборудования')
    expect(html).not.toContain('>Статус<')
    expect(v.note?.(rows(data.machines))).toBe('все 2 в работе')
  })

  it('рабочие: допуски одной строкой «N типов станков: … и ещё N−1»', () => {
    const v = workerView(ctx)
    const html = renderToStaticMarkup(<DataTable columns={v.columns} rows={rows([worker('Пила ленточная, Молот ковочный, Печь плавильная')])} rowKey={() => 'w'} />)
    expect(html).toMatch(/3.типа станков: [^<]+ и ещё 2/)
    expect(html).not.toContain('nsi-chip')
  })

  it('изделия: код — своей колонкой, единица «компл» — словом', () => {
    const v = productView(ctx)
    expect(v.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['item', 'code']))
    const p = { id: 'p1', code: 'СМ-009', name: 'Насос — для химпрома', unit: 'компл', stock: '12', purchased: '1' }
    const html = renderToStaticMarkup(<DataTable columns={v.columns} rows={rows([p])} rowKey={() => 'p1'} />)
    expect(html).toMatch(/12.комплектов/)
    expect(html.indexOf('СМ-009')).toBeGreaterThan(html.indexOf('Насос'))
  })
})
