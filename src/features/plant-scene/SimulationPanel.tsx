import { useEffect, useRef, useState } from 'react'
import { api, type CalibRow, type SimPlanSummary, type SimResults } from '../../lib/api'
import { invalidateNsi } from '../nsi/useNsi'
import { LaborWarning } from '../nsi/LaborWarning'
import type { SimState } from './SimulationLayer'

const SPEEDS = [1, 6, 24, 120, 720]   // модельных часов за секунду

/** График-«площадь» по времени с сеткой и градиентной заливкой (как в имитационных пакетах). */
function AreaChart({ pts, color, id, fmtY, peak }: {
  pts: Array<{ t: number; v: number }>; color: string; id: string
  fmtY?: (v: number) => string; peak?: boolean
}) {
  const W = 360, H = 84, pl = 34, pr = 8, pt = 10, pb = 16
  if (pts.length < 2) return null
  const maxV = Math.max(0.001, ...pts.map((p) => p.v))
  const tMax = Math.max(1, ...pts.map((p) => p.t))
  const x = (t: number) => pl + (t / tMax) * (W - pl - pr)
  const y = (v: number) => pt + (1 - v / maxV) * (H - pt - pb)
  const line = pts.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')
  const area = `${x(0)},${H - pb} ${line} ${x(tMax)},${H - pb}`
  const pk = pts.reduce((a, p) => (p.v > a.v ? p : a), pts[0])
  const fy = fmtY ?? ((v: number) => String(Math.round(v)))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`ag-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.34} />
          <stop offset="100%" stopColor={color} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      {/* сетка: четверти по Y */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pl} x2={W - pr} y1={pt + f * (H - pt - pb)} y2={pt + f * (H - pt - pb)}
              stroke="var(--border, #2a2f37)" strokeDasharray="3 4" strokeWidth={0.6} />
      ))}
      <polygon points={area} fill={`url(#ag-${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.7} />
      {peak && <circle cx={x(pk.t)} cy={y(pk.v)} r={3.2} fill={color} stroke="var(--bg-card,#12161c)" strokeWidth={1.4} />}
      <text x={2} y={pt + 5} fontSize={9} fill="var(--text-muted)" fontFamily="var(--font-mono)">{fy(maxV)}</text>
      <text x={2} y={H - pb + 3} fontSize={9} fill="var(--text-muted)" fontFamily="var(--font-mono)">0</text>
      <text x={pl} y={H - 3} fontSize={9} fill="var(--text-muted)" fontFamily="var(--font-mono)">0ч</text>
      <text x={W - pr} y={H - 3} fontSize={9} fill="var(--text-muted)" textAnchor="end" fontFamily="var(--font-mono)">{Math.round(tMax)}ч</text>
    </svg>
  )
}

function Kpi({ k, v, sub, hero }: { k: string; v: string; sub?: string; hero?: boolean }) {
  return (
    <div className={`sim__kpi${hero ? ' sim__kpi--hero' : ''}`}>
      <div className="sim__kpi-k">{k}</div>
      <div className="sim__kpi-v">{v}{sub && <small> {sub}</small>}</div>
    </div>
  )
}

/** Панель имитационного режима: выбор плана, плеер, живые показатели, результаты
 *  (графики как в имитационных пакетах) и калибровка НСИ по факту прогона. */
export function SimulationPanel({ sim, onClose }: {
  sim: React.MutableRefObject<SimState>
  onClose: () => void
}) {
  const [meta, setMeta] = useState<{ planId: string | null; n: number; makespan: number; workers: number } | null>(null)
  const [live, setLive] = useState({ t: 0, busy: 0, done: 0, playing: false, speed: 24, peakBusy: 0 })
  const [tab, setTab] = useState<'play' | 'results' | 'calib'>('play')
  const [rows, setRows] = useState<CalibRow[] | null>(null)
  const [res, setRes] = useState<SimResults | null>(null)
  const [applying, setApplying] = useState(false)
  const [plans, setPlans] = useState<SimPlanSummary[]>([])
  const [planId, setPlanId] = useState<string>('')
  const raf = useRef(0)

  const loadPlan = (id?: string) => {
    api.simulation.plan(id)
      .then((p) => {
        const s = sim.current
        s.tasks = p.tasks; s.makespan = p.makespan; s.t = 0; s.playing = false; s.rev++
        const workers = new Set(p.tasks.map((t) => t.worker_id).filter(Boolean)).size
        setMeta({ planId: p.plan_id, n: p.tasks.length, makespan: p.makespan, workers })
        if (p.plan_id) setPlanId(p.plan_id)
        setRes(null)   // сбросить результаты при смене плана
      })
      .catch(() => setMeta({ planId: null, n: 0, makespan: 0, workers: 0 }))
  }

  useEffect(() => {
    api.simulation.plans().then(setPlans).catch(() => {})
    loadPlan()
    return () => { sim.current.playing = false; cancelAnimationFrame(raf.current) }
  }, [sim])

  // Лёгкий тик панели (4 Гц): читаем изменяемое состояние без ререндера сцены.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sim.current
      let done = 0
      const machines = new Set<string>()
      for (const t of s.tasks) {
        if (t.start <= s.t && s.t < t.end) machines.add(t.machine_id)
        if (t.end <= s.t) done++
      }
      setLive((prev) => ({ t: s.t, busy: machines.size, done, playing: s.playing,
        speed: s.speed, peakBusy: Math.max(prev.peakBusy, machines.size) }))
    }, 250)
    return () => window.clearInterval(id)
  }, [sim])

  const loadCalib = () => {
    setTab('calib')
    if (!rows) api.simulation.calibration().then((r) => setRows(r.rows)).catch(() => setRows([]))
  }
  const loadResults = () => {
    setTab('results')
    api.simulation.results(planId || undefined).then(setRes).catch(() => setRes(null))
  }
  const applyAll = async (items: CalibRow[]) => {
    setApplying(true)
    try {
      await api.simulation.calibrate(items.map((r) => ({ op_id: r.op_id, t_norm: Math.round(r.realized_mean) })))
      invalidateNsi()
      const r = await api.simulation.calibration()
      setRows(r.rows)
    } finally { setApplying(false) }
  }

  const totalH = Math.round(live.t)
  const day = Math.floor(totalH / 24), hour = totalH % 24
  const worst = (rows ?? []).slice().sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct)).slice(0, 15)

  return (
    <div className="sim">
      <div className="sim__head">
        <div>
          <h3>🏭 Имитационное моделирование</h3>
          <p>Проигрывание плана на 3D-схеме · очереди · операторы</p>
        </div>
        <button className="sim__x" onClick={onClose} title="Закрыть">✕</button>
      </div>

      <div className="sim__tabs">
        <button className={`sim__tab${tab === 'play' ? ' sim__tab--on' : ''}`} onClick={() => setTab('play')}>▶ Прогон</button>
        <button className={`sim__tab${tab === 'results' ? ' sim__tab--on' : ''}`} onClick={loadResults}>📊 Результаты</button>
        <button className={`sim__tab${tab === 'calib' ? ' sim__tab--on' : ''}`} onClick={loadCalib}>⚙ В НСИ</button>
      </div>

      <div className="sim__body">
        {meta && !meta.planId && (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Нет построенного плана. Откройте экран «План», постройте расписание — и его
            можно будет проиграть на схеме.
          </p>
        )}

        {tab === 'play' && plans.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>План:</span>
            <select className="sim__select" style={{ flex: 1 }} value={planId}
                    onChange={(e) => loadPlan(e.target.value)}>
              {plans.map((p, i) => (
                <option key={p.id} value={p.id}>
                  #{plans.length - i} · {Math.round(Number(p.makespan) || 0)} ч · {p.n_tasks} оп · {(p.created_at || '').slice(5, 16)}
                </option>
              ))}
            </select>
          </div>
        )}

        {meta?.planId && tab === 'play' && (
          <>
            <div className="sim__player">
              <div className="sim__transport">
                <button className="sim__play" title={live.playing ? 'Пауза' : 'Запустить'}
                        onClick={() => { const s = sim.current; if (s.t >= s.makespan) s.t = 0; s.playing = !s.playing }}>
                  {live.playing ? '⏸' : '▶'}
                </button>
                <button className="sim__rw" title="В начало" onClick={() => { sim.current.t = 0; sim.current.playing = false }}>⏮</button>
                <select className="sim__select" value={live.speed}
                        onChange={(e) => { sim.current.speed = Number(e.target.value) }}>
                  {SPEEDS.map((sp) => <option key={sp} value={sp}>×{sp} ч/с</option>)}
                </select>
                <div className="sim__clock">
                  день {day} · {String(hour).padStart(2, '0')}:00
                  <small>горизонт {Math.round(meta.makespan)} ч ({(meta.makespan / 24).toFixed(1)} дн)</small>
                </div>
              </div>
              <input className="sim__range" type="range" min={0} max={Math.max(1, meta.makespan)}
                     step={meta.makespan / 500 || 1} value={live.t}
                     onChange={(e) => { sim.current.t = Number(e.target.value); sim.current.playing = false }} />
            </div>

            <div className="sim__kpis">
              <Kpi k="Занято станков" v={String(live.busy)} sub={`пик ${live.peakBusy}`} />
              <Kpi k="Выполнено" v={`${meta.n ? Math.round(live.done / meta.n * 100) : 0}%`} sub={`${live.done}/${meta.n}`} />
              <Kpi k="Рабочих" v={String(meta.workers)} />
            </div>

            <ul className="sim__legend">
              <li><span className="sim__dot" style={{ background: '#f5a623' }} />кольцо — узел занят (у цеха ярче при большей загрузке)</li>
              <li><span className="sim__dot" style={{ background: '#c9964a' }} />ящики — очередь партий (батчи копятся)</li>
              <li><span className="sim__dot" style={{ background: '#2ea3f2' }} />человечки — рабочие у станков и на переходах</li>
              <li><span className="sim__dot" style={{ background: '#8be04e' }} />цветные партии летят между станками по маршрутам</li>
            </ul>

            <div style={{ marginTop: 10 }}><LaborWarning compact /></div>

            {/* Итог прогона: появляется, когда время дошло до конца горизонта. */}
            {meta.n > 0 && live.done >= meta.n && (
              <div className="sim__done">
                <b style={{ color: 'var(--intent-success)' }}>✓ Прогон завершён</b>
                <div className="mono" style={{ marginTop: 4, color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 11.5 }}>
                  операций выполнено: {meta.n} · горизонт {Math.round(meta.makespan)} ч ({(meta.makespan / 24).toFixed(1)} дн)
                  · пик занятости: {live.peakBusy} станков
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn btn--primary" style={{ height: 26 }} onClick={loadResults}>📊 Результаты</button>
                  <button className="btn" style={{ height: 26 }} onClick={loadCalib}>⚙ Калибровка НСИ</button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'results' && (
          <>
            {!res && <p style={{ color: 'var(--text-muted)', margin: 0 }}>Загрузка результатов…</p>}
            {res && res.n_machines === 0 && <p style={{ color: 'var(--text-muted)', margin: 0 }}>Нет данных прогона — постройте план.</p>}
            {res && res.n_machines > 0 && (
              <>
                <div className="sim__kpis">
                  <Kpi hero k="Требуется операторов" v={String(res.required_operators)} sub={`ср. ${res.avg_operators.toFixed(1)}`} />
                  <Kpi k="В справочнике" v={String(res.n_workers)} />
                  <Kpi k="Загрузка (ср.)" v={`${Math.round(res.avg_utilization * 100)}%`} />
                  <Kpi k="Станков" v={String(res.n_machines)} />
                  <Kpi k="Проходка" v={res.throughput_per_day.toFixed(1)} sub="парт/дн" />
                </div>

                <div className="sim__chart">
                  <p className="sim__chart-t">Загрузка оборудования во времени</p>
                  <AreaChart id="util" pts={res.util_series.map((p) => ({ t: p.t, v: p.util }))}
                             color="var(--intent-warning, #d9822b)" fmtY={(v) => Math.round(v * 100) + '%'} />
                </div>
                <div className="sim__chart">
                  <p className="sim__chart-t">Занятые операторы · пик = {res.required_operators}</p>
                  <AreaChart id="ops" pts={res.workers_series.map((p) => ({ t: p.t, v: p.workers }))}
                             color="var(--accent, #2d72d2)" peak />
                </div>

                <div className="sim__chart">
                  <p className="sim__chart-t">Загрузка по станкам (топ-12)</p>
                  <div style={{ maxHeight: 156, overflow: 'auto' }}>
                    {res.per_machine.slice().sort((a, b) => b.utilization - a.utilization).slice(0, 12).map((m) => (
                      <div key={m.machine_id} className="sim__mrow">
                        <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.name}>{m.name}</span>
                        <span className="sim__mbar">
                          <span style={{ width: `${Math.min(1, m.utilization) * 100}%`,
                            background: m.utilization > 0.85 ? 'var(--intent-danger)' : 'var(--intent-warning)' }} />
                        </span>
                        <span className="mono" style={{ fontSize: 10.5, textAlign: 'right', color: 'var(--text-muted)' }}>{Math.round(m.utilization * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sim__nsi">
                  <b>→ Рекомендация в НСИ</b>
                  <p style={{ margin: '4px 0 8px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    Для этого плана достаточно <b>{res.required_operators}</b> операторов (пик одновременной занятости).
                    {res.n_workers > res.required_operators + 1 &&
                      ` В справочнике их ${res.n_workers} — ${res.n_workers - res.required_operators} избыточны для этого объёма.`}
                    {' '}Наблюдаемые длительности операций можно записать в нормативы:
                  </p>
                  <button className="btn btn--primary" style={{ height: 27 }} onClick={loadCalib}>⚙ Калибровка норм НСИ →</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'calib' && (
          <>
            <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
              Наблюдаемая в прогоне длительность (обработка + наладки + ТО) против норматива
              НСИ. Применение обновит t_norm (t_opt/t_pess — пропорционально).
            </p>
            {rows === null && <p>Загрузка…</p>}
            {rows && worst.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Нет данных для калибровки.</p>}
            {worst.length > 0 && (
              <>
                <table className="sim__table">
                  <thead><tr><th>Операция</th><th>Норматив</th><th>Факт (ср.)</th><th>Δ</th></tr></thead>
                  <tbody>
                    {worst.map((r) => (
                      <tr key={r.op_id}>
                        <td title={r.product_name}>{r.op_name.slice(0, 24)}</td>
                        <td>{Math.round(r.t_norm)} мин</td>
                        <td>{Math.round(r.realized_mean)} мин</td>
                        <td style={{ color: Math.abs(r.delta_pct) > 25 ? 'var(--intent-danger)' : 'var(--text-muted)' }}>
                          {r.delta_pct > 0 ? '+' : ''}{Math.round(r.delta_pct)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn--primary" style={{ height: 28, marginTop: 10 }} disabled={applying}
                        onClick={() => applyAll(worst.filter((r) => Math.abs(r.delta_pct) > 10))}>
                  {applying ? 'Применяем…' : `Записать в НСИ (Δ>10%: ${worst.filter((r) => Math.abs(r.delta_pct) > 10).length} операций)`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
