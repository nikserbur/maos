/**
 * Загрузка оборудования и простои по типам / станкам — `BarList` chart-системы: бар одного цвета ряда
 * (статусный цвет не кодирует величину), отметка порога перегрузки 85 % на каждой дорожке, ▲ — только
 * у строк выше порога, простой — вторичной строкой. Подпись строки — кнопка общей выборки: строка
 * подсвечивается, Гант раскрывает и прокручивает к ней. Инфраструктура без операций — одна строка
 * «N типов РЦ без операций — простой 100 % не от плана · список ▸».
 */
import type { ScheduleResult } from '../../lib/api'
import { countText, hours, pct } from '../../explain/format'
import { BarList, type BarRow } from '../../ui/charts'
import { revealPlanSection, usePlanSelection } from './usePlanSelection'
import { OVERLOAD } from './verdict'
import './plan.css'

const TOP_N = 12

export function LoadBars({ rows, nameKey }: { rows: ScheduleResult['wc_load']; nameKey: 'wc_name' | 'machine_name' }) {
  const sel = usePlanSelection()
  const byMachine = nameKey === 'machine_name'
  // Производственное оборудование (есть работа) vs инфраструктура без операций (всегда 0 % — её
  // простой НЕ связан с выбором продукции, иначе вводит в заблуждение «огромными простоями»).
  const used = rows.filter((l) => l.utilization > 1e-4).sort((a, b) => b.utilization - a.utilization)
  const infra = rows.filter((l) => l.utilization <= 1e-4)
  const nameOf = (l: (typeof rows)[number]) => (l[nameKey] as string) ?? l.wc_type_id ?? ''
  const isOn = (l: (typeof rows)[number]) => (byMachine ? Boolean(l.machine_id) && sel.machine === l.machine_id : Boolean(l.wc_type_id) && sel.wc === l.wc_type_id && !sel.machine)
  const pick = (l: (typeof rows)[number]) => {
    if (byMachine) sel.select({ machine: isOn(l) ? null : l.machine_id ?? null, wc: isOn(l) ? null : l.wc_type_id ?? null })
    else sel.select({ wc: isOn(l) ? null : l.wc_type_id ?? null, machine: null })
    if (!isOn(l)) revealPlanSection('res-gantt')
  }
  const bars: BarRow[] = used.map((l, i) => {
    const hot = l.utilization >= OVERLOAD
    return {
      key: `${nameOf(l)}-${i}`,
      label: (
        <button type="button" className="pl-pick" aria-pressed={isOn(l)} onClick={() => pick(l)} title="Показать на Ганте">
          {hot && <span className="glyph-setup" aria-label="перегрузка: загрузка выше 85 %" />}{nameOf(l)}
        </button>
      ),
      labelText: nameOf(l),
      value: Math.min(1, l.utilization),
      secondary: `простой ${hours(l.idle_hours)}`,
      marked: hot || isOn(l),
    }
  })
  return (
    <div>
      <BarList rows={bars} fmt={(v) => pct(v, 0)} max={1} valueHeader="Загрузка" compact limit={TOP_N}
        mark={{ value: OVERLOAD, label: 'порог перегрузки' }}
        ariaLabel={`Загрузка ${used.length} ресурсов: от ${pct(used[0]?.utilization ?? 0, 0)} до ${pct(used[used.length - 1]?.utilization ?? 0, 0)}`} />
      {infra.length > 0 && (
        <details className="pl-load__infra">
          <summary>
            <span className="glyph-idle" aria-hidden="true" />
            {countText(infra.length, byMachine ? ['станок', 'станка', 'станков'] : ['тип РЦ', 'типа РЦ', 'типов РЦ'])} без операций — простой 100 % не от плана · список ▸
          </summary>
          <p>{infra.map(nameOf).filter(Boolean).join(', ')} — ни одна операция техкарт сюда не направляется; это пробел в техкартах и справочниках, а не следствие выбора продукции.</p>
        </details>
      )}
    </div>
  )
}
