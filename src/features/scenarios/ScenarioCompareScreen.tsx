import { useEffect, useState } from 'react'
import { api, type PriceScenario, type OptResult } from '../../lib/api'
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
  const [sel, setSel]             = useState<string[]>([])
  const [results, setResults]     = useState<Record<string, OptResult>>({})
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const load = () => api.scenarios.list().then(setScenarios).catch(() => {})
  useEffect(() => { load() }, [])

  const toggle = (id: string) =>
    setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : [s[1], id])

  const patch = async (sc: PriceScenario, p: Partial<PriceScenario>) => {
    const next = { ...sc, ...p }
    setScenarios((list) => list.map((x) => x.id === sc.id ? next : x))
    await api.scenarios.update(sc.id, {
      name: next.name, description: next.description,
      horizon_hours: Number(next.horizon_hours) || 720,
      market_corr: Number(next.market_corr) || 0.5,
      objective: next.objective || 'cvar',
      alpha: Number(next.alpha) || 0.1,
      max_share: Number(next.max_share) || 0.6,
    }).catch(() => {})
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
            </div>
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
