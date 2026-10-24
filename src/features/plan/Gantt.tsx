/**
 * Интерактивная диаграмма Ганта по канону APS (X2 P-94/P-95): «по станкам» (группы — цехи или типы РЦ,
 * подпись дорожки — только отличающая часть «№1 · Ленточнопильный…станок», колонка шириной 240 px с
 * ручкой) или «по заказам» (◆ — срок заказа); двухуровневая ось (даты над сменами), линии «старт плана»
 * и «горизонт Стадии 2»; легенда-переключатели в строке инструментов. Полоса — цвет изделия (slotForEntity),
 * наладка — тёмная штриховка ▲, ТО — серая штриховка ■, просрочка — контур + ■; статус не заливает полосу.
 * Выборка `?wc=…&m=…&o=…` раскрывает и поднимает группу, обводит дорожки и прокручивает к ним; выбранный
 * заказ — остальные приглушены до 30 %. «Вписать» — весь горизонт, плотные строки 18 px.
 * Drag&drop полосы — ручная правка «не раньше» (пин); клик без сдвига — выбрать заказ.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { hours, num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { useEscapeLayer } from '../../shell/overlays'
import { GanttAxisHead, GanttGrid } from './GanttAxis'
import { ALL_LAYERS, GanttLegendChips, GanttTip, slotClass, type GanttLayers } from './GanttParts'
import { axisLevels } from './ganttTime'
import { barSegments, buildPalette, groupBars, groupBarsByOrder, groupBarsByShop, laneDue, laneLabels, middleEllipsis, type GanttGroup, type GanttMachine } from './ganttModel'
import { parseIsoDate } from './wizard/dates'
import { barsOf, type PlanBar } from './types'
import { usePlanSelection } from './usePlanSelection'
import { Segmented } from '../../ui/kit'
import { useShops } from './useShops'
import './charts.css'

const LANE_W = 240
const LANE_KEY = 'maos.plan.gantt.laneW'
const MIN_BAR_PX = 2
const LABEL_MIN_PX = 34
const ZOOM_STEP = 1.7
const MAX_PX_PER_HOUR = 30
const CHAR_PX = 6.6
const DRAG_CLICK_PX = 3

export type GanttGrouping = 'shop' | 'wc'
type GanttView = 'machines' | 'orders'

interface GanttProps {
  result: ScheduleResult
  pins: ReadonlyMap<number, number>
  onPin?: (jobIdx: number, startHours: number) => void
  /** Начало горизонта (ISO-дата) — ось в датах; null — в сутках/часах. */
  startDate?: string | null
}

function readLaneW(): number {
  try {
    const v = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(LANE_KEY) : NaN)
    return Number.isFinite(v) && v >= 160 && v <= 420 ? v : LANE_W
  } catch {
    return LANE_W
  }
}

export function Gantt({ result, pins, onPin, startDate = null }: GanttProps) {
  const bars = barsOf(result)
  const makespan = Math.max(1, ...bars.map((g) => g.end))
  const horizon = result.portfolio_horizon_hours ?? 0
  const span = horizon > makespan && horizon <= makespan * 1.5 ? horizon : makespan
  const { shopOf, hasShops } = useShops()
  const sel = usePlanSelection()
  const [view, setView] = useState<GanttView>('machines')
  const [grouping, setGrouping] = useState<GanttGrouping>('shop')
  const [full, setFull] = useState(false)
  const [pxPerHour, setPx] = useState(0)     // 0 → по ширине (вписать)
  const [dense, setDense] = useState(false)
  const [laneW, setLaneW] = useState(readLaneW)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const [layers, setLayers] = useState<GanttLayers>(ALL_LAYERS)
  const [hover, setHover] = useState<{ x: number; y: number; g: PlanBar } | null>(null)
  const [drag, setDrag] = useState<{ idx: number; order: number; startX: number; orig: number } | null>(null)
  const [dragDx, setDragDx] = useState(0)
  /** Клавиатурный курсор по полосам дорожки: ←/→ — соседняя операция, Home/End, Esc — снять. */
  const [kbd, setKbd] = useState<{ machine: string; idx: number } | null>(null)

  // Полноэкранный Гант — слой модалки: Esc закрывает только его.
  useEscapeLayer('modal', () => setFull(false), full)

  const palette = useMemo(() => buildPalette(result.program, bars), [result.program, bars])
  const effGrouping: GanttGrouping = hasShops ? grouping : 'wc'
  const laneSel = (lane: GanttMachine): boolean => (view === 'orders'
    ? sel.order !== null && lane.bars[0]?.order_idx === sel.order
    : sel.machine === lane.id || (sel.wc !== null && lane.bars.some((b) => b.wc_type_id === sel.wc)))
  const groups: GanttGroup[] = useMemo(() => {
    const base = view === 'orders' ? groupBarsByOrder(bars) : effGrouping === 'shop' ? groupBarsByShop(bars, shopOf) : groupBars(bars)
    // Выбранная группа — первой («закреплена» вверху).
    const hit = (g: GanttGroup) => g.machines.some(laneSel)
    return [...base].sort((a, b) => Number(hit(b)) - Number(hit(a)))
    // shopOf пересоздаётся на каждый рендер, но карта цехов меняется только с hasShops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, view, effGrouping, hasShops, sel.wc, sel.machine, sel.order])
  const maxChars = Math.max(8, Math.floor((laneW - 28) / CHAR_PX))
  const labels = useMemo(() => {
    const lanes = groups.flatMap((g) => g.machines)
    if (view === 'orders') return new Map(lanes.map((l) => [l.id, middleEllipsis(l.name, maxChars)]))
    return laneLabels(lanes.map((l) => ({ id: l.id, name: l.bars[0]?.machine_name || l.name, wcName: l.bars[0]?.wc_name ?? '' })), effGrouping, maxChars)
  }, [groups, view, effGrouping, maxChars])
  const start = useMemo(() => parseIsoDate(startDate), [startDate])

  // Меряем фактическую ширину контейнера → «вписать» заполняет панель / весь экран целиком.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [contW, setContW] = useState(660)
  useEffect(() => {
    const measure = () => { if (scrollRef.current) setContW(scrollRef.current.clientWidth) }
    measure()
    const id = window.setTimeout(measure, 60)   // после раскрытия полноэкранного
    window.addEventListener('resize', measure)
    return () => { window.clearTimeout(id); window.removeEventListener('resize', measure) }
  }, [full])
  useEffect(() => { try { localStorage.setItem(LANE_KEY, String(laneW)) } catch { /* без хранилища — ширина по умолчанию */ } }, [laneW])
  // Выборка → прокрутка внутри Ганта к первой обведённой дорожке (страница не прыгает).
  useEffect(() => {
    const box = scrollRef.current
    const row = box?.querySelector<HTMLElement>('.pl-grow.is-sel')
    if (!box || !row) return
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 48
    box.scrollTo({ top: Math.max(0, top) })
  }, [sel.wc, sel.machine, sel.order, view])

  const fitPx = Math.max(0.02, Math.max(300, contW - laneW - 10) / span)
  const effPx = pxPerHour > 0 ? pxPerHour : fitPx
  const trackW = Math.max(span * effPx, 160)
  const levels = useMemo(() => axisLevels(span, effPx, start), [span, effPx, start])

  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const allCollapsed = collapsed.size >= groups.length
  const zoomBy = (f: number) => { setDense(false); setPx((p) => Math.max(fitPx * 0.5, Math.min(MAX_PX_PER_HOUR, (p > 0 ? p : fitPx) * f))) }

  // Позиция полосы с учётом пина и текущего перетаскивания.
  const startOf = (g: PlanBar) => {
    const pinned = pins.get(g.job_idx) ?? g.start
    return drag && drag.idx === g.job_idx ? Math.max(0, drag.orig + dragDx / effPx) : pinned
  }
  const endDrag = () => {
    if (drag) {
      if (Math.abs(dragDx) < DRAG_CLICK_PX) sel.select({ order: sel.order === drag.order ? null : drag.order })
      else if (onPin) onPin(drag.idx, Math.max(0, drag.orig + dragDx / effPx))
    }
    setDrag(null); setDragDx(0)
  }
  // Клавиатура на дорожке: подсказка якорится к полосе по геометрии дорожки.
  const showKbd = (track: HTMLElement, mc: GanttMachine, idx: number) => {
    const g = mc.bars[idx]
    if (!g) return
    const rect = track.getBoundingClientRect()
    setKbd({ machine: mc.id, idx })
    setHover({ x: rect.left + startOf(g) * effPx + Math.min(40, (g.end - g.start) * effPx / 2), y: rect.top + 10, g })
  }
  const onTrackKey = (e: KeyboardEvent<HTMLElement>, mc: GanttMachine) => {
    const n = mc.bars.length
    if (n === 0) return
    const cur = kbd?.machine === mc.id ? kbd.idx : -1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, (cur < 0 ? n : cur) - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape' && kbd) { setKbd(null); setHover(null); e.preventDefault(); e.stopPropagation(); return }
    else return
    e.preventDefault()
    showKbd(e.currentTarget, mc, next)
  }
  const pickLane = (mc: GanttMachine) => {
    if (view === 'orders') { const o = mc.bars[0]?.order_idx ?? null; sel.select({ order: sel.order === o ? null : o }); return }
    sel.select({ machine: sel.machine === mc.id ? null : mc.id, wc: mc.bars[0]?.wc_type_id ?? null })
  }

  const toolbar = (
    <div className="pl-gtb">
      <Segmented label="Дорожки Ганта" size="sm" fit value={view} onChange={(v: GanttView) => { setView(v); setKbd(null) }}
        options={[{ id: 'machines', label: 'по станкам' }, { id: 'orders', label: 'по заказам' }]} />
      {view === 'machines' && hasShops && (
        <Segmented label="Группировка станков" size="sm" fit value={grouping} onChange={setGrouping}
          options={[{ id: 'shop', label: 'цехи' }, { id: 'wc', label: 'типы РЦ' }]} />
      )}
      <span className="pl-gtb__group" role="group" aria-label="Масштаб">
        <button type="button" className="btn btn--icon btn--sm" title="Отдалить" aria-label="Отдалить" onClick={() => zoomBy(1 / ZOOM_STEP)}><Icon name="minus" size={14} /></button>
        <button type="button" className="btn btn--icon btn--sm" title="Приблизить" aria-label="Приблизить" onClick={() => zoomBy(ZOOM_STEP)}><Icon name="plus" size={14} /></button>
        <button type="button" className="btn btn--sm" title="Весь горизонт по ширине, плотные строки" onClick={() => { setPx(0); setDense(true) }}>Вписать</button>
      </span>
      <button type="button" className="btn btn--sm" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.wc)))}>
        {allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}
      </button>
      <span className="pl-gtb__meta num">{hours(makespan, 0)} · {num(bars.length, 0)} операций</span>
      <span className="pl-gtb__spacer" />
      <button type="button" className="btn btn--sm" onClick={() => setFull((f) => !f)}>
        <Icon name={full ? 'close' : 'expand'} size={14} />{full ? ' Свернуть' : ' Весь экран'}
      </button>
      <GanttLegendChips palette={palette} focus={focus} onFocus={setFocus} layers={layers} onLayers={setLayers} hasPins={pins.size > 0} />
    </div>
  )

  const laneCount = groups.reduce((a, g) => a + g.machines.length, 0)
  const chart = (
    <div ref={scrollRef} className={`pl-gantt${full ? ' pl-gantt--full' : ''}${dense ? ' pl-gantt--dense' : ''}`} role="figure"
         style={{ '--pl-lane-w': `${laneW}px` } as CSSProperties}
         aria-label={`Диаграмма Ганта: ${num(bars.length, 0)} операций на ${num(laneCount, 0)} дорожках, длина ${hours(makespan, 0)}`}
         onMouseLeave={() => { setHover(null); if (drag) endDrag() }}
         onMouseMove={(e) => { if (drag) { setDragDx(e.clientX - drag.startX); setHover(null) } }}
         onMouseUp={() => { if (drag) endDrag() }}>
      <div className="pl-gantt__inner" style={{ width: laneW + trackW }}>
        <GanttAxisHead levels={levels} px={effPx} trackW={trackW} laneW={laneW} onLaneW={setLaneW} dated={Boolean(start)} />
        <GanttGrid levels={levels} px={effPx} trackW={trackW} span={span} horizon={horizon} />
        {groups.map((grp) => {
          const hasSel = grp.machines.some(laneSel)
          const open = !collapsed.has(grp.wc) || hasSel
          return (
            <div key={grp.wc}>
              <div className={`pl-grow pl-grow--head${hasSel ? ' is-sel-group' : ''}`}>
                <span className="pl-glane">
                  <button type="button" className="pl-ghead" aria-expanded={open} onClick={() => toggle(grp.wc)} title={grp.name}>
                    <span className="pl-ghead__caret" aria-hidden="true">▾</span>
                    <span className="pl-ghead__name">{grp.name}</span>
                    <span className="pl-ghead__meta">{num(grp.machines.length, 0)} · {num(grp.nOps, 0)} оп</span>
                  </button>
                </span>
                <span className="pl-gtrack" style={{ width: trackW }} />
              </div>
              {open && grp.machines.map((mc) => {
                const due = view === 'orders' ? laneDue(mc) : null
                const ring = laneSel(mc)
                return (
                  <div className={`pl-grow${ring ? ' is-sel' : ''}`} key={mc.id}>
                    <span className="pl-glane" title={view === 'orders' ? mc.name : mc.bars[0]?.machine_name ?? mc.name}>
                      <button type="button" className="pl-glane__btn" aria-pressed={ring} onClick={() => pickLane(mc)}>{labels.get(mc.id) ?? mc.name}</button>
                    </span>
                    <span className="pl-gtrack" style={{ width: trackW }} tabIndex={0} role="group"
                          aria-label={`${mc.name}: ${num(mc.bars.length, 0)} операций; стрелки — по операциям`}
                          onKeyDown={(e) => onTrackKey(e, mc)} onBlur={() => { if (kbd?.machine === mc.id) { setKbd(null); setHover(null) } }}>
                      {mc.bars.map((g, bi) => {
                        const w = Math.max(MIN_BAR_PX, (g.end - g.start) * effPx)
                        const s = startOf(g)
                        const pinned = pins.has(g.job_idx)
                        const seg = barSegments(g)
                        const dim = (focus !== null && g.product_id !== focus) || (sel.order !== null && g.order_idx !== sel.order)
                        const cls = ['pl-bar', slotClass(palette.slotOf(g.product_id)), g.late && layers.late ? 'is-late' : '', pinned ? 'is-pinned' : '',
                          onPin ? 'is-draggable' : '', drag?.idx === g.job_idx ? 'is-dragging' : '', kbd?.machine === mc.id && kbd.idx === bi ? 'is-kbd' : '', dim ? 'is-dim' : '']
                          .filter(Boolean).join(' ')
                        return (
                          <span key={g.job_idx} className={cls} style={{ left: s * effPx, width: w }}
                            onMouseDown={(e) => { e.preventDefault(); setDrag({ idx: g.job_idx, order: g.order_idx, startX: e.clientX, orig: s }) }}
                            onMouseMove={(e) => { if (!drag) setHover({ x: e.clientX, y: e.clientY, g }) }}
                            onMouseLeave={() => setHover(null)}>
                            {layers.setup && seg.setupFrac > 0 && <i className="pl-bar__setup" style={{ width: `${seg.setupFrac * 100}%` }} aria-hidden="true" />}
                            {layers.down && seg.downFrac > 0 && <i className="pl-bar__down" style={{ width: `${seg.downFrac * 100}%` }} aria-hidden="true" />}
                            {w > LABEL_MIN_PX && <span className="pl-bar__label">{pinned ? '● ' : ''}{g.op_name}</span>}
                          </span>
                        )
                      })}
                      {due !== null && <i className="pl-due" style={{ left: due * effPx }} title={`срок заказа: ${hours(due, 0)}`} aria-hidden="true" />}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )

  const tip = hover && !drag && <GanttTip bar={hover.g} x={hover.x} y={hover.y} palette={palette} start={start} />
  if (full) {
    return (
      <div className="gantt__overlay" role="dialog" aria-label="Диаграмма Ганта на весь экран">
        <div className="gantt__overlay-head"><b>Диаграмма Ганта</b>{toolbar}</div>
        <div className="gantt__overlay-body">{chart}</div>
        {tip}
      </div>
    )
  }
  return <div className="gantt-wrap">{toolbar}{chart}{tip}</div>
}
