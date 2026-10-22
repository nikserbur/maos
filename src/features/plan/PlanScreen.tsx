import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api, type ScheduleResult, type OptRunSummary, type DemandOrder, type Product,
  type MrpResult, type ProductionPlan,
} from '../../lib/api'
import { LoadTimeline } from './LoadTimeline'
import { QueueChart } from './QueueChart'
import { LaborWarning } from '../nsi/LaborWarning'
import { PlanKpis } from './PlanKpis'
import { BottleneckBanner } from './BottleneckBanner'
import { GaImproverCard } from './GaImproverCard'
import { Segmented } from './ui'
import { colorVar } from './ganttModel'
import { Icon } from '../../shell/icons'
import { setDecisionContext } from '../../shell/context'
import { BlockChips } from '../../ui/BlockChip'
import { PromptDialog } from '../../ui/PromptDialog'
import { planActions } from './planStore'
import './plan.css'
import './plan-screen.css'

/** Цвет заказа по индексу в программе — общая палитра токенов (--chart-*). */
const orderColor = (i: number) => colorVar(i)
const h1 = (v: number) => v.toFixed(1)
const pct = (v: number) => Math.round(v * 100) + '%'

const RULES = [
  { id: 'auto', label: 'Авто (лучшее)' }, { id: 'EDD', label: 'EDD — по сроку' },
  { id: 'SPT', label: 'SPT — короткие вперёд' }, { id: 'CR', label: 'CR — критическое отношение' },
  { id: 'MWKR', label: 'MWKR — больше работы' }, { id: 'MS', label: 'MS — мин. запас' },
  { id: 'LPT', label: 'LPT — длинные вперёд' }, { id: 'FIFO', label: 'FIFO' },
  { id: 'custom', label: 'Конструктор эвристики…' },
]
const CRITERIA = [
  { id: 'duration', label: 'длительность операции' },
  { id: 'due', label: 'срок заказа' },
  { id: 'rem', label: 'остаточная работа по цепочке' },
  { id: 'inputs', label: 'число входных материалов' },
  { id: 'setup', label: 'время наладки' },
] as const

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
function Gantt({ result, pins, onPin }: {
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

function LoadBars({ rows, nameKey }: { rows: ScheduleResult['wc_load']; nameKey: 'wc_name' | 'machine_name' }) {
  // Производственное оборудование (есть работа) vs ИНФРАСТРУКТУРА без операций (всегда 0% —
  // её простой НЕ связан с выбором продукции, иначе вводит в заблуждение «огромными простоями»).
  const used = rows.filter((l) => l.utilization > 1e-4).sort((a, b) => b.utilization - a.utilization).slice(0, 12)
  const infra = rows.filter((l) => l.utilization <= 1e-4)
  return (
    <div>
      {used.map((l, i) => {
        const u = Math.min(1, l.utilization)
        const cls = u >= 0.85 ? ' load-bar__fill--full' : u >= 0.6 ? ' load-bar__fill--hot' : ''
        return (
          <div className="load-row" key={i}>
            <span className="load-row__name">{(l[nameKey] as string) ?? l.wc_type_id ?? ''}</span>
            <span className="load-bar"><span className={`load-bar__fill${cls}`} style={{ width: `${u * 100}%` }} /></span>
            <span className="load-row__pct">{pct(l.utilization)} · {h1(l.idle_hours)}ч простой</span>
          </div>
        )
      })}
      {infra.length > 0 && (
        <div className="load-infra">
          <b>Инфраструктура без операций ({infra.length}):</b> {infra.map((l) => (l[nameKey] as string) ?? l.wc_type_id).filter(Boolean).join(', ')}
          {' '}— ни одна операция техкарт сюда не маршрутизируется, поэтому простой 100% (это <u>не</u> следствие выбора продукции, а пробел в техкартах/НСИ).
        </div>
      )}
    </div>
  )
}


// Конструктор эвристики: [критерий, направление(±), вес]. Тип на уровне модуля,
// чтобы использовать в сохранении/загрузке пресетов эвристик.
type Crit = { criterion: 'duration' | 'due' | 'rem' | 'inputs' | 'setup'; dir: 1 | -1; weight: number }
const CRIT_LABEL: Record<Crit['criterion'], string> =
  { duration: 'длительность', due: 'срок заказа', rem: 'остаточная работа', inputs: 'входные материалы', setup: 'наладка' }
const HEUR_LS = 'maos.heuristics'          // именованные пресеты эвристик
const HEUR_CUR = 'maos.heuristic.current'  // текущая конфигурация

/** Компактная сводка активной эвристики (что где в приоритете). */
function HeurSummary({ crits }: { crits: Crit[] }) {
  const active = crits.filter((c) => c.weight > 0)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <b>Эвристика:</b>
      {active.length === 0 && <span style={{ color: 'var(--text-muted)' }}>не задана</span>}
      {active.map((c, i) => (
        <span key={i} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999,
                               background: 'var(--bg-card, #12161c)', border: '1px solid var(--border)' }}>
          {c.dir < 0 ? '↑' : '↓'} {CRIT_LABEL[c.criterion]} <span style={{ color: 'var(--text-muted)' }}>×{c.weight}</span>
        </span>
      ))}
    </span>
  )
}

/** Столбиковая визуализация вкладов критериев (знак = направление). */
function HeurViz({ crits }: { crits: Crit[] }) {
  const items = crits.filter((c) => c.weight > 0)
  const mx = Math.max(0.001, ...items.map((c) => c.weight))
  return (
    <div style={{ margin: '8px 0' }}>
      {items.map((c, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 8, alignItems: 'center', margin: '4px 0' }}>
          <span style={{ fontSize: 12 }}>{CRIT_LABEL[c.criterion]}</span>
          <span style={{ height: 12, background: 'var(--bg-app, #0d1014)', borderRadius: 3, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${c.weight / mx * 100}%`,
                           background: 'var(--accent)', borderRadius: 3 }} />
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.dir < 0 ? 'больше→раньше' : 'меньше→раньше'}</span>
        </div>
      ))}
      {items.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Добавьте критерий с весом &gt; 0.</p>}
    </div>
  )
}

/** Модальное окно конструктора эвристик: редактор критериев + визуализация + пресеты. */
function HeuristicModal({ crits, setCrits, saved, onSave, onDelete, onLoad, onClose }: {
  crits: Crit[]
  setCrits: React.Dispatch<React.SetStateAction<Crit[]>>
  saved: Record<string, Crit[]>
  onSave: () => void
  onDelete: (name: string) => void
  onLoad: (c: Crit[]) => void
  onClose: () => void
}) {
  const upd = (i: number, patch: Partial<Crit>) =>
    setCrits((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const savedNames = Object.keys(saved)
  return (
    <div className="plan__modal" onClick={onClose}>
      <div className="plan__modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="plan__modal-head">
          <div>
            <h3>Конструктор эвристики</h3>
            <p>Приоритет операции = взвешенная сумма критериев сверху вниз</p>
          </div>
          <button className="plan__modal-x" onClick={onClose} title="Закрыть">✕</button>
        </div>

        <div className="plan__modal-body">
          <p className="plan__subtitle" style={{ marginTop: 0 }}>
            Верхний критерий — главный, следующие уточняют порядок среди близких.
            Пример «длинные раньше, а из длинных — с бо́льшим числом входов»:
            <b> длительность</b> (больше→раньше, 1) + <b>входные материалы</b> (больше→раньше, 0.3).
          </p>

          <div className="heur__list">
            {crits.map((c, i) => (
              <div key={i} className="heur__crit">
                <span className="heur__rank" title={`Приоритет ${i + 1}`}>{i + 1}</span>
                <div className="heur__crit-ctl">
                  <select className="plan__select" value={c.criterion}
                          onChange={(e) => upd(i, { criterion: e.target.value as Crit['criterion'] })}>
                    {CRITERIA.map((cr) => <option key={cr.id} value={cr.id}>{cr.label}</option>)}
                  </select>
                  <select className="plan__select" value={c.dir}
                          onChange={(e) => upd(i, { dir: Number(e.target.value) as 1 | -1 })}>
                    <option value={1}>меньше — раньше</option>
                    <option value={-1}>больше — раньше</option>
                  </select>
                  <span className="heur__wrap">
                    <label>вес</label>
                    <input className="heur__weight" type="number" min="0" step="0.1" value={c.weight}
                           onChange={(e) => upd(i, { weight: Number(e.target.value) || 0 })} />
                  </span>
                </div>
                <button className="heur__del" title="Удалить критерий"
                        onClick={() => setCrits((p) => p.filter((_, j) => j !== i))}
                        disabled={crits.length <= 1}>✕</button>
              </div>
            ))}
          </div>
          <button className="heur__add"
                  onClick={() => setCrits((p) => [...p, { criterion: 'inputs', dir: -1, weight: 0.3 }])}>
            + добавить критерий
          </button>

          <p className="plan__section-title" style={{ marginTop: 16, marginBottom: 4 }}>Вклад весов</p>
          <HeurViz crits={crits} />

          <div className="heur__presets">
            <button className="btn btn--primary" style={{ height: 30 }} onClick={onSave}>💾 Сохранить как…</button>
            {savedNames.length > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Пресеты:</span>
                {savedNames.map((name) => (
                  <span key={name} className="heur__chip">
                    <button onClick={() => onLoad(saved[name])} title="Загрузить пресет">{name}</button>
                    <button onClick={() => onDelete(name)} title="Удалить пресет">✕</button>
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function PlanScreen() {
  const [rule, setRule] = useState('auto')
  const [crits, setCrits] = useState<Crit[]>(() => {
    try { const s = localStorage.getItem(HEUR_CUR); if (s) return JSON.parse(s) } catch { /* noop */ }
    return [{ criterion: 'duration', dir: -1, weight: 1 }]
  })
  const [heurOpen, setHeurOpen] = useState(false)
  const [savedHeur, setSavedHeur] = useState<Record<string, Crit[]>>(() => {
    try { const s = localStorage.getItem(HEUR_LS); if (s) return JSON.parse(s) } catch { /* noop */ }
    return {}
  })
  // Персист текущей эвристики (переживает перезагрузку/смену экрана).
  useEffect(() => { try { localStorage.setItem(HEUR_CUR, JSON.stringify(crits)) } catch { /* noop */ } }, [crits])
  // Имя пресета — в модальном окне (не window.prompt, UX-V2 U9).
  const [heurNameOpen, setHeurNameOpen] = useState(false)
  const saveHeuristic = (name: string) => {
    const next = { ...savedHeur, [name]: crits }
    setSavedHeur(next)
    setHeurNameOpen(false)
    try { localStorage.setItem(HEUR_LS, JSON.stringify(next)) } catch { /* noop */ }
  }
  const deleteHeuristic = (name: string) => {
    const next = { ...savedHeur }; delete next[name]
    setSavedHeur(next)
    try { localStorage.setItem(HEUR_LS, JSON.stringify(next)) } catch { /* noop */ }
  }
  const [samples, setSamples] = useState('500')
  const [wRisk, setWRisk] = useState('0.5')
  const [runs, setRuns] = useState<OptRunSummary[]>([])
  const [runId, setRunId] = useState('')
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Производственная программа (реестр заказов)
  const [orders, setOrders] = useState<DemandOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [newProd, setNewProd] = useState('')
  const [newQty, setNewQty] = useState('100')
  const [newDue, setNewDue] = useState('120')
  const [useCalendar, setUseCalendar] = useState(true)
  const [loadView, setLoadView] = useState<'types' | 'machines' | 'time'>('types')

  const [plans, setPlans] = useState<ProductionPlan[]>([])
  const [activePlan, setActivePlan] = useState('')
  const [mrp, setMrp] = useState<MrpResult | null>(null)

  // Ручные правки Ганта (drag&drop): job_idx → «не раньше», ч.
  const [pins, setPins] = useState<Map<number, number>>(new Map())
  const addPin = (jobIdx: number, startHours: number) =>
    setPins((prev) => { const n = new Map(prev); n.set(jobIdx, startHours); return n })
  useEffect(() => { setPins(new Map()) }, [runId, activePlan])  // смена программы → пины неактуальны

  // Заказы только активного плана.
  const planOrders = orders.filter((o) => o.plan_id === activePlan)
  const planProgram = () => planOrders.map((o) => ({
    product_id: o.product_id, qty: Number(o.quantity) || 1,
    due_hours: Number(o.due_hours) || undefined,   // сроки → time-phased MRP
  }))
  const loadMrp = (prog?: Array<{ product_id: string; qty: number }>) =>
    api.mrp.run(prog).then(setMrp).catch(() => {})
  const loadOrders = () => api.demandOrders.list().then(setOrders).catch(() => {})
  const loadPlans = () => api.plans.list().then((ps) => {
    setPlans(ps); if (ps.length && !activePlan) setActivePlan(ps[0].id)
  }).catch(() => {})
  useEffect(() => {
    api.optimize.runs().then(setRuns).catch(() => {})
    api.products.list().then((p) => setProducts(p.filter((x) => x.sellable === '1'))).catch(() => {})
    loadOrders(); loadPlans()
  }, [])
  // Пересчитать MRP под активный план.
  useEffect(() => { if (activePlan) loadMrp(planProgram()) }, [activePlan, orders]) // eslint-disable-line react-hooks/exhaustive-deps

  const prodName = (id: string) => products.find((p) => p.id === id)?.name ?? id
  const addOrder = async () => {
    if (!newProd || !activePlan) return
    await api.demandOrders.create({ plan_id: activePlan, product_id: newProd, quantity: newQty, due_hours: newDue, priority: '5' }).catch(() => {})
    setNewProd(''); await loadOrders()
  }
  const delOrder = async (id: string) => { await api.demandOrders.delete(id).catch(() => {}); await loadOrders() }
  const updateOrder = async (id: string, patch: Record<string, string>) => {
    await api.demandOrders.update(id, patch).catch(() => {}); await loadOrders()
  }
  // Создание плана — модальное окно с названием и описанием (не window.prompt).
  const [planNameOpen, setPlanNameOpen] = useState(false)
  const createPlan = async (name: string, description: string) => {
    const p = await api.plans.create({ name, description: description || undefined }).catch(() => null)
    setPlanNameOpen(false)
    await loadPlans(); if (p) setActivePlan(p.id)
  }

  // Зеркало в planStore и контекст решения — для карты методологии и полосы (UX-V2 §2.5).
  useEffect(() => { planActions.setParam('rule', rule) }, [rule])
  useEffect(() => { planActions.setParam('samples', samples) }, [samples])
  useEffect(() => { planActions.setParam('wRisk', wRisk) }, [wRisk])
  useEffect(() => { planActions.setParam('runId', runId) }, [runId])
  useEffect(() => { planActions.setParam('useCalendar', useCalendar) }, [useCalendar])
  useEffect(() => { planActions.setActivePlan(activePlan); setDecisionContext({ planId: activePlan }) }, [activePlan])

  const run = async () => {
    // Пустая программа раньше строила «молчаливый» план из одних MRP-закупок —
    // на схеме проигрывать нечего, пользователь не понимал, что не так.
    if (!runId && planProgram().length === 0) {
      setError(plans.length === 0
        ? 'Программа пуста: создайте производственный план (кнопка «+ План» ниже) и добавьте в него заказы — что, сколько и к какому сроку производить.'
        : products.length === 0
          ? 'Нет товарных изделий для заказов. Откройте «Справочники → Изделия», создайте изделие и отметьте «Товарная позиция», затем добавьте заказ здесь.'
          : 'В выбранном плане нет заказов. Добавьте их в «Производственной программе» ниже: изделие, количество, срок — иначе планировать нечего.')
      return
    }
    setRunning(true); setError(null)
    const token = planActions.beginRun()
    try {
      const r = await api.schedule.run({
        rule: rule === 'custom' ? 'auto' : rule,
        custom_rule: rule === 'custom'
          ? crits.filter((c) => c.weight > 0).map((c) => ({ criterion: c.criterion, weight: c.dir * c.weight }))
          : undefined,
        samples: Number(samples) || 500, w_risk: Number(wRisk) || 0.5,
        run_id: runId || undefined, use_calendar: useCalendar,
        program: runId ? undefined : planProgram(),
        // Ручные правки: пин = «не раньше» + тот же станок, что в текущем плане.
        pins: pins.size > 0 && result ? [...pins.entries()].map(([job_idx, start_hours]) => ({
          job_idx, start_hours,
          machine_id: result.gantt.find((g) => g.job_idx === job_idx)?.machine_id || undefined,
        })) : undefined,
      })
      if (r.error_soft) {
        const msg = r.warnings?.join(' ') || 'Нет данных для плана'
        setError(msg); planActions.failRun(token, msg)
      } else { setResult(r); planActions.finishRun(token, r) }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка планирования'
      setError(msg); planActions.failRun(token, msg)
    }
    finally { setRunning(false) }
  }

  /** Экспорт расписания в CSV (Excel-совместимый: BOM + «;»). */
  const exportCsv = () => {
    if (!result) return
    const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['Изделие', 'Операция', 'Тип РЦ', 'Станок', 'Начало, ч', 'Конец, ч', 'Срок, ч', 'Просрочка'],
      ...result.gantt.map((g) => [
        g.product_name, g.op_name, g.wc_name, g.machine_name,
        g.start.toFixed(2), g.end.toFixed(2), g.due.toFixed(2), g.late ? 'да' : '',
      ]),
    ]
    const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `план_расписание_${result.rule}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const k = result?.kpi
  return (
    <div className="plan">
      <div className="plan__head">
        <div>
          <h1 className="plan__title">
            Производственный план (Стадия 1 — как произвести)
            <span className="plan__blocks"><BlockChips blocks={['internal', 'decisions', 'criteria']} /></span>
          </h1>
          <p className="plan__subtitle">
            Программа разворачивается в граф операций по техкартам и цепочке; симуляция ставит
            операции на станки нужного типа и рабочих. Оптимизируется <strong>порядок</strong>
            операций под целевую функцию; длительности — <strong>тяжелохвостные</strong> (Монте-Карло),
            поэтому виден риск срыва срока, узкие места и простои.
          </p>
        </div>
      </div>

      <div className="plan__controls">
        <div className="plan__ctl">
          <span className="plan__ctl-label" title="Производственная программа — ЧТО и сколько производить (набор заказов). Источник: общий реестр заказов или портфель, сохранённый из оптимизации.">Программа (что производить)</span>
          <select className="plan__select" value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">Реестр заказов ({orders.length})</option>
            {runs.map((r) => <option key={r.id} value={r.id}>Портфель Стадии 2 · {r.objective} · {r.created_at?.slice(5, 16)}</option>)}
          </select>
        </div>
        <div className="plan__ctl">
          <span className="plan__ctl-label">Диспетч-правило</span>
          <select className="plan__select" value={rule} onChange={(e) => setRule(e.target.value)}>
            {RULES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="plan__ctl">
          <span className="plan__ctl-label">Прогонов (хвост)</span>
          <input className="plan__input" type="number" min="100" step="100" value={samples} onChange={(e) => setSamples(e.target.value)} />
        </div>
        <div className="plan__ctl">
          <span className="plan__ctl-label">Вес риска</span>
          <input className="plan__input" type="number" min="0" max="3" step="0.5" value={wRisk} onChange={(e) => setWRisk(e.target.value)} />
        </div>
        <div className="plan__ctl">
          <span className="plan__ctl-label">Календарь (смены 5/2)</span>
          <label className="form__check" style={{ height: 'var(--control)', display: 'flex', alignItems: 'center' }}>
            <input type="checkbox" checked={useCalendar} onChange={(e) => setUseCalendar(e.target.checked)} />
            учитывать рабочее время
          </label>
        </div>
        <button className="btn btn--primary" style={{ height: 'var(--control)' }} onClick={run} disabled={running}>
          {running ? 'Строим план…' : 'Построить и оптимизировать план'}
        </button>
        {result && (
          <button className="btn" style={{ height: 'var(--control)' }} onClick={exportCsv}
                  title="Выгрузить расписание (Гант) в CSV для Excel">
            ⭳ CSV
          </button>
        )}
      </div>

      <LaborWarning />

      {rule === 'custom' && (
        <div className="plan__panel" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <HeurSummary crits={crits} />
          <button className="btn btn--primary" style={{ height: 28 }} onClick={() => setHeurOpen(true)}>
            <Icon name="gear" size={14} /> Настроить эвристику
          </button>
        </div>
      )}

      {heurOpen && (
        <HeuristicModal
          crits={crits} setCrits={setCrits}
          saved={savedHeur} onSave={() => setHeurNameOpen(true)} onDelete={deleteHeuristic}
          onLoad={(c) => setCrits(c)}
          onClose={() => setHeurOpen(false)}
        />
      )}
      {heurNameOpen && (
        <PromptDialog
          title="Сохранить эвристику"
          label="Название пресета"
          placeholder="Например: длинные вперёд + входы"
          submitLabel="Сохранить"
          hint="Пресеты пока хранятся локально в браузере (в проект — G2)."
          onSubmit={(name) => saveHeuristic(name)}
          onCancel={() => setHeurNameOpen(false)}
        />
      )}
      {planNameOpen && (
        <PromptDialog
          title="Новый производственный план"
          label="Название"
          defaultValue={'План ' + (plans.length + 1)}
          withDescription
          onSubmit={createPlan}
          onCancel={() => setPlanNameOpen(false)}
        />
      )}

      {!runId && (
        <div className="plan__panel">
          <p className="plan__section-title" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Производственная программа — заказы (что и к какому сроку)</span>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={{ textTransform: 'none', letterSpacing: 0 }}>План:</span>
              <select className="plan__select" style={{ height: 26, minWidth: 160 }} value={activePlan} onChange={(e) => setActivePlan(e.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn" style={{ height: 26, padding: '0 8px' }} onClick={() => setPlanNameOpen(true)}>+ План</button>
            </span>
          </p>
          <table className="plan__rules" style={{ marginBottom: 8 }}>
            <thead><tr>
              <th>Изделие</th><th>Кол-во</th>
              <th title="Срок исполнения от начала горизонта, в часах: 24 ч = 1 день, 168 ч = неделя">Срок, ч ⓘ</th>
              <th title="1 — высший приоритет, 9 — низший; влияет на очерёдность при конкуренции за станки">Приоритет ⓘ</th>
              <th></th>
            </tr></thead>
            <tbody>
              {planOrders.map((o) => (
                <tr key={o.id}>
                  <td>{prodName(o.product_id)}</td>
                  <td><input className="plan__cell" type="number" min="1" defaultValue={Math.round(Number(o.quantity))}
                             onBlur={(e) => Number(e.target.value) !== Number(o.quantity) && updateOrder(o.id, { quantity: e.target.value })} /></td>
                  <td><input className="plan__cell" type="number" min="0" defaultValue={Math.round(Number(o.due_hours))}
                             onBlur={(e) => Number(e.target.value) !== Number(o.due_hours) && updateOrder(o.id, { due_hours: e.target.value })} /></td>
                  <td><input className="plan__cell" type="number" min="1" max="9" defaultValue={o.priority}
                             onBlur={(e) => e.target.value !== o.priority && updateOrder(o.id, { priority: e.target.value })} /></td>
                  <td><button className="btn btn--danger" style={{ height: 22, padding: '0 8px' }} onClick={() => delOrder(o.id)}>✕</button></td>
                </tr>
              ))}
              {planOrders.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                {plans.length === 0
                  ? 'Планов ещё нет — нажмите «+ План» выше, затем добавьте заказы.'
                  : 'В этом плане заказов нет — добавьте ниже: изделие, количество и срок.'}
              </td></tr>}
            </tbody>
          </table>
          {products.length === 0 ? (
            <p className="plan__subtitle" style={{ margin: 0 }}>
              Нет товарных изделий — заказы добавить не из чего. Откройте <b>Справочники → Изделия</b>,
              создайте изделие и отметьте «Товарная позиция», затем вернитесь сюда.
            </p>
          ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <select className="plan__select" value={newProd} onChange={(e) => setNewProd(e.target.value)}>
              <option value="">— изделие —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="plan__input" type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="кол-во" />
            <input className="plan__input" type="number" min="0" value={newDue} onChange={(e) => setNewDue(e.target.value)}
                   placeholder="срок, ч (24=1дн)" title="Срок исполнения в часах от начала горизонта: 24 ч = 1 день" />
            <button className="btn btn--primary" style={{ height: 'var(--control)' }} onClick={addOrder} disabled={!newProd || !activePlan}>+ Добавить заказ</button>
          </div>
          )}
        </div>
      )}

      {!runId && mrp && (
        <div className="plan__panel">
          <p className="plan__section-title" style={{ marginTop: 0 }}>
            MRP — потребность в материалах под программу{' '}
            <span style={{ color: mrp.feasible ? 'var(--intent-success)' : 'var(--intent-danger)', fontWeight: 600 }}>
              {mrp.feasible ? '· материально осуществимо' : '· дефицит сырья'}
            </span>
          </p>
          <table className="plan__rules">
            <thead><tr><th>Материал</th><th>Потребность</th><th>Остаток</th><th>Нетто</th><th>План. заказ</th><th>Поставка</th><th>Разместить к</th><th>Статус</th></tr></thead>
            <tbody>
              {mrp.materials.filter((m) => m.purchased).sort((a, b) => b.net_req - a.net_req).map((m) => (
                <tr key={m.product_id} className={m.shortage ? 'chosen' : ''}>
                  <td>{m.name}</td>
                  <td>{Math.round(m.gross_req).toLocaleString('ru')}</td>
                  <td>{Math.round(m.on_hand).toLocaleString('ru')}</td>
                  <td>{Math.round(m.net_req).toLocaleString('ru')}</td>
                  <td>{m.planned_qty ? Math.round(m.planned_qty).toLocaleString('ru') : '—'}</td>
                  <td>{Math.round(m.lead_time_hours)} ч</td>
                  <td style={{ color: m.late ? 'var(--intent-danger)' : 'var(--text-muted)' }}>
                    {m.place_by_hours != null
                      ? (m.place_by_hours < 0 ? 'просрочено!' : `${Math.round(m.place_by_hours)} ч`)
                      : '—'}
                  </td>
                  <td style={{ color: m.shortage ? 'var(--intent-danger)' : m.reorder ? 'var(--intent-warning)' : 'var(--text-muted)' }}>
                    {m.shortage ? 'дефицит — закупить' : m.reorder ? 'дозаказ' : 'ок'}
                  </td>
                </tr>
              ))}
              {mrp.materials.filter((m) => m.purchased).length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'left', color: 'var(--text-muted)' }}>Закупных материалов под программу нет.</td></tr>
              )}
            </tbody>
          </table>
          <p className="plan__subtitle" style={{ marginTop: 6 }}>
            Полуфабрикаты ({mrp.materials.filter((m) => !m.purchased).length}) производятся внутри по техкартам; нетто учитывает страховой запас.
          </p>
        </div>
      )}

      {error && <div className="plan__empty" style={{ color: 'var(--intent-warning)' }}>{error}</div>}
      {!result && !error && <div className="plan__empty">Выберите программу и правило, затем постройте план.</div>}

      {result && k && (
        <>
          <PlanKpis result={result} />
          <BottleneckBanner result={result} />
          {result.improver && <GaImproverCard imp={result.improver} rule={result.rule} />}

          <p className="plan__section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Диаграмма Ганта · {result.n_jobs} операций по станкам · полосы можно перетаскивать</span>
            {pins.size > 0 && (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
                <span className="plan__pins"><Icon name="pin" size={14} /> ручных правок: {pins.size}</span>
                <button className="btn btn--primary" style={{ height: 24, padding: '0 10px' }}
                        onClick={run} disabled={running}>Пересчитать с правками</button>
                <button className="btn" style={{ height: 24, padding: '0 10px' }}
                        onClick={() => setPins(new Map())}>Сбросить</button>
              </span>
            )}
          </p>
          <div className="plan__panel">
            <Gantt result={result} pins={pins} onPin={addPin} />
            <div className="plan__legend">
              {result.program.map((o, i) => (
                <span key={i}><i style={{ background: orderColor(i) }} />{o.product_name} ×{Math.round(o.qty)}</span>
              ))}
              <span><i style={{ background: 'transparent', outline: '1.5px solid var(--intent-danger)' }} />просрочка</span>
            </div>
          </div>

          {result.queue_timeline && result.queue_timeline.length > 1 && (
            <>
              <p className="plan__section-title">Очереди операций · сколько ждёт свободного станка во времени (пик = узкое место)</p>
              <div className="plan__panel"><QueueChart data={result.queue_timeline} byWc={result.queue_by_wc} /></div>
            </>
          )}

          <div className="plan__grid2">
            <div>
              <div className="plan__section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Загрузка оборудования и простои</span>
                <Segmented
                  label="Вид загрузки"
                  value={loadView}
                  onChange={setLoadView}
                  options={[{ id: 'types', label: 'по типам' }, { id: 'machines', label: 'по станкам' }, { id: 'time', label: 'во времени' }]}
                />
              </div>
              <div className="plan__panel">
                {loadView === 'types' && <LoadBars rows={result.wc_load} nameKey="wc_name" />}
                {loadView === 'machines' && <LoadBars rows={result.machine_load} nameKey="machine_name" />}
                {loadView === 'time' && <LoadTimeline gantt={result.gantt} makespan={result.kpi.makespan} />}
              </div>
            </div>
            <div>
              <p className="plan__section-title">Сравнение правил (makespan ч)</p>
              <div className="plan__panel">
                <table className="plan__rules">
                  <thead><tr><th>Правило</th><th>Сред.</th><th>CVaR</th><th>Просрочка</th></tr></thead>
                  <tbody>
                    {[...result.rules].sort((a, b) => a.score - b.score).map((r) => (
                      <tr key={r.rule} className={r.chosen ? 'chosen' : ''}>
                        <td>{r.rule}{r.chosen ? ' ←' : ''}</td>
                        <td>{h1(r.makespan)}</td><td>{h1(r.makespan_cvar)}</td><td>{h1(r.tardiness)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="plan__section-title">Планы по рабочим (доступность и простои)</p>
          <div className="plan__panel">
            {result.worker_plan.filter((w) => w.job_count > 0).map((w) => (
              <div className="worker-row" key={w.worker_id}>
                <span>{w.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{w.job_count} операций · занят {h1(w.busy_hours)} ч</span>
                <span className="worker-row__util">{pct(w.utilization)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
