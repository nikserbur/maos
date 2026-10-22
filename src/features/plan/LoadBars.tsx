/**
 * Загрузка оборудования и простои по типам / станкам (вынесено из PlanScreen).
 * Инфраструктура без операций показывается отдельно — её простой не следствие выбора продукции.
 */
import type { ScheduleResult } from '../../lib/api'
import './plan.css'

const h1 = (v: number) => v.toFixed(1)
const pct = (v: number) => Math.round(v * 100) + '%'

export function LoadBars({ rows, nameKey }: { rows: ScheduleResult['wc_load']; nameKey: 'wc_name' | 'machine_name' }) {
  // Производственное оборудование (есть работа) vs ИНФРАСТРУКТУРА без операций (всегда 0% —
  // её простой НЕ связан с выбором продукции, иначе вводит в заблуждение «огромными простоями»).
  const used = rows.filter((l) => l.utilization > 1e-4).sort((a, b) => b.utilization - a.utilization).slice(0, 12)
  const infra = rows.filter((l) => l.utilization <= 1e-4)
  return (
    <div>
      {used.map((l, i) => {
        const u = Math.min(1, l.utilization)
        const cls = u >= 0.85 ? ' load-bar__fill--full' : u >= 0.6 ? ' load-bar__fill--hot' : ''
        return (
          <div className="load-row" key={i}>
            <span className="load-row__name">{(l[nameKey] as string) ?? l.wc_type_id ?? ''}</span>
            <span className="load-bar"><span className={`load-bar__fill${cls}`} style={{ width: `${u * 100}%` }} /></span>
            <span className="load-row__pct">{pct(l.utilization)} · {h1(l.idle_hours)}ч простой</span>
          </div>
        )
      })}
      {infra.length > 0 && (
        <div className="load-infra">
          <b>Инфраструктура без операций ({infra.length}):</b> {infra.map((l) => (l[nameKey] as string) ?? l.wc_type_id).filter(Boolean).join(', ')}
          {' '}— ни одна операция техкарт сюда не маршрутизируется, поэтому простой 100% (это <u>не</u> следствие выбора продукции, а пробел в техкартах/НСИ).
        </div>
      )}
    </div>
  )
}
