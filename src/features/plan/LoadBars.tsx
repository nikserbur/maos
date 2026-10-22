/**
 * Загрузка оборудования и простои по типам / станкам — `BarList` chart-системы: бар одного
 * цвета ряда (статусный цвет не кодирует величину, X1 §5 п. 9), порог ≥ 85 % — только пометка
 * строки, простой — вторичной строкой под названием, названия в 2 строки без обрезки.
 * Инфраструктура без операций показывается отдельно — её простой не следствие выбора продукции.
 */
import type { ScheduleResult } from '../../lib/api'
import { hours, pct } from '../../explain/format'
import { BarList, type BarRow } from '../../ui/charts'
import './plan.css'

/** Порог «горячей» загрузки — только пометка строки. */
const HOT_UTIL = 0.85
const TOP_N = 12

export function LoadBars({ rows, nameKey }: { rows: ScheduleResult['wc_load']; nameKey: 'wc_name' | 'machine_name' }) {
  // Производственное оборудование (есть работа) vs ИНФРАСТРУКТУРА без операций (всегда 0% —
  // её простой НЕ связан с выбором продукции, иначе вводит в заблуждение «огромными простоями»).
  const used = rows.filter((l) => l.utilization > 1e-4).sort((a, b) => b.utilization - a.utilization).slice(0, TOP_N)
  const infra = rows.filter((l) => l.utilization <= 1e-4)
  const nameOf = (l: (typeof rows)[number]) => (l[nameKey] as string) ?? l.wc_type_id ?? ''
  const bars: BarRow[] = used.map((l, i) => {
    const hot = l.utilization >= HOT_UTIL
    return {
      key: `${nameOf(l)}-${i}`,
      label: hot ? <><span className="glyph-setup" aria-label="загрузка выше порога" /> {nameOf(l)}</> : nameOf(l),
      labelText: nameOf(l),
      value: Math.min(1, l.utilization),
      secondary: `простой ${hours(l.idle_hours)}`,
      marked: hot,
    }
  })
  return (
    <div>
      <BarList rows={bars} fmt={(v) => pct(v, 0)} max={1} valueHeader="Загрузка" compact
        ariaLabel={`Загрузка ${used.length} ресурсов: от ${pct(used[0]?.utilization ?? 0, 0)} до ${pct(used[used.length - 1]?.utilization ?? 0, 0)}`} />
      {infra.length > 0 && (
        <div className="pl-load__infra">
          <b>Инфраструктура без операций ({infra.length}):</b> {infra.map(nameOf).filter(Boolean).join(', ')}
          {' '}— ни одна операция техкарт сюда не маршрутизируется, поэтому простой 100 % (это <u>не</u> следствие выбора продукции, а пробел в техкартах/НСИ).
        </div>
      )}
    </div>
  )
}
