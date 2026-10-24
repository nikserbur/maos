/**
 * Легенда-переключатели и подсказка диаграммы Ганта (X2 «цвет одной работы»): чипы изделий — те же
 * слоты палитры, что у полос (нажатый — изделие в фокусе, остальные приглушены), чипы слоёв — наладка ▲
 * (тёмная нейтральная штриховка), ТО/ремонт ■ (серая штриховка), просрочка ■ (контур + глиф), правки.
 * Статусные цвета никогда не заливают полосу. Подсказка — карточка `.ch-tip` chart-системы.
 */
import { hours, num } from '../../explain/format'
import { ChoiceChip } from '../../ui/kit'
import { barSegments, type Palette } from './ganttModel'
import { timeLabel } from './ganttTime'
import type { PlanBar } from './types'

export const slotClass = (slot: number | null): string => (slot === null ? 'pl-cx' : `pl-c${slot}`)

export interface GanttLayers { setup: boolean; down: boolean; late: boolean }
export const ALL_LAYERS: GanttLayers = { setup: true, down: true, late: true }

interface LegendProps {
  palette: Palette
  focus: string | null
  onFocus: (productId: string | null) => void
  layers: GanttLayers
  onLayers: (l: GanttLayers) => void
  hasPins: boolean
}

/** Легенда в строке инструментов: изделия (фокус) и слои (вкл/выкл). */
export function GanttLegendChips({ palette, focus, onFocus, layers, onLayers, hasPins }: LegendProps) {
  const named = palette.swatches.filter((s) => s.slot !== null)
  return (
    <span className="pl-gtb__legend" role="group" aria-label="Легенда Ганта">
      {named.map((s) => (
        <ChoiceChip key={s.productId} pressed={focus === s.productId} onToggle={() => onFocus(focus === s.productId ? null : s.productId)}
          title={`${s.name} ×${num(s.qty, 0)} — выделить на Ганте`}>
          <i className={`pl-sw ${slotClass(s.slot)}`} aria-hidden="true" />{s.name}
        </ChoiceChip>
      ))}
      {palette.hasOther && <span className="pl-gtb__key"><i className="pl-sw pl-cx" aria-hidden="true" />прочее и снабжение</span>}
      <ChoiceChip pressed={layers.setup} onToggle={() => onLayers({ ...layers, setup: !layers.setup })} title="Показать переналадки на полосах">
        <i className="pl-sw pl-sw--setup" aria-hidden="true" />▲ наладка
      </ChoiceChip>
      <ChoiceChip pressed={layers.down} onToggle={() => onLayers({ ...layers, down: !layers.down })} title="Показать ТО и ремонты на полосах">
        <i className="pl-sw pl-sw--down" aria-hidden="true" />■ ТО и ремонт
      </ChoiceChip>
      <ChoiceChip pressed={layers.late} onToggle={() => onLayers({ ...layers, late: !layers.late })} title="Показать просроченные операции">
        <i className="pl-sw pl-sw--late" aria-hidden="true" />просрочка
      </ChoiceChip>
      {hasPins && <span className="pl-gtb__key"><i className="pl-sw pl-sw--pin" aria-hidden="true" />ручная правка</span>}
    </span>
  )
}

const TIP_W = 290
const TIP_GAP = 14

/** `extra` — дополнительные строки (диф плана: вид изменения и откуда перенесено). */
export function GanttTip({ bar, x, y, palette, extra = [], start = null }: { bar: PlanBar; x: number; y: number; palette: Palette; extra?: ReadonlyArray<[string, string]>; start?: Date | null }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(x + TIP_GAP, vw - TIP_W)
  const top = Math.min(y + TIP_GAP, vh - 200)
  const seg = barSegments(bar)
  const span = bar.end - bar.start
  const rows: Array<[string, string, string?]> = [
    ['Ресурс', `${bar.wc_name} · ${bar.machine_name}`],
    ['Интервал', start ? `${timeLabel(bar.start, start)} – ${timeLabel(bar.end, start)}` : `${num(bar.start, 1)}–${num(bar.end, 1)} ч`],
    ['Длительность', hours(span)],
    ...(bar.proc_hours !== undefined ? [['Обработка', hours(bar.proc_hours)] as [string, string]] : []),
    ...(seg.setupFrac > 0 ? [['Переналадка', hours(bar.setup_hours ?? 0), 'glyph-setup'] as [string, string, string]] : []),
    ...(seg.downFrac > 0 ? [['ТО / ремонт', hours(bar.downtime_hours ?? 0), 'glyph-down'] as [string, string, string]] : []),
    ['Срок заказа', start ? timeLabel(bar.due, start) : hours(bar.due)],
    ...extra,
  ]
  // Позиция — динамическая геометрия курсора (как у перекрестия графиков), не стиль оформления.
  return (
    <div className="pl-gtip" style={{ left, top }} role="tooltip">
      <div className="ch-tip">
        <div className="ch-tip__x">
          <i className={`pl-sw ${slotClass(palette.slotOf(bar.product_id))}`} aria-hidden="true" /> {bar.product_name} · заказ №{num(bar.order_idx + 1, 0)}
        </div>
        <div className="ch-tip__row"><span className="ch-tip__n ch-tip__n--strong">{bar.op_name}</span></div>
        {rows.map(([k, v, glyph]) => (
          <div key={k} className="ch-tip__row">
            <span className={`ch-tip__n${glyph ? ` ${glyph}` : ''}`}>{k}</span>
            <span className="ch-tip__v num">{v}</span>
          </div>
        ))}
        {bar.late && <p className="pl-gtip__late"><span className="glyph-down" aria-hidden="true" />просрочка относительно срока</p>}
      </div>
    </div>
  )
}
