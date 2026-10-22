/**
 * Интерактивная диаграмма Ганта (вынесена из PlanScreen без изменения поведения):
 * зум/fit, сворачиваемые группы по типу оборудования, подсказки, подписи на полосах,
 * ось времени (ч/дн/мес). Drag&drop полосы по горизонтали = ручная правка «не раньше» (пин).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { colorVar } from './ganttModel'
import { Icon } from '../../shell/icons'
import './plan.css'

/** Цвет заказа по индексу в программе — общая палитра токенов (--chart-*). */
export const orderColor = (i: number) => colorVar(i)
const h1 = (v: number) => v.toFixed(1)

type GBar = ScheduleResult['gantt'][number]
const NICE_H = [1, 2, 4, 8, 12, 24, 48, 72, 168, 336, 720, 1440, 2160, 4320]
function niceStep(makespan: number, trackW: number): number {
  const target = makespan * (96 / Math.max(1, trackW))   // ~один тик на 96px
  return NICE_H.find((s) => s >= target) ?? NICE_H[NICE_H.length - 1]
}
function fmtTick(h: number): string {
  if (h >= 720) return +(h / 720).toFixed(h % 720 ? 1 : 0) + ' мес'
  if (h >= 48) return Math.round(h / 24) + ' дн'
  return Math.round(h) + ' ч'
}

/** Интерактивная диаграмма Ганта: зум/fit, сворачиваемые группы по типу оборудования,
 *  всплывающие подсказки, подписи на полосах, ось времени (ч/дн/мес).
 *  Drag&drop: перетаскивание полосы по горизонтали = ручная правка «не раньше»
 *  (пин); «Пересчитать с правками» прогоняет план заново с этими ограничениями. */
export function Gantt({ result, pins, onPin }: {
  result: ScheduleResult
  pins: Map<number, number>
  onPin?: (jobIdx: number, startHours: number) => void
}) {
  const makespan = Math.max(1, ...result.gantt.map((g) => g.end))
  const [full, setFull] = useState(false)
  const [pxPerHour, setPx] = useState(0)     // 0 → по ширине (fit)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; g: GBar } | null>(null)
  const [drag, setDrag] = useState<{ idx: number; startX: number; orig: number } | null>(null)
  const [dragDx, setDragDx] = useState(0)
  const LANE_W = 168

  // Раскраска по ИЗДЕЛИЮ — одно изделие = один цвет везде.
  const products = useMemo(() => {
    const seen = new Map<string, string>()
    for (const g of result.gantt) if (!seen.has(g.product_id)) seen.set(g.product_id, g.product_name || g.product_id)
    return [...seen.entries()]
  }, [result])
  const colorIdx = useMemo(() => { const m = new Map<string, number>(); products.forEach(([p], i) => m.set(p, i)); return m }, [products])
  const colorOf = (pid: string) => orderColor(colorIdx.get(pid) ?? 0)

  // Группировка: тип оборудования → станки → полосы.
  const groups = useMemo(() => {
    const byWc = new Map<string, { name: string; machines: Map<string, { name: string; bars: GBar[] }> }>()
    for (const g of result.gantt) {
      const wc = g.wc_type_id || 'other'
      if (!byWc.has(wc)) byWc.set(wc, { name: g.wc_name || wc, machines: new Map() })
      const grp = byWc.get(wc)!
      const mid = g.machine_id || '—'
      if (!grp.machines.has(mid)) grp.machines.set(mid, { name: g.machine_name || mid, bars: [] })
      grp.machines.get(mid)!.bars.push(g)
    }
    return [...byWc.entries()]
  }, [result])

  // Меряем ФАКТИЧЕСКУЮ ширину контейнера → «fit» заполняет панель/весь экран целиком.
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
  const ticks: number[] = []; for (let t = 0; t <= makespan + 1e-6; t += step) ticks.push(t)

  const toggle = (wc: string) => setCollapsed((s) => { const n = new Set(s); n.has(wc) ? n.delete(wc) : n.add(wc); return n })
  const allCol = collapsed.size >= groups.length
  const zoomBy = (f: number) => setPx((p) => Math.max(fitPx * 0.5, Math.min(30, (p > 0 ? p : fitPx) * f)))

  const toolbar = (
    <div className="gantt__toolbar">
      <span className="gantt__zoomctl">масштаб
        <button className="btn" title="Отдалить" onClick={() => zoomBy(1 / 1.7)}>−</button>
        <button className="btn" title="Приблизить" onClick={() => zoomBy(1.7)}>＋</button>
        <button className="btn" title="Вписать по ширине" onClick={() => setPx(0)}>⤢ fit</button>
      </span>
      <button className="btn" onClick={() => setCollapsed(allCol ? new Set() : new Set(groups.map(([wc]) => wc)))}>
        {allCol ? '▸ Развернуть всё' : '▾ Свернуть всё'}
      </button>
      <span className="gantt__hint">⟷ {h1(makespan)} ч ≈ {(makespan / 720).toFixed(1)} мес · {result.gantt.length} операций · {groups.length} групп</span>
      <button className="btn" onClick={() => setFull((f) => !f)}><Icon name={full ? 'close' : 'expand'} size={14} />{full ? ' Свернуть' : ' Весь экран'}</button>
    </div>
  )

  const legend = (
    <div className="gantt__legend">
      {products.map(([pid, pname]) => (
        <span key={pid} className="gantt__legend-item" title={pname}><i style={{ background: colorOf(pid) }} />{pname}</span>
      ))}
    </div>
  )

  // Позиция полосы с учётом пина и текущего перетаскивания.
  const startOf = (g: GBar) => {
    let s = pins.get(g.job_idx) ?? g.start
    if (drag && drag.idx === g.job_idx) s = Math.max(0, drag.orig + dragDx / effPx)
    return s
  }
  const endDrag = () => {
    if (drag && onPin) onPin(drag.idx, Math.max(0, drag.orig + dragDx / effPx))
    setDrag(null); setDragDx(0)
  }

  const chart = (
    <div ref={scrollRef} className={`gantt2${full ? ' gantt2--full' : ''}`}
         onMouseLeave={() => { setHover(null); if (drag) endDrag() }}
         onMouseMove={(e) => { if (drag) { setDragDx(e.clientX - drag.startX); setHover(null) } }}
         onMouseUp={() => { if (drag) endDrag() }}>
      <div className="gantt2__inner" style={{ width: LANE_W + trackW }}>
        <div className="gantt2__axis">
          <span className="gantt2__axis-sp" style={{ width: LANE_W }} />
          <span className="gantt2__axis-track" style={{ width: trackW }}>
            {ticks.map((t) => <span key={t} className="gantt2__tick" style={{ left: t * effPx }}>{fmtTick(t)}</span>)}
          </span>
        </div>
        {groups.map(([wc, grp]) => {
          const isCol = collapsed.has(wc)
          const nOps = [...grp.machines.values()].reduce((a, m) => a + m.bars.length, 0)
          return (
            <div className="gantt2__group" key={wc}>
              <div className="gantt2__row gantt2__ghead" onClick={() => toggle(wc)}>
                <span className="gantt2__lane gantt2__glane" style={{ width: LANE_W }}>
                  <span className="gantt2__caret">{isCol ? '▸' : '▾'}</span><b>{grp.name}</b>
                  <span className="gantt2__gmeta">{grp.machines.size}ст·{nOps}оп</span>
                </span>
                <span className="gantt2__track" style={{ width: trackW, background: 'transparent' }} />
              </div>
              {!isCol && [...grp.machines.entries()].map(([mid, mc]) => (
                <div className="gantt2__row" key={mid}>
                  <span className="gantt2__lane" style={{ width: LANE_W }} title={mc.name}>{mc.name}</span>
                  <span className="gantt2__track" style={{ width: trackW }}>
                    {mc.bars.map((g, i) => {
                      const w = Math.max(2, (g.end - g.start) * effPx)
                      const s = startOf(g)
                      const pinned = pins.has(g.job_idx)
                      return (
                        <span key={i} className={`gantt2__bar${g.late ? ' is-late' : ''}`}
                          style={{
                            left: s * effPx, width: w, background: colorOf(g.product_id),
                            cursor: onPin ? 'grab' : undefined,
                            outline: pinned ? '1.5px dashed var(--accent)' : undefined,
                            opacity: drag && drag.idx === g.job_idx ? 0.75 : undefined,
                          }}
                          onMouseDown={(e) => {
                            if (!onPin) return
                            e.preventDefault()
                            setDrag({ idx: g.job_idx, startX: e.clientX, orig: s })
                          }}
                          onMouseMove={(e) => { if (!drag) setHover({ x: e.clientX, y: e.clientY, g }) }}
                          onMouseLeave={() => setHover(null)}>
                          {w > 34 && <span className="gantt2__blabel">{pinned ? '● ' : ''}{g.op_name}</span>}
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

  const tip = hover && (
    <div className="gantt2__tip" style={{ left: Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 250), top: hover.y + 14 }}>
      <b style={{ color: colorOf(hover.g.product_id) }}>{hover.g.product_name}</b>
      <div>{hover.g.op_name}</div>
      <div className="mono gantt2__tip-sub">{hover.g.wc_name} · {hover.g.machine_name}</div>
      <div className="mono gantt2__tip-sub">{h1(hover.g.start)}–{h1(hover.g.end)} ч · длит. {h1(hover.g.end - hover.g.start)} ч</div>
      {hover.g.late && <div className="gantt2__tip-late">⚠ просрочка (срок {h1(hover.g.due)} ч)</div>}
    </div>
  )

  if (full) return (
    <div className="gantt__overlay">
      <div className="gantt__overlay-head"><b>Диаграмма Ганта — по изделиям</b>{toolbar}</div>
      {legend}
      <div className="gantt__overlay-body">{chart}</div>
      {tip}
    </div>
  )
  return <div className="gantt-wrap">{toolbar}{legend}{chart}{tip}</div>
}
