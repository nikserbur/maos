/**
 * Узкое место плана (теория ограничений): тип РЦ с наибольшей загрузкой, почему выбрано
 * правило, что ещё съедает фонд (переналадки, ТО, поломки, простой, календарь).
 */
import type { ScheduleResult } from '../../lib/api'
import { hours, num } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { Icon } from '../../shell/icons'
import { methodologyHref } from '../../explain/anchors'
import { Chip } from './ui'
import { kpiOf } from './types'

export function BottleneckBanner({ result }: { result: ScheduleResult }) {
  const k = kpiOf(result)
  const bn = result.bottleneck
  const imp = result.improver
  return (
    <div className="pl-bn">
      <span className="pl-bn__mark glyph-setup" aria-hidden="true" />
      <div>
        <div className="pl-bn__eyebrow text-caps">
          Узкое место
          <InfoTip id="plan.bottleneck" values={{ name: bn.wc_name, util: bn.utilization }} />
        </div>
        <div className="pl-bn__name">{bn.wc_name || '—'}</div>
        <p className="pl-bn__text">
          Здесь теряется больше всего времени: ускорение других участков не увеличит выпуск, пока не разгружено это
          ограничение. Правило <b>{result.rule}</b> выбрано по минимуму целевой функции «время + риск» на одних и тех же
          сценариях длительностей.
        </p>
        <div className="pl-bn__chips">
          {imp?.adopted && imp.validation && (
            <Chip tone="good">ГА −{num(imp.validation.improvement_pct, 1)} % вне выборки</Chip>
          )}
          {(k.n_setups ?? 0) > 0 && <Chip tone="warn">переналадок {k.n_setups} · {hours(k.setup_hours ?? 0)}</Chip>}
          {(k.maintenance_hours ?? 0) > 0 && <Chip>плановое ТО {hours(k.maintenance_hours ?? 0)}</Chip>}
          {(k.breakdown_hours_mean ?? 0) > 0 && (
            <Chip tone="bad" title="Среднее по прогонам Монте-Карло; риск учтён в CVaR">поломки ≈ {hours(k.breakdown_hours_mean ?? 0)}</Chip>
          )}
          <Chip tone="idle">простой станков {hours(result.idle.machine_idle_hours)}</Chip>
          <Chip tone="accent">
            {result.calendar.enabled ? `календарь смен · фонд ${hours(result.calendar.work_fond_hours, 0)}` : 'календарь выключен · 24/7'}
          </Chip>
        </div>
      </div>
      <div className="pl-bn__side">
        <span className="pl-bn__util num">{num(bn.utilization * 100, 1)}<span className="unit"> %</span></span>
        <span className="text-meta">загрузка фонда</span>
        <a className="pl-bn__why" href={methodologyHref('toc')}>
          Почему? <Icon name="book" size={14} />
        </a>
      </div>
    </div>
  )
}
