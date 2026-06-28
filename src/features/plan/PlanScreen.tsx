import { useEffect, useMemo, useState } from 'react'
import {
  api, type ScheduleResult, type OptRunSummary, type DemandOrder, type Product,
} from '../../lib/api'
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

function Gantt({ result }: { result: ScheduleResult }) {
  const makespan = Math.max(1, ...result.gantt.map((g) => g.end))
  // дорожки = станки с работами, в порядке появления
  const lanes = useMemo(() => {
    const seen = new Map<string, string>()
    for (const g of result.gantt) if (g.machine_id && !seen.has(g.machine_id)) seen.set(g.machine_id, g.machine_name || g.machine_id)
    return [...seen.entries()]
  }, [result])
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((makespan * i) / 5))
  return (
    <div style={{ minWidth: 620 }}>
      {lanes.map(([mid, mname]) => (
        <div className="gantt__row" key={mid}>
          <span className="gantt__lane" title={mname}>{mname}</span>
          <span className="gantt__track">
            {result.gantt.filter((g) => g.machine_id === mid).map((g, i) => (
              <span key={i}
                className={`gantt__bar${g.late ? ' gantt__bar--late' : ''}`}
                title={`${g.op_name} · ${g.product_name}\n${h1(g.start)}–${h1(g.end)} ч${g.late ? ' · просрочка' : ''}`}
                style={{
                  left: `${(g.start / makespan) * 100}%`,
                  width: `${Math.max(0.6, ((g.end - g.start) / makespan) * 100)}%`,
                  background: ORDER_COLORS[g.order_idx % ORDER_COLORS.length],
                }} />
            ))}
          </span>
        </div>
      ))}
      <div className="gantt__axis">
        <span />
        <span className="gantt__axis-ticks">{ticks.map((t) => <span key={t}>{t}ч</span>)}</span>
      </div>
    </div>
  )
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

  const loadOrders = () => api.demandOrders.list().then(setOrders).catch(() => {})
  useEffect(() => {
    api.optimize.runs().then(setRuns).catch(() => {})
    api.products.list().then((p) => setProducts(p.filter((x) => x.sellable === '1'))).catch(() => {})
    loadOrders()
  }, [])

  const prodName = (id: string) => products.find((p) => p.id === id)?.name ?? id
  const addOrder = async () => {
    if (!newProd) return
    await api.demandOrders.create({ product_id: newProd, quantity: newQty, due_hours: newDue, priority: '5' }).catch(() => {})
    setNewProd(''); await loadOrders()
  }
  const delOrder = async (id: string) => { await api.demandOrders.delete(id).catch(() => {}); await loadOrders() }

  const run = async () => {
    setRunning(true); setError(null)
    try {
      const r = await api.schedule.run({
        rule, samples: Number(samples) || 500, w_risk: Number(wRisk) || 0.5,
        run_id: runId || undefined, use_calendar: useCalendar,
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
          <span className="plan__ctl-label">Программа</span>
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
          <p className="plan__section-title" style={{ marginTop: 0 }}>Производственная программа — заказы (что и к какому сроку)</p>
          <table className="plan__rules" style={{ marginBottom: 8 }}>
            <thead><tr><th>Изделие</th><th>Кол-во</th><th>Срок, ч</th><th>Приоритет</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{prodName(o.product_id)}</td>
                  <td>{Math.round(Number(o.quantity))}</td>
                  <td>{Math.round(Number(o.due_hours))}</td>
                  <td>{o.priority}</td>
                  <td><button className="btn btn--danger" style={{ height: 22, padding: '0 8px' }} onClick={() => delOrder(o.id)}>✕</button></td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'left', color: 'var(--text-muted)' }}>Заказов нет — добавьте ниже.</td></tr>}
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
              <p className="plan__section-title">Загрузка оборудования и простои (по типам)</p>
              <div className="plan__panel"><LoadBars rows={result.wc_load} nameKey="wc_name" /></div>
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
