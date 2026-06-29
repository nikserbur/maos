import { useEffect, useState, useCallback } from 'react'
import { api, type ForecastResult, type ForecastProduct } from '../../lib/api'
import './forecast.css'

const W = 320, H = 150, PADL = 6, PADR = 6, PADT = 12, PADB = 20

/** Веер цены во времени: полоса P10–P90 + линия P50 + базовая пунктирная. */
function PriceFan({ p }: { p: ForecastProduct }) {
  const n = p.p50.length
  const lo = Math.min(...p.p10), hi = Math.max(...p.p90)
  const span = hi - lo || 1
  const x = (i: number) => PADL + (i / (n - 1)) * (W - PADL - PADR)
  const y = (v: number) => PADT + (1 - (v - lo) / span) * (H - PADT - PADB)
  const line = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const band = `${p.p90.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${[...p.p10].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => `${x(i)},${y(v)}`).join(' ')}`
  const fmt = (v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v).toString()
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="fan">
      {/* сетка по месяцам */}
      {Array.from({ length: n }, (_, i) => (
        <line key={i} x1={x(i)} y1={PADT} x2={x(i)} y2={H - PADB} stroke="var(--border, #2a2f37)" strokeWidth={0.5} />
      ))}
      <polygon points={band} fill="var(--accent, #2d72d2)" opacity={0.16} />
      <polyline points={line(p.p90)} fill="none" stroke="var(--accent, #2d72d2)" strokeWidth={1} opacity={0.5} strokeDasharray="3 2" />
      <polyline points={line(p.p10)} fill="none" stroke="var(--accent, #2d72d2)" strokeWidth={1} opacity={0.5} strokeDasharray="3 2" />
      <polyline points={line(p.p50)} fill="none" stroke="var(--accent, #2d72d2)" strokeWidth={2} />
      <line x1={x(0)} y1={y(p.base)} x2={x(n - 1)} y2={y(p.base)} stroke="var(--text-muted, #8a929c)" strokeWidth={0.8} strokeDasharray="2 3" />
      {/* подписи осей */}
      <text x={PADL} y={10} fontSize={9} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono, monospace)">{fmt(hi)}</text>
      <text x={PADL} y={H - PADB + 12} fontSize={9} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono, monospace)">{fmt(lo)}</text>
      <text x={x(n - 1)} y={H - 4} fontSize={9} fill="var(--text-muted,#8a929c)" textAnchor="end" fontFamily="var(--font-mono, monospace)">мес {n - 1}</text>
      <text x={x(0)} y={H - 4} fontSize={9} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono, monospace)">0</text>
    </svg>
  )
}

const money = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v)

export function ForecastScreen() {
  const [months, setMonths]     = useState(6)
  const [inflation, setInfl]    = useState(1.5)   // %/мес
  const [fx, setFx]             = useState(1.0)
  const [demand, setDemand]     = useState(1.0)
  const [volatility, setVol]    = useState(6)     // %/мес
  const [corr, setCorr]         = useState(0.5)
  const [res, setRes]           = useState<ForecastResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const run = useCallback(() => {
    setLoading(true); setError(null)
    api.forecast({ months, inflation: inflation / 100, fx, demand, volatility: volatility / 100, corr, runs: 3000 })
      .then(setRes)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка прогноза'))
      .finally(() => setLoading(false))
  }, [months, inflation, fx, demand, volatility, corr])

  useEffect(() => { run() }, [])  // первичный расчёт; дальше — кнопкой

  const products = res?.products ?? []
  const goods = products.filter((p) => p.role === 'product')
  const raws = products.filter((p) => p.role === 'raw')
  const cumInfl = res ? (res.inflation_index[res.inflation_index.length - 1] - 100) : 0

  return (
    <div className="forecast">
      <header className="forecast__head">
        <div>
          <h1 className="forecast__title">Внешние условия и прогноз цен</h1>
          <p className="forecast__desc">
            Цены изделий и сырья во времени под действием макрофакторов (инфляция, курс, спрос).
            μ/σ оцениваются из истории (ts_data), распределение шага подбирается по AIC
            (нормаль ↔ Лаплас с тяжёлыми хвостами); веер — P10/P50/P90.
          </p>
        </div>
      </header>

      <section className="forecast__controls">
        <label>Горизонт, мес
          <input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(36, Number(e.target.value) || 6)))} />
        </label>
        <label>Инфляция, %/мес
          <input type="number" step={0.1} value={inflation} onChange={(e) => setInfl(Number(e.target.value) || 0)} />
        </label>
        <label>Курс (×)
          <input type="number" step={0.05} value={fx} onChange={(e) => setFx(Number(e.target.value) || 1)} />
        </label>
        <label>Спрос (×)
          <input type="number" step={0.05} value={demand} onChange={(e) => setDemand(Number(e.target.value) || 1)} />
        </label>
        <label>Волатильность, %/мес
          <input type="number" step={0.5} value={volatility} onChange={(e) => setVol(Number(e.target.value) || 0)} />
        </label>
        <label>Корреляция рынка
          <input type="number" step={0.05} min={0} max={1} value={corr} onChange={(e) => setCorr(Math.max(0, Math.min(1, Number(e.target.value) || 0)))} />
        </label>
        <button className="btn btn--primary" onClick={run} disabled={loading}>
          {loading ? 'Считаем…' : 'Пересчитать прогноз'}
        </button>
      </section>

      {error && <div className="forecast__error">{error}</div>}

      {res && (
        <div className="forecast__macro mono">
          Накопленная инфляция за {res.months} мес: <b>+{cumInfl.toFixed(1)}%</b>
          {fx !== 1 && <> · курс ×{fx.toFixed(2)}</>}
          {demand !== 1 && <> · спрос ×{demand.toFixed(2)}</>}
          {' · '}индекс: {res.inflation_index.map((v) => v.toFixed(0)).join(' → ')}
        </div>
      )}

      {res?.rate && (
        <>
          <h2 className="forecast__group">Внешнее условие — ключевая ставка (тот же движок)</h2>
          <div className="forecast__grid"><Card p={res.rate} pct /></div>
        </>
      )}

      {goods.length > 0 && <h2 className="forecast__group">Изделия (цены сбыта)</h2>}
      <div className="forecast__grid">
        {goods.map((p) => <Card key={p.id} p={p} />)}
      </div>

      {raws.length > 0 && <h2 className="forecast__group">Сырьё (закупочные цены)</h2>}
      <div className="forecast__grid">
        {raws.map((p) => <Card key={p.id} p={p} />)}
      </div>
    </div>
  )
}

function Card({ p, pct }: { p: ForecastProduct; pct?: boolean }) {
  const last = p.p50.length - 1
  const delta = ((p.p50[last] - p.base) / p.base) * 100
  const fmtVal = (v: number) => (pct ? `${v.toFixed(1)}%` : money(v))
  return (
    <div className="forecast__card">
      <div className="forecast__card-head">
        <span className="forecast__name">{p.name}</span>
        <span className={`forecast__delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</span>
      </div>
      <PriceFan p={p} />
      {p.fit?.data_driven && (
        <div className="forecast__fit mono" title={`AIC: нормаль ${p.fit.aic_normal.toFixed(1)} · Лаплас ${p.fit.aic_laplace.toFixed(1)}`}>
          {p.fit.dist === 'laplace' ? '◆ Лаплас (тяж. хвосты)' : '○ нормаль'} · σ {(p.fit.sigma * 100).toFixed(1)}%/мес · история {p.fit.n_obs}
        </div>
      )}
      <div className="forecast__card-foot mono">
        через {last} мес: <b>{fmtVal(p.p50[last])}</b>
        <span className="forecast__range"> ({fmtVal(p.p10[last])} – {fmtVal(p.p90[last])})</span>
      </div>
    </div>
  )
}
