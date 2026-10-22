/**
 * Интерактивная диаграмма Ганта (X1 §5 п. 7): одна палитра ≤ 7 цветов по изделию + «прочее»
 * (ganttModel.buildPalette), группировка по цеху (НСИ `group_name`) или по типу РЦ, ось — даты
 * от начала горизонта (часы без даты старта), зум/fit, сворачиваемые группы, подсказка (GanttTip),
 * drag&drop полосы = ручная правка «не раньше» (пин). Разметка — классы `pl-gantt*` из charts.css.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { hours, num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { GanttLegend, GanttTip, slotClass } from './GanttParts'
import {
  barSegments, buildPalette, fmtTickDate, groupBars, groupBarsByShop, isMajorTick, makeTicks, niceStep, type GanttGroup,
} from './ganttModel'
import { parseIsoDate } from './wizard/dates'
import { barsOf, type PlanBar } from './types'
import { Segmented } from '../../ui/kit'
import { useShops } from './useShops'
import './charts.css'

const LANE_W = 188
const MIN_BAR_PX = 2
const LABEL_MIN_PX = 34
const ZOOM_STEP = 1.7
const MAX_PX_PER_HOUR = 30

export type GanttGrouping = 'shop' | 'wc'

interface GanttProps {
  result: ScheduleResult
  pins: ReadonlyMap<number, number>
  onPin?: (jobIdx: number, startHours: number) => void
  /** Начало горизонта (ISO-дата) — ось в датах; null — в часах/сутках. */
  startDate?: string | null
}

export function Gantt({ result, pins, onPin, startDate = null }: GanttProps) {
  const bars = barsOf(result)
  const makespan = Math.max(1, ...bars.map((g) => g.end))
  const { shopOf, hasShops } = useShops()
  const [grouping, setGrouping] = useState<GanttGrouping>('shop')
  const [full, setFull] = useState(false)
  const [pxPerHour, setPx] = useState(0)     // 0 → по ширине (fit)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; g: PlanBar } | null>(null)
  const [drag, setDrag] = useState<{ idx: number; startX: number; orig: number } | null>(null)
  const [dragDx, setDragDx] = useState(0)
  /** Клавиатурный курсор по полосам дорожки: ←/→ — соседняя операция, Home/End, Esc — снять (X1 §7 A11y). */
  const [kbd, setKbd] = useState<{ machine: string; idx: number } | null>(null)

  const palette = useMemo(() => buildPalette(result.program, bars), [result.program, bars])
  const effGrouping: GanttGrouping = hasShops ? grouping : 'wc'
  const groups: GanttGroup[] = useMemo(
    () => (effGrouping === 'shop' ? groupBarsByShop(bars, shopOf) : groupBars(bars)),
    // shopOf пересоздаётся на каждый рендер, но карта цехов меняется только с hasShops
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, effGrouping, hasShops],
  )
  const start = useMemo(() => parseIsoDate(startDate), [startDate])

  // Меряем фактическую ширину контейнера → «fit» заполняет панель / весь экран целиком.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [contW, setContW] = useState(660)
  useEffect(() => {
    const measure = () => { if (scrollRef.current) setContW(scrollRef.current.clientWidth) }
    measure()
    const id = window.setTimeout(measure, 60)   // после раскрытия полноэкранного
    window.addEventListener('resize', measure)
    return () => { window.clearTimeout(id); window.removeEventListener('resize', measure) }
  }, [full])
  const fitPx = Math.max(0.02, Math.max(300, contW - LANE_W - 10) / makespan)
  const effPx = pxPerHour > 0 ? pxPerHour : fitPx
  const trackW = Math.max(makespan * effPx, 160)
  const step = niceStep(makespan, trackW)
  const ticks = makeTicks(makespan, step)

  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const allCollapsed = collapsed.size >= groups.length
  const zoomBy = (f: number) => setPx((p) => Math.max(fitPx * 0.5, Math.min(MAX_PX_PER_HOUR, (p > 0 ? p : fitPx) * f)))

  // Позиция полосы с учётом пина и текущего перетаскивания.
  const startOf = (g: PlanBar) => {
    const pinned = pins.get(g.job_idx) ?? g.start
    return drag && drag.idx === g.job_idx ? Math.max(0, drag.orig + dragDx / effPx) : pinned
  }
  const endDrag = () => {
    if (drag && onPin) onPin(drag.idx, Math.max(0, drag.orig + dragDx / effPx))
    setDrag(null); setDragDx(0)
  }
  // Клавиатура на дорожке: подсказка якорится к полосе по геометрии дорожки (как перекрестие графиков).
  const showKbd = (track: HTMLElement, mc: { id: string; bars: PlanBar[] }, idx: number) => {
    const g = mc.bars[idx]
    if (!g) return
    const rect = track.getBoundingClientRect()
    setKbd({ machine: mc.id, idx })
    setHover({ x: rect.left + startOf(g) * effPx + Math.min(40, (g.end - g.start) * effPx / 2), y: rect.top + 10, g })
  }
  const onTrackKey = (e: KeyboardEvent<HTMLElement>, mc: { id: string; bars: PlanBar[] }) => {
    const n = mc.bars.length
    if (n === 0) return
    const cur = kbd?.machine === mc.id ? kbd.idx : -1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, (cur < 0 ? n : cur) - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') { setKbd(null); setHover(null); e.preventDefault(); return }
    else return
    e.preventDefault()
    showKbd(e.currentTarget, mc, next)
  }

  const toolbar = (
    <div className="pl-gtb">
      {hasShops && (
        <Segmented label="Группировка Ганта" value={grouping} onChange={setGrouping}
          options={[{ id: 'shop', label: 'по цехам' }, { id: 'wc', label: 'по типам РЦ' }]} />
      )}
      <span className="pl-gtb__group" role="group" aria-label="Масштаб">
        <button type="button" className="btn btn--icon btn--sm" title="Отдалить" aria-label="Отдалить" onClick={() => zoomBy(1 / ZOOM_STEP)}><Icon name="minus" size={14} /></button>
        <button type="button" className="btn btn--icon btn--sm" title="Приблизить" aria-label="Приблизить" onClick={() => zoomBy(ZOOM_STEP)}><Icon name="plus" size={14} /></button>
        <button type="button" className="btn btn--sm" title="Вписать по ширине" onClick={() => setPx(0)}>вписать</button>
      </span>
      <button type="button" className="btn btn--sm" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.wc)))}>
        {allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}
      </button>
      <span className="pl-gtb__meta num">{hours(makespan, 0)} · {num(bars.length, 0)} операций · {groups.length} {effGrouping === 'shop' ? 'цехов' : 'групп'}</span>
      <span className="pl-gtb__spacer" />
      <button type="button" className="btn btn--sm" onClick={() => setFull((f) => !f)}>
        <Icon name={full ? 'close' : 'expand'} size={14} />{full ? ' Свернуть' : ' Весь экран'}
      </button>
    </div>
  )

  const chart = (
    <div ref={scrollRef} className={`pl-gantt${full ? ' pl-gantt--full' : ''}`} role="figure"
         aria-label={`Диаграмма Ганта: ${num(bars.length, 0)} операций на ${groups.reduce((a, g) => a + g.machines.length, 0)} станках, длина ${hours(makespan, 0)}`}
         onMouseLeave={() => { setHover(null); if (drag) endDrag() }}
         onMouseMove={(e) => { if (drag) { setDragDx(e.clientX - drag.startX); setHover(null) } }}
         onMouseUp={() => { if (drag) endDrag() }}>
      <div className="pl-gantt__inner" style={{ width: LANE_W + trackW }}>
        <div className="pl-gantt__axis">
          <span className="pl-gantt__corner text-caps">{start ? 'дата' : 'часы'}</span>
          <span className="pl-gantt__ticks" style={{ width: trackW }}>
            {ticks.map((t) => (
              <span key={t} className={`pl-gantt__tick${isMajorTick(t, step) ? ' is-major' : ''}`} style={{ left: t * effPx }}>{fmtTickDate(t, step, start)}</span>
            ))}
          </span>
        </div>
        <div className="pl-gantt__grid" style={{ width: trackW }} aria-hidden="true">
          {ticks.map((t) => <span key={t} className={`pl-gantt__gl${isMajorTick(t, step) ? ' is-major' : ''}`} style={{ left: t * effPx }} />)}
        </div>
        {groups.map((grp) => {
          const open = !collapsed.has(grp.wc)
          return (
            <div key={grp.wc}>
              <div className="pl-grow pl-grow--head">
                <span className="pl-glane">
                  <button type="button" className="pl-ghead" aria-expanded={open} onClick={() => toggle(grp.wc)} title={grp.name}>
                    <span className="pl-ghead__caret" aria-hidden="true">▾</span>
                    <span>{grp.name}</span>
                    <span className="pl-ghead__meta">{grp.machines.length} ст · {grp.nOps} оп</span>
                  </button>
                </span>
                <span className="pl-gtrack" style={{ width: trackW }} />
              </div>
              {open && grp.machines.map((mc) => (
                <div className="pl-grow" key={mc.id}>
                  <span className="pl-glane" title={mc.name}><span>{mc.name}</span></span>
                  <span className="pl-gtrack" style={{ width: trackW }} tabIndex={0} role="group"
                        aria-label={`${mc.name}: ${num(mc.bars.length, 0)} операций; стрелки — по операциям`}
                        onKeyDown={(e) => onTrackKey(e, mc)} onBlur={() => { if (kbd?.machine === mc.id) { setKbd(null); setHover(null) } }}>
                    {mc.bars.map((g, bi) => {
                      const w = Math.max(MIN_BAR_PX, (g.end - g.start) * effPx)
                      const s = startOf(g)
                      const pinned = pins.has(g.job_idx)
                      const seg = barSegments(g)
                      const cls = `pl-bar ${slotClass(palette.slotOf(g.product_id))}${g.late ? ' is-late' : ''}${pinned ? ' is-pinned' : ''}${onPin ? ' is-draggable' : ''}${drag?.idx === g.job_idx ? ' is-dragging' : ''}${kbd?.machine === mc.id && kbd.idx === bi ? ' is-kbd' : ''}`
                      const geom: CSSProperties = { left: s * effPx, width: w }
                      return (
                        <span key={g.job_idx} className={cls} style={geom}
                          onMouseDown={(e) => { if (!onPin) return; e.preventDefault(); setDrag({ idx: g.job_idx, startX: e.clientX, orig: s }) }}
                          onMouseMove={(e) => { if (!drag) setHover({ x: e.clientX, y: e.clientY, g }) }}
                          onMouseLeave={() => setHover(null)}>
                          {seg.setupFrac > 0 && <i className="pl-bar__setup" style={{ width: `${seg.setupFrac * 100}%` }} aria-hidden="true" />}
                          {seg.downFrac > 0 && <i className="pl-bar__down" style={{ width: `${seg.downFrac * 100}%` }} aria-hidden="true" />}
                          {w > LABEL_MIN_PX && <span className="pl-bar__label">{pinned ? '● ' : ''}{g.op_name}</span>}
                        </span>
                      )
                    })}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )

  const tip = hover && !drag && <GanttTip bar={hover.g} x={hover.x} y={hover.y} palette={palette} />
  const legend = <div className="pl-gtb__legend"><GanttLegend palette={palette} hasPins={pins.size > 0} /></div>

  if (full) {
    return (
      <div className="gantt__overlay" role="dialog" aria-label="Диаграмма Ганта на весь экран">
        <div className="gantt__overlay-head"><b>Диаграмма Ганта</b>{toolbar}</div>
        {legend}
        <div className="gantt__overlay-body">{chart}</div>
        {tip}
      </div>
    )
  }
  return <div className="gantt-wrap">{toolbar}{legend}{chart}{tip}</div>
}
