/**
 * Узкое место плана — главный герой результата (X2): одно определение — загрузка фонда. ▲ «перегрузка»
 * только от 85 %; иначе нейтрально ○ «загрузка 63 % · запас 37 %». Если очередь копится у другого
 * участка — это сказано прямо. Ссылки ведут к тем же данным на связанных видах: выборка `?wc=…`
 * подсвечивает группу на Ганте, строку загрузки и фильтр очередей.
 */
import type { ScheduleResult } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { revealPlanSection, usePlanSelection } from './usePlanSelection'
import { OVERLOAD } from './verdict'

/** Участок с наибольшим пиком очереди (может не совпадать с узким местом по загрузке). */
export function queuePeak(result: ScheduleResult): { wc_type_id: string; wc_name: string; peak: number } | null {
  const list = result.queue_by_wc ?? []
  return list.reduce<{ wc_type_id: string; wc_name: string; peak: number } | null>((best, q) => (q.peak > (best?.peak ?? 0) ? q : best), null)
}

export function BottleneckBanner({ result }: { result: ScheduleResult }) {
  const sel = usePlanSelection()
  const bn = result.bottleneck
  const util = bn.utilization
  const over = util >= OVERLOAD
  const peakHere = result.queue_by_wc?.find((q) => q.wc_type_id === bn.wc_type_id)?.peak
  const top = queuePeak(result)
  const elsewhere = top && top.wc_type_id !== bn.wc_type_id && top.peak > (peakHere ?? 0) ? top : null
  const show = (section: string) => { sel.select({ wc: bn.wc_type_id }); revealPlanSection(section) }
  return (
    <div className={`pl-bnline${over ? ' is-over' : ''}`} role="note" aria-label="Узкое место">
      <span className={`pl-bnline__mark ${over ? 'glyph-setup' : 'glyph-idle'}`} aria-hidden="true" />
      <span className="pl-bnline__eyebrow text-caps">Узкое место<InfoTip id="plan.bottleneck" values={{ name: bn.wc_name, util }} /></span>
      <span className="pl-bnline__name">{bn.wc_name || '—'}</span>
      <span className="pl-bnline__fact">
        {over
          ? <><b>перегрузка</b> · загрузка <b className="num">{pct(util, 0)}</b> фонда</>
          : <>загрузка <b className="num">{pct(util, 0)}</b> · запас <b className="num">{pct(Math.max(0, 1 - util), 0)}</b></>}
      </span>
      {typeof peakHere === 'number' && peakHere > 0 && <span className="pl-bnline__fact">очередь до <b className="num">{num(peakHere, 0)}</b></span>}
      {elsewhere && <span className="pl-bnline__fact">очередь копится у {elsewhere.wc_name} (пик <b className="num">{num(elsewhere.peak, 0)}</b>)</span>}
      <span className="pl-bnline__spacer" />
      <button type="button" className="pf-link pl-bnline__why" onClick={() => show('res-gantt')}>на Ганте ↓</button>
      <button type="button" className="pf-link pl-bnline__why" onClick={() => show('res-load')}>в загрузке ↓</button>
      <a className="pl-bnline__why" href="#/scheme" title="Схема предприятия: где стоит этот участок">на схеме →</a>
    </div>
  )
}
