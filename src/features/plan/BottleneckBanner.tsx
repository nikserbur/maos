/**
 * Узкое место плана (теория ограничений) — одна строка (X1 §5 п. 6): ▲ · тип РЦ · загрузка
 * фонда · пик очереди · «почему → карта». Переналадки, ТО, поломки, простой и календарь
 * перенесены в таблицу «Остальные показатели»; объяснение правила — в «Что определило».
 */
import type { ScheduleResult } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { methodologyHref } from '../../explain/anchors'

export function BottleneckBanner({ result }: { result: ScheduleResult }) {
  const bn = result.bottleneck
  const peak = result.queue_by_wc?.find((q) => q.wc_type_id === bn.wc_type_id)?.peak
  return (
    <div className="pl-bnline" role="note" aria-label="Узкое место">
      <span className="pl-bnline__mark glyph-setup" aria-hidden="true" />
      <span className="pl-bnline__eyebrow text-caps">Узкое место<InfoTip id="plan.bottleneck" values={{ name: bn.wc_name, util: bn.utilization }} /></span>
      <span className="pl-bnline__name">{bn.wc_name || '—'}</span>
      <span className="pl-bnline__fact"><b className="num">{pct(bn.utilization, 0)}</b> фонда</span>
      {typeof peak === 'number' && peak > 0 && <span className="pl-bnline__fact">очередь до <b className="num">{num(peak, 0)}</b></span>}
      <span className="pl-bnline__spacer" />
      <a className="pl-bnline__why" href="#/map/int.capacity" title="Узел «Мощности» на карте методологии">почему → карта</a>
      <a className="pl-bnline__why" href={methodologyHref('toc')} title="Теория ограничений в «Методике»">методика ↗</a>
    </div>
  )
}
