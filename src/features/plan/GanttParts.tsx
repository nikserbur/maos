/**
 * Легенда и подсказка диаграммы Ганта. Легенда — ЕДИНСТВЕННАЯ (A1 §3): те же слоты
 * палитры, что и у полос (buildPalette), плюс обозначения наладки, ТО/ремонта, просрочки, правок.
 */
import { hours, num } from '../../explain/format'
import type { Palette } from './ganttModel'
import { barSegments } from './ganttModel'
import type { PlanBar } from './types'
import { Chip } from './ui'

export const slotClass = (slot: number | null): string => (slot === null ? 'pl-cx' : `pl-c${slot}`)

export function GanttLegend({ palette, hasPins }: { palette: Palette; hasPins: boolean }) {
  return (
    <div className="pl-legend" aria-label="Легенда диаграммы Ганта">
      {palette.swatches.filter((s) => s.slot !== null).map((s) => (
        <span key={s.productId} className="pl-legend__item" title={s.name}>
          <i className={`pl-sw ${slotClass(s.slot)}`} aria-hidden="true" />
          <span>{s.name} <span className="num">×{num(s.qty, 0)}</span></span>
        </span>
      ))}
      {palette.hasOther && (
        <span className="pl-legend__item" title="Изделия сверх 7 цветов палитры и снабжение">
          <i className="pl-sw pl-cx" aria-hidden="true" /><span>прочее и снабжение</span>
        </span>
      )}
      <span className="pl-legend__item"><i className="pl-sw pl-sw--setup" aria-hidden="true" /><span>переналадка</span></span>
      <span className="pl-legend__item"><i className="pl-sw pl-sw--down" aria-hidden="true" /><span>ТО и ремонт</span></span>
      <span className="pl-legend__item"><i className="pl-sw pl-sw--late" aria-hidden="true" /><span>просрочка ■</span></span>
      {hasPins && <span className="pl-legend__item"><i className="pl-sw pl-sw--pin" aria-hidden="true" /><span>ручная правка</span></span>}
    </div>
  )
}

const TIP_W = 290
const TIP_GAP = 14

export function GanttTip({ bar, x, y, palette }: { bar: PlanBar; x: number; y: number; palette: Palette }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(x + TIP_GAP, vw - TIP_W)
  const top = Math.min(y + TIP_GAP, vh - 200)
  const seg = barSegments(bar)
  const span = bar.end - bar.start
  return (
    <div className="pl-gtip" style={{ left, top }} role="tooltip">
      <div className="pl-gtip__title">
        <i className={`pl-sw ${slotClass(palette.slotOf(bar.product_id))}`} aria-hidden="true" />
        {bar.product_name}
      </div>
      <div className="pl-gtip__op">{bar.op_name}</div>
      <dl className="pl-gtip__grid">
        <dt>Ресурс</dt><dd>{bar.wc_name} · {bar.machine_name}</dd>
        <dt>Интервал</dt><dd>{num(bar.start, 1)}–{num(bar.end, 1)} ч</dd>
        <dt>Длительность</dt><dd>{hours(span)}</dd>
        {bar.proc_hours !== undefined && <><dt>Обработка</dt><dd>{hours(bar.proc_hours)}</dd></>}
        {seg.setupFrac > 0 && <><dt className="glyph-setup">Переналадка</dt><dd>{hours(bar.setup_hours ?? 0)}</dd></>}
        {seg.downFrac > 0 && <><dt className="glyph-down">ТО / ремонт</dt><dd>{hours(bar.downtime_hours ?? 0)}</dd></>}
        <dt>Срок заказа</dt><dd>{hours(bar.due)}</dd>
      </dl>
      {bar.late && <Chip tone="bad">просрочка относительно срока</Chip>}
    </div>
  )
}
