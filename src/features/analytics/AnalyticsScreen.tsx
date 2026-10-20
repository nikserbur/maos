import { useEffect, useMemo, useState } from 'react'
import {
  api, type Machine, type Worker, type WorkCenterType,
  type SimResults, type SimPlan, type SimPlanSummary, type InvestmentResult, type KpiBundle,
} from '../../lib/api'
import { isEligible } from '../nsi/labor'
import { KPI_CATALOG, KPI_CATEGORIES } from './kpiCatalog'
import { kpiDeltaText, kpiParts, kpiText } from './kpiFormat'
import { KpiDashboard } from './KpiDashboard'
import { Icon } from '../../shell/icons'
import './analytics.css'

type Tab = 'kpi' | 'bottleneck' | 'invest' | 'flow'

/** Загрузка типа + труд: реальный параллелизм = min(станки, операторы). */
interface TypeLoad {
  typeId: string; name: string
  machines: number; operators: number
  utilization: number   // средняя по станкам типа (0..1)
  laborBound: boolean   // операторов меньше станков → упор в труд
}

const rubM = (v: number) => Math.abs(v) >= 1e6
  ? `${(v / 1e6).toFixed(1)} млн ₽` : `${Math.round(v).toLocaleString('ru')} ₽`
const pct = (v: number) => `${Math.round(v * 100)}%`

export function AnalyticsScreen() {
  const [tab, setTab] = useState<Tab>('kpi')
  const [machines, setMachines] = useState<Machine[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [wcTypes, setWcTypes] = useState<WorkCenterType[]>([])
  const [plans, setPlans] = useState<SimPlanSummary[]>([])
  const [planId, setPlanId] = useState<string>('')
  const [res, setRes] = useState<SimResults | null>(null)
  const [kpiB, setKpiB] = useState<KpiBundle | null>(null)
  const [plan, setPlan] = useState<SimPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [investType, setInvestType] = useState<string>('')   // предвыбор из «узких мест»

  useEffect(() => {
    Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workers.list().catch(() => [] as Worker[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
      api.simulation.plans().catch(() => [] as SimPlanSummary[]),
    ]).then(([m, w, t, pl]) => {
      setMachines(m); setWorkers(w); setWcTypes(t); setPlans(pl)
      if (pl.length) setPlanId(pl[0].id)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    // Бэкенд без построенного плана отдаёт { plan_id: null } БЕЗ массива per_machine.
    // Нормализуем к null, иначе `res` истинный, но `res.per_machine` undefined → краш.
    api.simulation.results(planId || undefined)
      .then((r) => setRes(r && r.plan_id && Array.isArray(r.per_machine) ? r : null))
      .catch(() => setRes(null))
    api.analytics.kpi(planId || undefined).then(setKpiB).catch(() => setKpiB(null))
    if (tab === 'flow') api.simulation.plan(planId || undefined).then(setPlan).catch(() => setPlan(null))
  }, [planId, tab])

  const nameOfType = useMemo(() => {
    const map = new Map(wcTypes.map((t) => [t.id, t.name]))
    return (id: string) => map.get(id) ?? id
  }, [wcTypes])

  // Загрузка по типам РЦ из per_machine + труд.
  const typeLoads = useMemo<TypeLoad[]>(() => {
    if (!res || !Array.isArray(res.per_machine)) return []
    const mType = new Map(machines.map((m) => [m.id, m.wc_type_id]))
    const agg = new Map<string, { sum: number; n: number }>()
    for (const pm of res.per_machine) {
      const t = mType.get(pm.machine_id); if (!t) continue
      const a = agg.get(t) ?? { sum: 0, n: 0 }
      a.sum += pm.utilization; a.n += 1; agg.set(t, a)
    }
    const out: TypeLoad[] = []
    for (const t of wcTypes) {
      const machCount = machines.filter((m) => m.wc_type_id === t.id).length
      if (machCount === 0) continue
      const ops = workers.filter((w) => isEligible(w.skills, t.name, t.id)).length
      const a = agg.get(t.id)
      out.push({
        typeId: t.id, name: t.name, machines: machCount, operators: ops,
        utilization: a && a.n ? a.sum / a.n : 0,
        laborBound: ops < machCount,
      })
    }
    return out.sort((x, y) => y.utilization - x.utilization)
  }, [res, machines, workers, wcTypes])

  const goInvest = (typeId: string) => { setInvestType(typeId); setTab('invest') }

  if (loading) return <div className="an"><p className="an__muted">Загрузка аналитики…</p></div>

  return (
    <div className="an">
      <div className="an__head">
        <div>
          <h1 className="an__title">Аналитика</h1>
          <p className="an__subtitle">
            KPI, узкие места и инвестпроекты по построенному плану. Показатели —
            из результатов симуляции; инвестрасчёт — через рыночную модель и
            производительность (Стадия 2). См. <b>docs/ANALYTICS.md</b>.
          </p>
        </div>
        {plans.length > 0 && (
          <div className="an__planpick">
            <span className="an__muted">План:</span>
            <select className="an__select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p, i) => (
                <option key={p.id} value={p.id}>
                  #{plans.length - i} · {Math.round(Number(p.makespan) || 0)} ч · {p.n_tasks} оп · {(p.created_at || '').slice(5, 16)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="an__tabs">
        {([['kpi', 'chart', 'KPI'], ['bottleneck', 'link', 'Узкие места'], ['invest', 'money', 'Инвестпроекты'], ['flow', 'shuffle', 'Потоки']] as const)
          .map(([id, icon, label]) => (
            <button key={id} className={`an__tab${tab === id ? ' an__tab--on' : ''}`} onClick={() => setTab(id as Tab)}><Icon name={icon} size={15} />{label}</button>
          ))}
      </div>

      {!res && <p className="an__muted">Нет данных плана. Постройте расписание на экране «План».</p>}

      {tab === 'kpi' && <KpiTab b={kpiB} res={res} loads={typeLoads} plans={plans} planId={planId} onInvest={goInvest} />}
      {res && tab === 'bottleneck' && <BottleneckTab loads={typeLoads} onInvest={goInvest} />}
      {tab === 'invest' && <InvestTab wcTypes={wcTypes} loads={typeLoads} preselect={investType} nameOfType={nameOfType} />}
      {res && tab === 'flow' && <FlowTab plan={plan} machines={machines} nameOfType={nameOfType} />}
    </div>
  )
}

/** Мини-график площади по времени. */
function Spark({ pts, color, fmtY }: { pts: Array<{ t: number; v: number }>; color: string; fmtY?: (v: number) => string }) {
  const W = 320, H = 60, pl = 30, pr = 6, pt = 6, pb = 12
  if (pts.length < 2) return <span className="an__muted">нет ряда</span>
  const maxV = Math.max(1e-6, ...pts.map((p) => p.v)), tMax = Math.max(1, ...pts.map((p) => p.t))
  const x = (t: number) => pl + (t / tMax) * (W - pl - pr)
  const y = (v: number) => pt + (1 - v / maxV) * (H - pt - pb)
  const line = pts.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <polygon points={`${x(0)},${H - pb} ${line} ${x(tMax)},${H - pb}`} fill={color} opacity={0.14} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} />
      <text x={2} y={pt + 6} fontSize={9} fill="var(--text-muted)">{fmtY ? fmtY(maxV) : Math.round(maxV)}</text>
      <text x={pl} y={H - 3} fontSize={9} fill="var(--text-muted)">0ч</text>
      <text x={W - pr} y={H - 3} fontSize={9} fill="var(--text-muted)" textAnchor="end">{Math.round(tMax)}ч</text>
    </svg>
  )
}

/* ── KPI-вкладка: настраиваемый дашборд сверху + детальный разбор ниже ──────── */
function KpiTab(props: {
  b: KpiBundle | null; res: SimResults | null; loads: TypeLoad[]
  plans: SimPlanSummary[]; planId: string; onInvest: (id: string) => void
}) {
  return (
    <>
      <KpiDashboard bundle={props.b} res={props.res} />
      <KpiDetails {...props} />
    </>
  )
}

/* ── Детальный разбор KPI: реестр метрик + светофор + тренды + рекомендации + сравнение ── */
function KpiDetails({ b, res, loads, plans, planId, onInvest }: {
  b: KpiBundle | null; res: SimResults | null; loads: TypeLoad[]
  plans: SimPlanSummary[]; planId: string; onInvest: (id: string) => void
}) {
  const [cmpId, setCmpId] = useState('')
  const [cmp, setCmp] = useState<KpiBundle | null>(null)
  useEffect(() => {
    if (!cmpId) { setCmp(null); return }
    api.analytics.kpi(cmpId).then(setCmp).catch(() => setCmp(null))
  }, [cmpId])

  const hasKpi = b && b.kpi && Object.keys(b.kpi).length > 0
  if (!hasKpi) return (
    <div className="an__panel"><p className="an__muted" style={{ margin: 0 }}>
      Для полного набора KPI постройте (или перестройте) расписание на экране «План» —
      показатели сохраняются при построении. {res && res.n_machines > 0 && 'Базовые метрики есть во вкладках «Узкие места»/«Потоки».'}
    </p></div>
  )
  const bundle = b as KpiBundle

  // Рекомендации (decision-support): выводим действия с количественным обоснованием.
  const recs: Array<{ text: string; wct?: string }> = []
  const bnU = Number(bundle.bottleneck?.utilization ?? 0)
  if (bnU >= 0.9 && bundle.bottleneck?.wc_type_id)
    recs.push({ text: `Узкое место «${bundle.bottleneck.wc_name}» загружено на ${Math.round(bnU * 100)}% — оцените докупку оборудования (инвестпроект).`, wct: bundle.bottleneck.wc_type_id })
  const laborShort = loads.filter((l) => l.laborBound && l.utilization >= 0.6)
  for (const l of laborShort.slice(0, 2))
    recs.push({ text: `На «${l.name}» операторов (${l.operators}) меньше станков (${l.machines}) при загрузке ${Math.round(l.utilization * 100)}% — добавьте допуски/рабочих, иначе станки простаивают.` })
  const otd = Number(bundle.kpi.otd ?? 1), nLate = Number(bundle.kpi.n_late ?? 0)
  if (otd < 0.9) recs.push({ text: `OTD ${Math.round(otd * 100)}% — просрочено ${nLate} заказов; смягчите сроки или снимите узкое место.` })
  const wait = Number(bundle.kpi.wait_share ?? 0)
  if (wait > 0.5) recs.push({ text: `Доля ожидания в очередях ${Math.round(wait * 100)}% — поток сдерживается ограничением, разгрузка узкого места ускорит цикл.` })
  const setupShare = Number(bundle.kpi.setup_hours ?? 0) / Math.max(1e-6, Number(bundle.kpi.makespan ?? 1))
  if (setupShare > 0.2) recs.push({ text: `Переналадки съедают ${Math.round(setupShare * 100)}% времени — группируйте похожие изделия (SPT/наладко-ориентированная эвристика).` })

  return (
    <>
      {recs.length > 0 && (
        <div className="an__panel an__recs">
          <p className="an__panel-t">Рекомендации (что улучшить)</p>
          {recs.map((r, i) => (
            <div key={i} className="an__rec">
              <span><Icon name="bulb" size={15} />{r.text}</span>
              {r.wct && <button className="btn" onClick={() => onInvest(r.wct!)}>инвест →</button>}
            </div>
          ))}
        </div>
      )}

      {/* Сравнение планов (A/B) — как сценарии Palantir: дельта по ключевым KPI. */}
      {plans.length > 1 && (
        <div className="an__panel">
          <p className="an__panel-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Сравнить с планом
            <select className="an__select" value={cmpId} onChange={(e) => setCmpId(e.target.value)} style={{ height: 26 }}>
              <option value="">— выберите второй план —</option>
              {plans.filter((p) => p.id !== planId).map((p, i) => (
                <option key={p.id} value={p.id}>#{plans.length - i} · {(p.created_at || '').slice(5, 16)}</option>
              ))}
            </select>
          </p>
          {cmp && cmp.kpi && Object.keys(cmp.kpi).length > 0 && (
            <div className="an__cmp">
              {['MAKESPAN', 'OTD', 'TARD', 'UTIL', 'THRU', 'COST'].map((code) => {
                const k = KPI_CATALOG.find((x) => x.code === code)!
                const va = k.value(bundle), vb = k.value(cmp)
                const d = va - vb, better = k.dir === 'up' ? d > 0 : k.dir === 'down' ? d < 0 : null
                return (
                  <div key={code} className="an__cmp-row">
                    <span>{k.name}</span>
                    <span className="mono">{kpiText(va, k.unit)}</span>
                    <span className="mono an__muted">vs {kpiText(vb, k.unit)}</span>
                    <span className="mono" style={{ color: better == null ? 'var(--text-muted)' : better ? 'var(--intent-success)' : 'var(--intent-danger)' }}>
                      {kpiDeltaText(d, k.unit)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {KPI_CATEGORIES.map((cat) => {
        const items = KPI_CATALOG.filter((k) => k.category === cat)
        if (!items.length) return null
        return (
          <div key={cat} className="an__panel">
            <p className="an__panel-t">{cat}</p>
            <div className="an__kpis">
              {items.map((k) => {
                const v = k.value(bundle)
                const st = k.status ? k.status(v, bundle) : ''
                return (
                  <div key={k.code} className={`an__kpi${st ? ` an__kpi--${st}` : ''}`} title={k.nameEn}>
                    <div className="an__kpi-k">{k.name}
                      <span className={`an__dir an__dir--${k.dir}`}>{k.dir === 'up' ? '↑' : k.dir === 'down' ? '↓' : '·'}</span>
                    </div>
                    <div className="an__kpi-v">{kpiParts(v, k.unit).value}<small> {kpiParts(v, k.unit).unit}</small></div>
                    <div className="an__kpi-f">{k.formula}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {res && (res.util_series?.length > 1 || res.workers_series?.length > 1) && (
        <div className="an__panel">
          <p className="an__panel-t">Тренды во времени</p>
          <div className="an__trends">
            <div><div className="an__kpi-k">Загрузка оборудования</div>
              <Spark pts={res.util_series.map((p) => ({ t: p.t, v: p.util }))} color="var(--intent-warning)" fmtY={(v) => Math.round(v * 100) + '%'} /></div>
            <div><div className="an__kpi-k">Занятые операторы</div>
              <Spark pts={res.workers_series.map((p) => ({ t: p.t, v: p.workers }))} color="var(--accent)" /></div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Узкие места: ранжир типов по загрузке + труд ──────────────────────────── */
function BottleneckTab({ loads, onInvest }: { loads: TypeLoad[]; onInvest: (id: string) => void }) {
  if (!loads.length) return <p className="an__muted">Нет загрузки по типам — постройте план.</p>
  const max = Math.max(0.01, ...loads.map((l) => l.utilization))
  return (
    <div className="an__panel">
      <p className="an__panel-t">Ранжир по загрузке — где система «упирается»</p>
      <p className="an__muted" style={{ margin: '0 0 10px' }}>
        Теория ограничений: наращивать выпуск имеет смысл только на узком месте.
        Параллелизм ограничен <b>min(станки, операторы)</b> — если операторов меньше,
        добавлять станки бесполезно.
      </p>
      {loads.map((l, i) => {
        const hot = l.utilization >= 0.9, warm = l.utilization >= 0.75
        return (
          <div key={l.typeId} className="an__brow">
            <span className="an__brank">{i + 1}</span>
            <span className="an__bname">{l.name}
              {l.laborBound && <span className="an__badge an__badge--labor">упор в труд · {l.operators} опер. на {l.machines} станк.</span>}
            </span>
            <span className="an__bbar">
              <span style={{ width: `${(l.utilization / max) * 100}%`,
                background: hot ? 'var(--intent-danger)' : warm ? 'var(--intent-warning)' : 'var(--accent)' }} />
            </span>
            <span className="an__bval">{pct(l.utilization)}</span>
            <button className="btn" onClick={() => onInvest(l.typeId)} title="Оценить докупку оборудования">инвест →</button>
          </div>
        )
      })}
    </div>
  )
}

/* ── Инвестпроекты: калькулятор окупаемости ────────────────────────────────── */
function InvestTab({ wcTypes, loads, preselect, nameOfType }: {
  wcTypes: WorkCenterType[]; loads: TypeLoad[]; preselect: string
  nameOfType: (id: string) => string
}) {
  const [wct, setWct] = useState(preselect || wcTypes[0]?.id || '')
  const [addN, setAddN] = useState('2')
  const [capex, setCapex] = useState('2500000')
  const [disc, setDisc] = useState('18')
  const [life, setLife] = useState('60')
  const [demand, setDemand] = useState('1')
  const [running, setRunning] = useState(false)
  const [r, setR] = useState<InvestmentResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (preselect) setWct(preselect) }, [preselect])

  const run = async () => {
    if (!wct) { setErr('Выберите тип оборудования'); return }
    setRunning(true); setErr(null); setR(null)
    try {
      const out = await api.analytics.investment({
        wc_type_id: wct, add_machines: Number(addN) || 1,
        machine_capex: Number(capex) || 0, discount_rate: Number(disc) / 100,
        life_months: Number(life) || 60, demand: Number(demand) || 1, samples: 500,
      })
      setR(out)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка расчёта') }
    finally { setRunning(false) }
  }

  const load = loads.find((l) => l.typeId === wct)
  const paysBack = r && r.payback_months > 0
  return (
    <>
      <div className="an__panel">
        <p className="an__panel-t">Оценка докупки оборудования</p>
        <p className="an__muted" style={{ margin: '0 0 10px' }}>
          Узкое место → докупаем N станков → прирост выпуска сбывается по рыночной модели
          (ёмкость − конкуренты, цена падает по эластичности) → окупаемость. Прирост
          валиден, пока тип остаётся ограничением; дальше упирается в следующий ресурс.
        </p>
        <div className="an__form">
          <label className="an__fld"><span>Тип оборудования</span>
            <select className="an__select" value={wct} onChange={(e) => setWct(e.target.value)}>
              {wcTypes.map((t) => {
                const l = loads.find((x) => x.typeId === t.id)
                return <option key={t.id} value={t.id}>{t.name}{l ? ` · загрузка ${pct(l.utilization)}` : ''}</option>
              })}
            </select>
          </label>
          <label className="an__fld"><span>Докупить, шт</span>
            <input className="an__input" type="number" min="1" max="50" value={addN} onChange={(e) => setAddN(e.target.value)} /></label>
          <label className="an__fld"><span>Цена станка, ₽</span>
            <input className="an__input" type="number" min="0" step="100000" value={capex} onChange={(e) => setCapex(e.target.value)} /></label>
          <label className="an__fld"><span>Ставка дисконта, %/год</span>
            <input className="an__input" type="number" min="0" step="1" value={disc} onChange={(e) => setDisc(e.target.value)} /></label>
          <label className="an__fld"><span>Срок службы, мес</span>
            <input className="an__input" type="number" min="1" step="12" value={life} onChange={(e) => setLife(e.target.value)} /></label>
          <label className="an__fld"><span>Множитель спроса</span>
            <input className="an__input" type="number" min="0.1" step="0.5" value={demand} onChange={(e) => setDemand(e.target.value)}
                   title="Сценарный множитель годового спроса (стресс рынка)" /></label>
        </div>
        {load && <p className="an__muted" style={{ margin: '8px 0 0' }}>
          Сейчас «{load.name}»: {load.machines} станк., загрузка <b>{pct(load.utilization)}</b>
          {load.laborBound && <> — но операторов лишь {load.operators}, докупка станков без операторов не поможет</>}.
        </p>}
        {err && <div className="an__err">{err}</div>}
        <button className="btn btn--primary" style={{ marginTop: 10, height: 30 }} onClick={run} disabled={running}>
          {running ? 'Считаем (2 прогона оптимизатора)…' : 'Рассчитать инвестпроект'}
        </button>
      </div>

      {r && (
        <div className="an__panel">
          <p className="an__panel-t">Результат: {nameOfType(r.wc_type_id)} +{r.add_machines} станк.</p>
          <div className={`an__verdict ${paysBack ? 'an__verdict--ok' : 'an__verdict--bad'}`}>
            {paysBack
              ? <>Окупается за <b>{r.payback_months.toFixed(1)} мес</b> · NPV <b>{rubM(r.npv)}</b> · IRR <b>{Math.round(r.irr_annual * 100)}%/год</b></>
              : <>Не окупается — прирост прибыли ≈ 0 (тип не является ограничением при этом спросе)</>}
          </div>
          <div className="an__kpis" style={{ marginTop: 10 }}>
            <div className="an__kpi"><div className="an__kpi-k">CAPEX</div><div className="an__kpi-v">{rubM(r.capex)}</div><div className="an__kpi-f">{r.add_machines} × цена станка</div></div>
            <div className="an__kpi"><div className="an__kpi-k">Прирост прибыли</div><div className="an__kpi-v">{rubM(r.delta_cf_month)}<small>/мес</small></div><div className="an__kpi-f">через рынок + мощность</div></div>
            <div className="an__kpi"><div className="an__kpi-k">Окупаемость</div><div className="an__kpi-v">{paysBack ? `${r.payback_months.toFixed(1)}` : '—'}<small> мес</small></div><div className="an__kpi-f">CAPEX / ΔCF</div></div>
            <div className="an__kpi"><div className="an__kpi-k">NPV ({r.life_months} мес)</div><div className="an__kpi-v" style={{ color: r.npv >= 0 ? 'var(--intent-success)' : 'var(--intent-danger)' }}>{rubM(r.npv)}</div><div className="an__kpi-f">ставка {Math.round(r.discount_annual * 100)}%/год</div></div>
            <div className="an__kpi"><div className="an__kpi-k">IRR</div><div className="an__kpi-v">{paysBack ? `${Math.round(r.irr_annual * 100)}` : '—'}<small> %/год</small></div><div className="an__kpi-f">NPV = 0</div></div>
            <div className="an__kpi"><div className="an__kpi-k">ROI за срок</div><div className="an__kpi-v">{Math.round(r.roi * 100)}<small> %</small></div><div className="an__kpi-f">за {r.life_months} мес</div></div>
          </div>
          <div className="an__after">
            <span>Загрузка типа: <b>{pct(r.util_before)} → {pct(r.util_after)}</b></span>
            {r.next_bottleneck.wc_name && (
              <span>Ограничение перейдёт к: <b>{r.next_bottleneck.wc_name}</b> ({pct(r.next_bottleneck.utilization)})
                {r.next_bottleneck.utilization > 0.9 && ' — следующий кандидат на инвестицию'}</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ── Потоки: Sankey тип→тип из ленты плана ─────────────────────────────────── */
function FlowTab({ plan, machines, nameOfType }: {
  plan: SimPlan | null; machines: Machine[]; nameOfType: (id: string) => string
}) {
  const sankey = useMemo(() => {
    if (!plan?.tasks?.length) return null
    const mType = new Map(machines.map((m) => [m.id, m.wc_type_id]))
    // Поток: последовательные операции заказа → ребро тип_a → тип_b.
    const byOrder = new Map<number, typeof plan.tasks>()
    for (const t of plan.tasks) {
      if (!byOrder.has(t.order_idx)) byOrder.set(t.order_idx, [])
      byOrder.get(t.order_idx)!.push(t)
    }
    const flow = new Map<string, number>()   // "a→b" → count
    const stageSum = new Map<string, { s: number; n: number }>()  // тип → сумма старта (для порядка стадий)
    byOrder.forEach((arr) => {
      arr.sort((a, b) => a.start - b.start)
      for (const t of arr) {
        const ty = mType.get(t.machine_id); if (!ty) continue
        const ss = stageSum.get(ty) ?? { s: 0, n: 0 }; ss.s += t.start; ss.n++; stageSum.set(ty, ss)
      }
      for (let i = 0; i + 1 < arr.length; i++) {
        const a = mType.get(arr[i].machine_id), b = mType.get(arr[i + 1].machine_id)
        if (!a || !b || a === b) continue
        const k = `${a}→${b}`; flow.set(k, (flow.get(k) ?? 0) + 1)
      }
    })
    const types = [...stageSum.keys()].sort((a, b) =>
      (stageSum.get(a)!.s / stageSum.get(a)!.n) - (stageSum.get(b)!.s / stageSum.get(b)!.n))
    const links = [...flow.entries()].map(([k, v]) => ({ from: k.split('→')[0], to: k.split('→')[1], v }))
    return { types, links }
  }, [plan, machines])

  if (!sankey || sankey.types.length < 2) return <p className="an__muted">Недостаточно данных для диаграммы потоков.</p>

  // Простой Sankey: типы — столбцами по стадии, толщина связи ∝ числу партий.
  const W = 900, rowH = 46, pad = 12
  const H = sankey.types.length * rowH + pad * 2
  const yOf = (t: string) => pad + sankey.types.indexOf(t) * rowH + rowH / 2
  const maxV = Math.max(1, ...sankey.links.map((l) => l.v))
  const nodeX = 190, curveX = 660
  return (
    <div className="an__panel">
      <p className="an__panel-t">Материальный поток между типами РЦ (Sankey)</p>
      <p className="an__muted" style={{ margin: '0 0 6px' }}>Толщина ленты ∝ числу партий, перетекающих между переделами.</p>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 620 }}>
          {sankey.links.map((l, i) => {
            const y1 = yOf(l.from), y2 = yOf(l.to)
            const sw = 1.5 + (l.v / maxV) * 16
            return (
              <path key={i} d={`M ${nodeX} ${y1} C ${(nodeX + curveX) / 2} ${y1}, ${(nodeX + curveX) / 2} ${y2}, ${curveX} ${y2}`}
                fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={sw} />
            )
          })}
          {sankey.types.map((t) => {
            const y = yOf(t)
            return (
              <g key={t}>
                <text x={nodeX - 8} y={y + 4} textAnchor="end" fontSize={12} fill="var(--text)">{nameOfType(t)}</text>
                <circle cx={nodeX} cy={y} r={5} fill="var(--accent)" />
                <circle cx={curveX} cy={y} r={5} fill="var(--accent)" />
                <text x={curveX + 8} y={y + 4} fontSize={12} fill="var(--text-muted)">{nameOfType(t)}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
