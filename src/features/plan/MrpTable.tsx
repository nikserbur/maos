/**
 * MRP — потребность в материалах под программу (вынесено из PlanScreen): закупные позиции,
 * дефицит / дозаказ, срок размещения заказа. Статусы — чипы с глифом, не цветной текст.
 */
import { hours, num } from '../../explain/format'
import type { MrpResult } from '../../lib/api'
import { Chip } from '../../ui/kit'
import './plan.css'
import './plan-screen.css'

export function MrpTable({ mrp }: { mrp: MrpResult }) {
  const purchased = mrp.materials.filter((m) => m.purchased)
  return (
    <>
      <p className="plan__section-title plan__section-title--flush">
        MRP — потребность в материалах под программу{' '}
        <Chip tone={mrp.feasible ? 'good' : 'bad'}>{mrp.feasible ? 'материально осуществимо' : 'дефицит сырья'}</Chip>
      </p>
      <table className="plan__rules">
        <thead><tr><th scope="col">Материал</th><th scope="col">Потребность</th><th scope="col">Остаток</th><th scope="col">Нетто</th><th scope="col">План. заказ</th><th scope="col">Поставка</th><th scope="col">Разместить к</th><th scope="col">Статус</th></tr></thead>
        <tbody>
          {purchased.sort((a, b) => b.net_req - a.net_req).map((m) => (
            <tr key={m.product_id} className={m.shortage ? 'chosen' : ''}>
              <td>{m.name}</td>
              <td>{num(m.gross_req, 0)}</td>
              <td>{num(m.on_hand, 0)}</td>
              <td>{num(m.net_req, 0)}</td>
              <td>{m.planned_qty ? num(m.planned_qty, 0) : '—'}</td>
              <td>{hours(m.lead_time_hours, 0)}</td>
              <td>
                {m.place_by_hours == null
                  ? '—'
                  : m.place_by_hours < 0
                    ? <Chip tone="bad">просрочено</Chip>
                    : <span className={m.late ? 'glyph-down' : undefined}>{hours(m.place_by_hours, 0)}</span>}
              </td>
              <td>
                {m.shortage ? <Chip tone="bad">дефицит — закупить</Chip> : m.reorder ? <Chip tone="warn">дозаказ</Chip> : <Chip tone="idle">ок</Chip>}
              </td>
            </tr>
          ))}
          {purchased.length === 0 && (
            <tr><td colSpan={8} className="plan__rules-empty">Закупных материалов под программу нет.</td></tr>
          )}
        </tbody>
      </table>
      <p className="pl-note plan__rules-foot">
        Полуфабрикаты ({mrp.materials.filter((m) => !m.purchased).length}) производятся внутри по техкартам; нетто учитывает страховой запас.
      </p>
    </>
  )
}
