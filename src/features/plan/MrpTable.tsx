/**
 * Материалы под программу (шаг «Ограничения»): закупные позиции — потребность, остаток, нетто,
 * плановый заказ, срок поставки, когда разместить, состояние. DataTable кита; норма — нейтрально,
 * дефицит и просрочка — глиф + слово. Числа — через format.ts.
 */
import { hours, num } from '../../explain/format'
import type { MrpMaterial, MrpResult } from '../../lib/api'
import { Chip, DataTable, type DataColumn } from '../../ui/kit'

const COLS: DataColumn<MrpMaterial>[] = [
  { key: 'name', title: 'Материал', rowHeader: true, clip: true, get: (m) => m.name },
  { key: 'gross', title: 'Потребность', num: true, get: (m) => m.gross_req, render: (m) => num(m.gross_req, 0) },
  { key: 'hand', title: 'Остаток', num: true, get: (m) => m.on_hand, render: (m) => num(m.on_hand, 0) },
  { key: 'net', title: 'Нетто', num: true, get: (m) => m.net_req, render: (m) => num(m.net_req, 0) },
  { key: 'plan', title: 'Плановый заказ', num: true, get: (m) => m.planned_qty ?? 0, render: (m) => (m.planned_qty ? num(m.planned_qty, 0) : '—') },
  { key: 'lead', title: 'Поставка, ч', num: true, get: (m) => m.lead_time_hours, render: (m) => num(m.lead_time_hours, 0) },
  { key: 'place', title: 'Разместить к', num: true, get: (m) => m.place_by_hours ?? Number.NaN,
    render: (m) => (m.place_by_hours == null ? '—' : m.place_by_hours < 0
      ? <span className="glyph-down">просрочено</span>
      : <span className={m.late ? 'glyph-setup' : undefined}>{hours(m.place_by_hours, 0)}</span>) },
  { key: 'st', title: 'Состояние', get: (m) => (m.shortage ? 2 : m.reorder ? 1 : 0),
    render: (m) => (m.shortage ? <Chip tone="bad">дефицит — закупить</Chip> : m.reorder ? <Chip tone="warn">дозаказ</Chip> : 'в норме') },
]

export function MrpTable({ mrp }: { mrp: MrpResult }) {
  const purchased = mrp.materials.filter((m) => m.purchased)
  return (
    <>
      <DataTable columns={COLS} rows={purchased} rowKey={(m) => m.product_id} tight defaultSort={{ key: 'net', dir: 'desc' }} limit={12}
        empty="Закупных материалов под программу нет" caption="Материалы под программу" />
      <p className="pl-note">
        Полуфабрикаты ({num(mrp.materials.filter((m) => !m.purchased).length, 0)}) производятся внутри по техкартам; нетто учитывает страховой запас.
      </p>
    </>
  )
}
