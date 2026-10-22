/**
 * Загрузка оборудования и простои по типам / станкам (вынесено из PlanScreen).
 * Бар — цвет ряда --chart-1; порог ≥ 85 % меняет только глиф ▲ у значения, не цвет магнитуды
 * (X1 §5 п. 9). Инфраструктура без операций показывается отдельно — её простой не следствие выбора продукции.
 */
import type { ScheduleResult } from '../../lib/api'
import { hours, pct } from '../../explain/format'
import './plan.css'

/** Порог «горячей» загрузки — только пометка глифом. */
const HOT_UTIL = 0.85

export function LoadBars({ rows, nameKey }: { rows: ScheduleResult['wc_load']; nameKey: 'wc_name' | 'machine_name' }) {
  // Производственное оборудование (есть работа) vs ИНФРАСТРУКТУРА без операций (всегда 0% —
  // её простой НЕ связан с выбором продукции, иначе вводит в заблуждение «огромными простоями»).
  const used = rows.filter((l) => l.utilization > 1e-4).sort((a, b) => b.utilization - a.utilization).slice(0, 12)
  const infra = rows.filter((l) => l.utilization <= 1e-4)
  return (
    <div>
      {used.map((l, i) => {
        const u = Math.min(1, l.utilization)
        const hot = u >= HOT_UTIL
        return (
          <div className="load-row" key={i}>
            <span className="load-row__name" title={(l[nameKey] as string) ?? l.wc_type_id ?? ''}>{(l[nameKey] as string) ?? l.wc_type_id ?? ''}</span>
            <span className="load-bar"><span className="load-bar__fill" style={{ width: `${u * 100}%` }} /></span>
            <span className="load-row__pct">
              {hot && <span className="glyph-setup" aria-label="загрузка выше порога" />}<b>{pct(l.utilization, 0)}</b> · простой {hours(l.idle_hours)}
            </span>
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
