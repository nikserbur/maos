/**
 * Легенда и подсказка диаграммы Ганта на примитивах chart-системы (X1 §8: «Gantt — свой
 * рендерер, но цвет/ось/легенда/подсказка через систему»). Легенда — ЕДИНСТВЕННАЯ (A1 §3):
 * те же слоты палитры, что и у полос (buildPalette), плюс наладка, ТО/ремонт, просрочка, правки;
 * подсказка — карточка `.ch-tip` (та же, что у всех графиков), позиционируется фиксированно.
 */
import { hours, num } from '../../explain/format'
import { Legend, type LegendItem } from '../../ui/charts'
import { colorVar, type Palette } from './ganttModel'
import { barSegments } from './ganttModel'
import type { PlanBar } from './types'
import { Chip } from '../../ui/kit'

export const slotClass = (slot: number | null): string => (slot === null ? 'pl-cx' : `pl-c${slot}`)

export function ganttLegend(palette: Palette, hasPins: boolean): LegendItem[] {
  const items: LegendItem[] = palette.swatches.filter((s) => s.slot !== null).map((s) => ({
    key: s.productId, label: `${s.name} ×${num(s.qty, 0)}`, color: colorVar(s.slot), shape: 'rect',
  }))
  if (palette.hasOther) items.push({ key: 'other', label: 'прочее и снабжение', color: 'var(--chart-other)', swatchClass: 'pl-sw pl-cx' })
  items.push({ key: 'setup', label: 'переналадка', color: 'var(--status-setup)', swatchClass: 'pl-sw pl-sw--setup' })
  items.push({ key: 'down', label: 'ТО и ремонт', color: 'var(--status-down)', swatchClass: 'pl-sw pl-sw--down' })
  items.push({ key: 'late', label: 'просрочка ■', color: 'var(--status-down)', swatchClass: 'pl-sw pl-sw--late' })
  if (hasPins) items.push({ key: 'pin', label: 'ручная правка', color: 'var(--accent-text)', swatchClass: 'pl-sw pl-sw--pin' })
  return items
}

export function GanttLegend({ palette, hasPins }: { palette: Palette; hasPins: boolean }) {
  return <Legend items={ganttLegend(palette, hasPins)} className="pl-legend" />
}

const TIP_W = 290
const TIP_GAP = 14

/** `extra` — дополнительные строки (диф плана: вид изменения и откуда перенесено). */
export function GanttTip({ bar, x, y, palette, extra = [] }: { bar: PlanBar; x: number; y: number; palette: Palette; extra?: ReadonlyArray<[string, string]> }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(x + TIP_GAP, vw - TIP_W)
  const top = Math.min(y + TIP_GAP, vh - 200)
  const seg = barSegments(bar)
  const span = bar.end - bar.start
  const rows: Array<[string, string, string?]> = [
    ['Ресурс', `${bar.wc_name} · ${bar.machine_name}`],
    ['Интервал', `${num(bar.start, 1)}–${num(bar.end, 1)} ч`],
    ['Длительность', hours(span)],
    ...(bar.proc_hours !== undefined ? [['Обработка', hours(bar.proc_hours)] as [string, string]] : []),
    ...(seg.setupFrac > 0 ? [['Переналадка', hours(bar.setup_hours ?? 0), 'glyph-setup'] as [string, string, string]] : []),
    ...(seg.downFrac > 0 ? [['ТО / ремонт', hours(bar.downtime_hours ?? 0), 'glyph-down'] as [string, string, string]] : []),
    ['Срок заказа', hours(bar.due)],
    ...extra,
  ]
  // Позиция — динамическая геометрия курсора (как у перекрестия графиков), не стиль оформления.
  return (
    <div className="pl-gtip" style={{ left, top }} role="tooltip">
      <div className="ch-tip">
        <div className="ch-tip__x">
          <i className={`pl-sw ${slotClass(palette.slotOf(bar.product_id))}`} aria-hidden="true" /> {bar.product_name}
        </div>
        <div className="ch-tip__row"><span className="ch-tip__n ch-tip__n--strong">{bar.op_name}</span></div>
        {rows.map(([k, v, glyph]) => (
          <div key={k} className="ch-tip__row">
            <span className={`ch-tip__n${glyph ? ` ${glyph}` : ''}`}>{k}</span>
            <span className="ch-tip__v num">{v}</span>
          </div>
        ))}
        {bar.late && <Chip tone="bad">просрочка относительно срока</Chip>}
      </div>
    </div>
  )
}
