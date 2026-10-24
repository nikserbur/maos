/**
 * Прогон без полного результата на этой машине (X2 «честные состояния»): бэкенд хранит только KPI
 * прогона (kpi_series) — показываем их как есть, без Ганта и кассы, и предлагаем «Повторить»
 * (те же параметры на шаге «Запуск»). Ничего не показывается нулём, если не рассчитано.
 */
import { hours, pct } from '../../explain/format'
import { BarList, type BarRow } from '../../ui/charts'
import { EmptyState, KpiTile, SkeletonRows, useDelayedFlag } from '../../ui/kit'
import { repeatRun } from './planNav'
import { kpiOf, type RunRow } from './runIndex'
import { OVERLOAD } from './verdict'
import './kpi.css'

const TOP_N = 8

export function KpiOnlyRun({ row, loading, runKey }: { row: RunRow | undefined; loading: boolean; runKey: string }) {
  const skeleton = useDelayedFlag(!row && loading)
  if (!row) {
    if (loading) return skeleton ? <SkeletonRows rows={3} label="Загрузка прогона" /> : null
    return (
      <EmptyState kind="unavailable" title="Прогон не найден" size="sm"
        action={<a className="btn" href="#/plan">К истории прогонов</a>}>
        Такого прогона нет ни в истории сервера, ни в кэше этой машины — возможно, ссылка от другого проекта.
      </EmptyState>
    )
  }
  const b = row.kpi
  const k = (f: string) => kpiOf(b, f)
  const loads: BarRow[] = (b?.wc_load ?? []).filter((l) => l.utilization > 1e-4).sort((a, c) => c.utilization - a.utilization)
    .map((l) => ({ key: l.wc_type_id, label: l.wc_name ?? l.wc_type_id, labelText: l.wc_name ?? l.wc_type_id, value: Math.min(1, l.utilization) }))
  return (
    <div className="pl-kpionly">
      <p className="pl-fast" role="note">
        <span className="glyph-info" aria-hidden="true" />
        Полный результат этого прогона (Гант, касса) не сохранён на этой машине — показаны KPI с сервера.
        <button type="button" className="btn btn--primary btn--sm" onClick={() => repeatRun(runKey)}>Повторить прогон</button>
      </p>
      <div className="pl-bento">
        <KpiTile metric="plan.makespan" label="Длина расписания · E[Cmax]" span="s4" value={hours(k('makespan_mean'))}
          interval={Number.isFinite(k('makespan_cvar')) ? <>CVaR {hours(k('makespan_cvar'), 0)} · худший {hours(k('makespan_worst'), 0)}</> : 'хвост не сохранён'}
          className="pl-tile pl-tile--s4" />
        <KpiTile metric="plan.otd" label="Заказы в срок · OTD" span="s4" value={pct(k('otd'), 0)} className="pl-tile pl-tile--s4"
          state={Number.isFinite(k('otd')) && k('otd') < 0.99 ? { glyph: 'glyph-setup', word: 'есть опоздания' } : undefined} />
        <KpiTile metric="plan.utilization" label="Загрузка оборудования" span="s4" value={pct(k('utilization'), 0)} className="pl-tile pl-tile--s4"
          interval={b?.bottleneck?.wc_name ? <>узкое место — {b.bottleneck.wc_name}</> : undefined} />
      </div>
      {loads.length > 0 && (
        <BarList rows={loads} fmt={(v) => pct(v, 0)} max={1} valueHeader="Загрузка" compact limit={TOP_N}
          mark={{ value: OVERLOAD, label: 'порог перегрузки' }} title="Загрузка по типам РЦ"
          ariaLabel={`Загрузка ${loads.length} типов РЦ`} />
      )}
    </div>
  )
}
