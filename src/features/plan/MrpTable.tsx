/**
 * MRP — потребность в материалах под программу (вынесено из PlanScreen): закупные позиции,
 * дефицит / дозаказ, срок размещения заказа.
 */
import type { MrpResult } from '../../lib/api'
import './plan.css'

export function MrpTable({ mrp }: { mrp: MrpResult }) {
  return (
    <>
      <p className="plan__section-title" style={{ marginTop: 0 }}>
        MRP — потребность в материалах под программу{' '}
        <span style={{ color: mrp.feasible ? 'var(--intent-success)' : 'var(--intent-danger)', fontWeight: 600 }}>
          {mrp.feasible ? '· материально осуществимо' : '· дефицит сырья'}
        </span>
      </p>
          <table className="plan__rules">
            <thead><tr><th>Материал</th><th>Потребность</th><th>Остаток</th><th>Нетто</th><th>План. заказ</th><th>Поставка</th><th>Разместить к</th><th>Статус</th></tr></thead>
            <tbody>
              {mrp.materials.filter((m) => m.purchased).sort((a, b) => b.net_req - a.net_req).map((m) => (
                <tr key={m.product_id} className={m.shortage ? 'chosen' : ''}>
                  <td>{m.name}</td>
                  <td>{Math.round(m.gross_req).toLocaleString('ru')}</td>
                  <td>{Math.round(m.on_hand).toLocaleString('ru')}</td>
                  <td>{Math.round(m.net_req).toLocaleString('ru')}</td>
                  <td>{m.planned_qty ? Math.round(m.planned_qty).toLocaleString('ru') : '—'}</td>
                  <td>{Math.round(m.lead_time_hours)} ч</td>
                  <td style={{ color: m.late ? 'var(--intent-danger)' : 'var(--text-muted)' }}>
                    {m.place_by_hours != null
                      ? (m.place_by_hours < 0 ? 'просрочено!' : `${Math.round(m.place_by_hours)} ч`)
                      : '—'}
                  </td>
                  <td style={{ color: m.shortage ? 'var(--intent-danger)' : m.reorder ? 'var(--intent-warning)' : 'var(--text-muted)' }}>
                    {m.shortage ? 'дефицит — закупить' : m.reorder ? 'дозаказ' : 'ок'}
                  </td>
                </tr>
              ))}
              {mrp.materials.filter((m) => m.purchased).length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'left', color: 'var(--text-muted)' }}>Закупных материалов под программу нет.</td></tr>
              )}
            </tbody>
          </table>
          <p className="plan__subtitle" style={{ marginTop: 6 }}>
            Полуфабрикаты ({mrp.materials.filter((m) => !m.purchased).length}) производятся внутри по техкартам; нетто учитывает страховой запас.
          </p>
    </>
  )
}
