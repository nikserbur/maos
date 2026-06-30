import { useEffect, useMemo, useState } from 'react'
import {
  api, type ScheduleResult, type OptRunSummary, type DemandOrder, type Product,
  type MrpResult, type ProductionPlan,
} from '../../lib/api'
import { LoadTimeline } from './LoadTimeline'
import './plan.css'

const ORDER_COLORS = ['#2d72d2', '#238551', '#c87619', '#9179f2', '#149e8e', '#cd4246', '#db2c6f', '#d1980b']
const h1 = (v: number) => v.toFixed(1)
const pct = (v: number) => Math.round(v * 100) + '%'

const RULES = [
  { id: 'auto', label: 'Авто (лучшее)' }, { id: 'EDD', label: 'EDD — по сроку' },
  { id: 'SPT', label: 'SPT — короткие вперёд' }, { id: 'CR', label: 'CR — критическое отношение' },
  { id: 'MWKR', label: 'MWKR — больше работы' }, { id: 'MS', label: 'MS — мин. запас' },
  { id: 'LPT', label: 'LPT — длинные вперёд' }, { id: 'FIFO', label: 'FIFO' },
]

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
 *  всплывающие подсказки, подписи на полосах, ось времени (ч/дн/мес). */
function Gantt({ result }: { result: ScheduleResult }) {
  const makespan = Math.max(1, ...result.gantt.map((g) => g.end))
  const [full, setFull] = useState(false)
  const [pxPerHour, setPx] = useState(0)     // 0 → по ширине (fit)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; g: GBar } | null>(null)
  const LANE_W = 168

  // Раскраска по ИЗДЕЛИЮ — одно изделие = один цвет везде.
  const products = useMemo(() => {
    const seen = new Map<string, string>()
    for (const g of result.gantt) if (!seen.has(g.product_id)) seen.set(g.product_id, g.product_name || g.product_id)
    return [...seen.entries()]
  }, [result])
  const colorIdx = useMemo(() => { const m = new Map<string, number>(); products.forEach(([p], i) => m.set(p, i)); return m }, [products])
  const colorOf = (pid: string) => ORDER_COLORS[(colorIdx.get(pid) ?? 0) % ORDER_COLORS.length]

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

  const fitPx = Math.max(0.02, (full ? 1180 : 660) / makespan)
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
      <button className="btn" onClick={() => setFull((f) => !f)}>{full ? '✕ Свернуть' : '⛶ Весь экран'}</button>
    </div>
  )

  const legend = (
    <div className="gantt__legend">
      {products.map(([pid, pname]) => (
        <span key={pid} className="gantt__legend-item" title={pname}><i style={{ background: colorOf(pid) }} />{pname}</span>
      ))}
    </div>
  )

  const chart = (
    <div className={`gantt2${full ? ' gantt2--full' : ''}`} onMouseLeave={() => setHover(null)}>
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
                      return (
                        <span key={i} className={`gantt2__bar${g.late ? ' is-late' : ''}`}
                          style={{ left: g.start * effPx, width: w, background: colorOf(g.product_id) }}
                          onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, g })}
                          onMouseLeave={() => setHover(null)}>
                          {w > 34 && <span className="gantt2__blabel">{g.op_name}</span>}
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
  return <div>{toolbar}{legend}{chart}{tip}</div>
}

function LoadBars({ rows, nameKey }: { rows: ScheduleResult['wc_load']; nameKey: 'wc_name' | 'machine_name' }) {
  const sorted = [...rows].sort((a, b) => b.utilization - a.utilization).slice(0, 12)
  return (
    <div>
      {sorted.map((l, i) => {
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
    </div>
  )
}

function Kpi({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'bad' | 'good' | 'warn' }) {
  const c = tone ? ` plan__kpi-v--${tone}` : ''
  return <div className="plan__kpi"><div className="plan__kpi-k">{k}</div><div className={`plan__kpi-v${c}`}>{v}</div>{sub && <div className="plan__kpi-sub">{sub}</div>}</div>
}

export function PlanScreen() {
  const [rule, setRule] = useState('auto')
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

  // Заказы только активного плана.
  const planOrders = orders.filter((o) => o.plan_id === activePlan)
  const planProgram = () => planOrders.map((o) => ({ product_id: o.product_id, qty: Number(o.quantity) || 1 }))
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
  const createPlan = async () => {
    const name = window.prompt('Название нового производственного плана:', 'План ' + (plans.length + 1))
    if (!name) return
    const p = await api.plans.create({ name }).catch(() => null)
    await loadPlans(); if (p) setActivePlan(p.id)
  }

  const run = async () => {
    setRunning(true); setError(null)
    try {
      const r = await api.schedule.run({
        rule, samples: Number(samples) || 500, w_risk: Number(wRisk) || 0.5,
        run_id: runId || undefined, use_calendar: useCalendar,
        program: runId ? undefined : planProgram(),
      })
      if (r.error_soft) setError(r.warnings?.join(' ') || 'Нет данных для плана')
      else setResult(r)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка планирования') }
    finally { setRunning(false) }
  }

  const k = result?.kpi
  return (
    <div className="plan">
      <div className="plan__head">
        <div>
          <h1 className="plan__title">Производственный план (Стадия 1 — как произвести)</h1>
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
      </div>

      {!runId && (
        <div className="plan__panel">
          <p className="plan__section-title" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Производственная программа — заказы (что и к какому сроку)</span>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={{ textTransform: 'none', letterSpacing: 0 }}>План:</span>
              <select className="plan__select" style={{ height: 26, minWidth: 160 }} value={activePlan} onChange={(e) => setActivePlan(e.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn" style={{ height: 26, padding: '0 8px' }} onClick={createPlan}>+ План</button>
            </span>
          </p>
          <table className="plan__rules" style={{ marginBottom: 8 }}>
            <thead><tr><th>Изделие</th><th>Кол-во</th><th>Срок, ч</th><th>Приоритет</th><th></th></tr></thead>
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
              {planOrders.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'left', color: 'var(--text-muted)' }}>В этом плане заказов нет — добавьте ниже.</td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <select className="plan__select" value={newProd} onChange={(e) => setNewProd(e.target.value)}>
              <option value="">— изделие —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="plan__input" type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="кол-во" />
            <input className="plan__input" type="number" min="0" value={newDue} onChange={(e) => setNewDue(e.target.value)} placeholder="срок, ч" />
            <button className="btn btn--primary" style={{ height: 'var(--control)' }} onClick={addOrder} disabled={!newProd}>+ Добавить заказ</button>
          </div>
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
            <thead><tr><th>Материал</th><th>Потребность</th><th>Остаток</th><th>Нетто</th><th>Срок поставки</th><th>Статус</th></tr></thead>
            <tbody>
              {mrp.materials.filter((m) => m.purchased).sort((a, b) => b.net_req - a.net_req).map((m) => (
                <tr key={m.product_id} className={m.shortage ? 'chosen' : ''}>
                  <td>{m.name}</td>
                  <td>{Math.round(m.gross_req).toLocaleString('ru')}</td>
                  <td>{Math.round(m.on_hand).toLocaleString('ru')}</td>
                  <td>{Math.round(m.net_req).toLocaleString('ru')}</td>
                  <td>{Math.round(m.lead_time_hours)} ч</td>
                  <td style={{ color: m.shortage ? 'var(--intent-danger)' : m.reorder ? 'var(--intent-warning)' : 'var(--text-muted)' }}>
                    {m.shortage ? 'дефицит — закупить' : m.reorder ? 'дозаказ' : 'ок'}
                  </td>
                </tr>
              ))}
              {mrp.materials.filter((m) => m.purchased).length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'left', color: 'var(--text-muted)' }}>Закупных материалов под программу нет.</td></tr>
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
          <div className="plan__kpis">
            <Kpi k="Makespan" v={`${h1(k.makespan_mean)} ч`} sub={`детерм. ${h1(k.makespan)} ч`} />
            <Kpi k="Makespan CVaR" v={`${h1(k.makespan_cvar)} ч`} sub={`худший ${h1(k.makespan_worst)} ч`} tone="warn" />
            <Kpi k="Просрочка" v={`${h1(k.tardiness)} ч`} sub={`CVaR ${h1(k.tardiness_cvar)} ч`} tone={k.tardiness > 0 ? 'bad' : 'good'} />
            <Kpi k="OTD (в срок)" v={pct(k.otd)} sub={`опоздавших ${k.n_late}/${result.n_orders}`} tone={k.otd >= 0.99 ? 'good' : 'warn'} />
            <Kpi k="Загрузка" v={pct(k.utilization)} sub={`${result.n_machines} станков`} />
            <Kpi k="Себестоимость работ" v={`${(k.cost / 1e3).toFixed(0)} тыс ₽`} sub={`${result.n_jobs} операций`} />
          </div>

          <div className="plan__bn">
            <span className="plan__bn-val">{result.bottleneck.wc_name}</span>
            <span className="plan__bn-text">
              <strong>Узкое место</strong> — загрузка {pct(result.bottleneck.utilization)}; здесь теряется
              больше всего времени. Правило <strong>{result.rule}</strong> выбрано как устойчивое к
              тяжёлому хвосту (минимум целевой функции время+риск). Простой станков{' '}
              {h1(result.idle.machine_idle_hours)} ч.{' '}
              {result.calendar.enabled
                ? `Рабочий календарь учтён (фонд ${h1(result.calendar.work_fond_hours)} ч в смены).`
                : 'Календарь выключен (24/7).'}
            </span>
          </div>

          <p className="plan__section-title">Диаграмма Ганта · {result.n_jobs} операций по станкам</p>
          <div className="plan__panel">
            <Gantt result={result} />
            <div className="plan__legend">
              {result.program.map((o, i) => (
                <span key={i}><i style={{ background: ORDER_COLORS[i % ORDER_COLORS.length] }} />{o.product_name} ×{Math.round(o.qty)}</span>
              ))}
              <span><i style={{ background: 'transparent', outline: '1.5px solid var(--intent-danger)' }} />просрочка</span>
            </div>
          </div>

          <div className="plan__grid2">
            <div>
              <p className="plan__section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Загрузка оборудования и простои</span>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <button className="btn" style={{ height: 22, padding: '0 8px', opacity: loadView === 'types' ? 1 : 0.55 }}
                          onClick={() => setLoadView('types')}>по типам</button>
                  <button className="btn" style={{ height: 22, padding: '0 8px', opacity: loadView === 'machines' ? 1 : 0.55 }}
                          onClick={() => setLoadView('machines')}>по станкам</button>
                  <button className="btn" style={{ height: 22, padding: '0 8px', opacity: loadView === 'time' ? 1 : 0.55 }}
                          onClick={() => setLoadView('time')}>во времени</button>
                </span>
              </p>
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
