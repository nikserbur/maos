import { useEffect, useState } from 'react'
import { api, type PriceScenario, type OptResult, type ProductionPlan, type Product, type ScenarioPayload } from '../../lib/api'
import './scenario-compare.css'

const money = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

const OBJECTIVES: Record<string, string> = {
  cvar: 'CVaR (хвостовой риск)',
  worstcase: 'Худший случай',
  meanvariance: 'Среднее–дисперсия',
  minregret: 'Мин. сожаление',
}

interface Row {
  label: string
  get: (r: OptResult) => number
  fmt: (v: number) => string
  better: 'high' | 'low'
}

const ROWS: Row[] = [
  { label: 'Ожид. прибыль (робастный)', get: (r) => r.robust.metrics.expected, fmt: money, better: 'high' },
  { label: 'Ожид. прибыль (жадный)',   get: (r) => r.expected.metrics.expected, fmt: money, better: 'high' },
  { label: 'CVaR (худшие α)',          get: (r) => r.robust.metrics.cvar, fmt: money, better: 'high' },
  { label: 'Худший случай',            get: (r) => r.robust.metrics.worst_case, fmt: money, better: 'high' },
  { label: 'Вероятность убытка',       get: (r) => r.robust.metrics.p_loss, fmt: pct, better: 'low' },
  { label: 'Цена робастности',         get: (r) => r.price_of_robustness, fmt: money, better: 'low' },
  { label: 'Эфф. число изделий',       get: (r) => r.robust.diversification.effective_n, fmt: (v) => v.toFixed(1), better: 'high' },
  { label: 'Концентрация (HHI)',       get: (r) => r.robust.diversification.concentration, fmt: pct, better: 'low' },
]

export function ScenarioCompareScreen() {
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [plans, setPlans]         = useState<ProductionPlan[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [sel, setSel]             = useState<string[]>([])
  const [results, setResults]     = useState<Record<string, OptResult>>({})
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Грузим полные сценарии (с оверрайдами), а также планы и изделия для редактора.
  const load = async () => {
    const list = await api.scenarios.list().catch(() => [] as PriceScenario[])
    const full = await Promise.all(list.map((s) => api.scenarios.get(s.id).catch(() => s)))
    setScenarios(full)
  }
  useEffect(() => {
    load()
    api.plans.list().then(setPlans).catch(() => {})
    api.products.list().then((ps) => setProducts(ps.filter((p) => p.sellable === '1' || p.purchased === '1'))).catch(() => {})
  }, [])

  const toggle = (id: string) =>
    setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : [s[1], id])

  // Полный payload сценария + точечные изменения (overrides шлём только когда явно меняем).
  const payloadOf = (sc: PriceScenario, extra: Partial<ScenarioPayload>): ScenarioPayload => ({
    name: sc.name, description: sc.description,
    horizon_hours: Number(sc.horizon_hours) || 720,
    market_corr: Number(sc.market_corr) || 0.5,
    objective: sc.objective || 'cvar',
    alpha: Number(sc.alpha) || 0.1,
    max_share: Number(sc.max_share) || 0.6,
    mode: sc.mode || 'stochastic',
    plan_id: sc.plan_id || '', start_date: sc.start_date || '', end_date: sc.end_date || '',
    ...extra,
  })

  const patch = async (sc: PriceScenario, p: Partial<PriceScenario>) => {
    const next = { ...sc, ...p }
    setScenarios((list) => list.map((x) => x.id === sc.id ? next : x))
    await api.scenarios.update(sc.id, payloadOf(next, {})).catch(() => {})
  }

  const setOverride = async (sc: PriceScenario, productId: string, price: string) => {
    if (!productId) return
    const overrides = [...(sc.overrides ?? []).filter((o) => o.product_id !== productId),
      ...(price ? [{ product_id: productId, base_price: price }] : [])]
    const next = { ...sc, overrides }
    setScenarios((list) => list.map((x) => x.id === sc.id ? next : x))
    await api.scenarios.update(sc.id, payloadOf(next, { overrides })).catch(() => {})
  }
  const clearOverrides = async (sc: PriceScenario) => {
    const next = { ...sc, overrides: [] }
    setScenarios((list) => list.map((x) => x.id === sc.id ? next : x))
    await api.scenarios.update(sc.id, payloadOf(next, { overrides: [] })).catch(() => {})
  }

  const clone = async (id: string) => { await api.scenarios.clone(id).catch(() => {}); load() }
  const remove = async (id: string) => {
    await api.scenarios.delete(id).catch(() => {})
    setSel((s) => s.filter((x) => x !== id)); load()
  }

  const compare = async () => {
    if (sel.length < 2) return
    setBusy(true); setError(null)
    try {
      const out: Record<string, OptResult> = {}
      for (const id of sel) out[id] = await api.optimize.run({ scenario_id: id })
      setResults(out)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка оптимизации') }
    finally { setBusy(false) }
  }

  const cols = sel.map((id) => ({ id, sc: scenarios.find((s) => s.id === id), r: results[id] })).filter((c) => c.sc)
  const ready = cols.length === 2 && cols.every((c) => c.r)

  return (
    <div className="scen">
      <header className="scen__head">
        <div>
          <h1 className="scen__title">Сценарии — сравнение</h1>
          <p className="scen__desc">
            Единый сценарий = цены (распределения) + цель оптимизации. Клонируйте, меняйте цель,
            выберите два и сравните робастный портфель бок о бок.
          </p>
        </div>
      </header>

      <section className="scen__list">
        {scenarios.map((sc) => (
          <div key={sc.id} className={`scen__row${sel.includes(sc.id) ? ' scen__row--sel' : ''}`}>
            <label className="scen__pick">
              <input type="checkbox" checked={sel.includes(sc.id)} onChange={() => toggle(sc.id)} />
              <span className="scen__name">{sc.name}</span>
            </label>
            <div className="scen__params">
              <label>Цель
                <select value={sc.objective || 'cvar'} onChange={(e) => patch(sc, { objective: e.target.value })}>
                  {Object.entries(OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>α
                <input type="number" step={0.05} min={0.01} max={0.5} value={sc.alpha ?? '0.1'}
                       onChange={(e) => patch(sc, { alpha: e.target.value })} />
              </label>
              <label>Макс. доля
                <input type="number" step={0.05} min={0.1} max={1} value={sc.max_share ?? '0.6'}
                       onChange={(e) => patch(sc, { max_share: e.target.value })} />
              </label>
              <label>Корр.
                <input type="number" step={0.05} min={0} max={1} value={sc.market_corr ?? '0.5'}
                       onChange={(e) => patch(sc, { market_corr: e.target.value })} />
              </label>
              <label>Режим
                <select value={sc.mode || 'stochastic'} onChange={(e) => patch(sc, { mode: e.target.value })}>
                  <option value="stochastic">стохаст.</option>
                  <option value="deterministic">детерм.</option>
                </select>
              </label>
              <label>План (Стадия 1)
                <select value={sc.plan_id || ''} onChange={(e) => patch(sc, { plan_id: e.target.value })}>
                  <option value="">— нет —</option>
                  {plans.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                </select>
              </label>
              <label>С
                <input type="date" value={sc.start_date || ''} onChange={(e) => patch(sc, { start_date: e.target.value })} />
              </label>
              <label>По
                <input type="date" value={sc.end_date || ''} onChange={(e) => patch(sc, { end_date: e.target.value })} />
              </label>
            </div>
            <OverrideEditor sc={sc} products={products}
              onSet={(pid, price) => setOverride(sc, pid, price)} onClear={() => clearOverrides(sc)} />
            <div className="scen__actions">
              <button className="btn" onClick={() => clone(sc.id)}>Клонировать</button>
              <button className="btn" onClick={() => remove(sc.id)}>Удалить</button>
            </div>
          </div>
        ))}
        {!scenarios.length && <p className="scen__empty">Сценариев нет. Создайте на экране «Сценарии».</p>}
      </section>

      <div className="scen__bar">
        <button className="btn btn--primary" disabled={sel.length !== 2 || busy} onClick={compare}>
          {busy ? 'Оптимизируем…' : `Сравнить (${sel.length}/2)`}
        </button>
        {error && <span className="scen__err">{error}</span>}
      </div>

      {ready && (
        <table className="scen__cmp">
          <thead>
            <tr>
              <th>Показатель</th>
              {cols.map((c) => <th key={c.id}>{c.sc!.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const vals = cols.map((c) => row.get(c.r!))
              const best = row.better === 'high' ? Math.max(...vals) : Math.min(...vals)
              return (
                <tr key={row.label}>
                  <td className="scen__metric">{row.label}</td>
                  {cols.map((c, i) => (
                    <td key={c.id} className={vals[i] === best && vals[0] !== vals[1] ? 'scen__best' : ''}>
                      {row.fmt(vals[i])}
                    </td>
                  ))}
                </tr>
              )
            })}
            <tr>
              <td className="scen__metric">Топ-изделия (вклад)</td>
              {cols.map((c) => (
                <td key={c.id} className="scen__top">
                  {[...c.r!.robust.items].sort((a, b) => b.contribution - a.contribution).slice(0, 3)
                    .map((it) => <div key={it.product_id}>{it.product_id}: {money(it.contribution)}</div>)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Точечные оверрайды цены изделий в сценарии (без копии всего сценария). */
function OverrideEditor({ sc, products, onSet, onClear }: {
  sc: PriceScenario
  products: Product[]
  onSet: (productId: string, price: string) => void
  onClear: () => void
}) {
  const [pid, setPid] = useState('')
  const [price, setPrice] = useState('')
  const ovr = sc.overrides ?? []
  return (
    <div className="scen__ovr">
      <span className="scen__ovr-label">Оверрайды цены: {ovr.length}</span>
      <select value={pid} onChange={(e) => setPid(e.target.value)}>
        <option value="">— изделие —</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
      </select>
      <input type="number" placeholder="новая цена" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button className="btn" disabled={!pid || !price} onClick={() => { onSet(pid, price); setPid(''); setPrice('') }}>＋ оверрайд</button>
      {ovr.length > 0 && <button className="btn" onClick={onClear}>сбросить</button>}
      {ovr.map((o) => <span key={o.product_id} className="scen__ovr-chip">{o.product_id} = {o.base_price ?? o.base_cost}</span>)}
    </div>
  )
}
