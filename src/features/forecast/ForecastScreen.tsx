import { useEffect, useState, useCallback } from 'react'
import { api, type ForecastResult, type ForecastProduct, type PriceScenario } from '../../lib/api'
import './forecast.css'

const W = 340, CH = 150, PADL = 6, PADR = 6, PADT = 12, PADB = 22

/** ИСТОРИЯ (факт) → «сейчас» → веер прогноза P10–P90 + медиана + линия ТРЕНДА. */
function PriceFan({ p }: { p: ForecastProduct }) {
  const hist = p.history ?? []
  const H = hist.length
  const N = p.p50.length - 1
  const fcStart = H > 0 ? H - 1 : 0           // прогноз стыкуется с концом истории
  const total = fcStart + N + 1
  const all = [...hist, ...p.p10, ...p.p90, ...(p.trend ?? [])]
  const lo = Math.min(...all), hi = Math.max(...all)
  const span = hi - lo || 1
  const X = (i: number) => PADL + (i / Math.max(1, total - 1)) * (W - PADL - PADR)
  const Y = (v: number) => PADT + (1 - (v - lo) / span) * (CH - PADT - PADB)
  const histLine = hist.map((v, i) => `${X(i)},${Y(v)}`).join(' ')
  const fc = (arr: number[]) => arr.map((v, f) => `${X(fcStart + f)},${Y(v)}`).join(' ')
  const band = `${p.p90.map((v, f) => `${X(fcStart + f)},${Y(v)}`).join(' ')} ${[...p.p10].map((v, f) => ({ v, f })).reverse().map(({ v, f }) => `${X(fcStart + f)},${Y(v)}`).join(' ')}`
  const fmt = (v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v).toFixed(v < 10 ? 1 : 0)
  const nowX = X(fcStart)
  return (
    <svg viewBox={`0 0 ${W} ${CH}`} width="100%" role="img" className="fan">
      <rect x={nowX} y={PADT} width={W - PADR - nowX} height={CH - PADT - PADB} fill="var(--accent,#2d72d2)" opacity={0.05} />
      <line x1={nowX} y1={PADT} x2={nowX} y2={CH - PADB} stroke="var(--text-muted,#8a929c)" strokeWidth={0.8} strokeDasharray="2 2" />
      {H > 0 && <polyline points={histLine} fill="none" stroke="var(--text,#e6e9ee)" strokeWidth={1.6} />}
      <polygon points={band} fill="var(--accent,#2d72d2)" opacity={0.16} />
      <polyline points={fc(p.p90)} fill="none" stroke="var(--accent,#2d72d2)" strokeWidth={0.8} opacity={0.5} strokeDasharray="3 2" />
      <polyline points={fc(p.p10)} fill="none" stroke="var(--accent,#2d72d2)" strokeWidth={0.8} opacity={0.5} strokeDasharray="3 2" />
      <polyline points={fc(p.p50)} fill="none" stroke="var(--accent,#2d72d2)" strokeWidth={2} />
      {p.trend && <polyline points={fc(p.trend)} fill="none" stroke="#caa83a" strokeWidth={1.4} strokeDasharray="4 3" />}
      <text x={PADL} y={10} fontSize={9} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono,monospace)">{fmt(hi)}</text>
      <text x={PADL} y={CH - PADB + 12} fontSize={9} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono,monospace)">{fmt(lo)}</text>
      {H > 0 && <text x={PADL} y={CH - 6} fontSize={8.5} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono,monospace)">−{H - 1}м</text>}
      <text x={nowX + 2} y={CH - 6} fontSize={8.5} fill="var(--text-muted,#8a929c)" fontFamily="var(--font-mono,monospace)">сейчас</text>
      <text x={W - PADR} y={CH - 6} fontSize={8.5} fill="var(--text-muted,#8a929c)" textAnchor="end" fontFamily="var(--font-mono,monospace)">+{N}м</text>
    </svg>
  )
}

const money = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v)

export function ForecastScreen({ scenarioId: fixed }: { scenarioId?: string } = {}) {
  const [months, setMonths]     = useState(6)
  const [inflation, setInfl]    = useState(1.5)   // %/мес
  const [fx, setFx]             = useState(1.0)
  const [demand, setDemand]     = useState(1.0)
  const [volatility, setVol]    = useState(6)     // %/мес
  const [corr, setCorr]         = useState(0.5)
  const [res, setRes]           = useState<ForecastResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [scenarioId, setScenarioId] = useState(fixed ?? '')
  const [zoom, setZoom] = useState<ForecastProduct | null>(null)
  const embedded = fixed !== undefined   // встроен в карточку сценария (без выпадашки)

  useEffect(() => { if (!embedded) api.scenarios.list().then(setScenarios).catch(() => {}) }, [embedded])
  useEffect(() => { if (fixed !== undefined) setScenarioId(fixed) }, [fixed])

  const run = useCallback(() => {
    setLoading(true); setError(null)
    // Со сценарием — его параметры рулят (Стадия E); иначе ручные ползунки.
    const params = scenarioId
      ? { scenario_id: scenarioId, runs: 3000 }
      : { months, inflation: inflation / 100, fx, demand, volatility: volatility / 100, corr, runs: 3000 }
    api.forecast(params)
      .then((r) => {
        setRes(r)
        if (scenarioId) {   // синхронизируем ползунки с тем, что задал сценарий
          setMonths(r.months); setInfl(r.inflation_monthly * 100); setFx(r.fx)
          setDemand(r.demand); setVol(r.volatility * 100); setCorr(r.corr)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка прогноза'))
      .finally(() => setLoading(false))
  }, [scenarioId, months, inflation, fx, demand, volatility, corr])

  // Пересчёт при смене сценария (и на старте); ручные ползунки — кнопкой.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [scenarioId])

  const products = res?.products ?? []
  const goods = products.filter((p) => p.role === 'product')
  const raws = products.filter((p) => p.role === 'raw')
  const cumInfl = res ? (res.inflation_index[res.inflation_index.length - 1] - 100) : 0

  return (
    <div className="forecast">
      {!embedded && <header className="forecast__head">
        <div>
          <h1 className="forecast__title">Внешние условия и прогноз цен</h1>
          <p className="forecast__desc">
            Методика (System Dynamics + EMD-разложение): история → <b>тренд</b> (остаток EMD,
            данные-адаптивный) + <b>гармоники</b> (доминирующие колебания) + <b>нерегулярный остаток</b>; к остатку
            подбирается распределение по AIC (нормаль/Лаплас/t/α-stable). Прогноз =
            тренд + продолжение колебаний + случайный остаток (Монте-Карло) с учётом
            макрофакторов. Веер — P10/P50/P90. «⛶» — детальные значения по месяцам.
          </p>
        </div>
      </header>}

      <section className="forecast__controls">
        {!embedded && <label>Сценарий
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            <option value="">— ручные параметры —</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>}
        {!embedded && <>
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
        </>}
        <button className="btn btn--primary" onClick={run} disabled={loading}>
          {loading ? 'Считаем…' : embedded ? 'Обновить графики по условиям' : 'Пересчитать прогноз'}
        </button>
      </section>

      {error && <div className="forecast__error">{error}</div>}

      {res && (
        <div className="forecast__macro mono">
          Накопленная инфляция за {res.months} мес: <b>+{cumInfl.toFixed(1)}%</b>
          {res.mode === 'deterministic' && <> · <b>режим: детерминированный (точечный)</b></>}
          {fx !== 1 && <> · курс ×{fx.toFixed(2)}</>}
          {demand !== 1 && <> · спрос ×{demand.toFixed(2)}</>}
          {' · '}индекс: {res.inflation_index.map((v) => v.toFixed(0)).join(' → ')}
        </div>
      )}

      {res && (
        <div className="forecast__legend mono">
          <span><i className="lg lg--hist" /> история (факт)</span>
          <span><i className="lg lg--band" /> веер P10–P90 (разброс по подобранному распределению)</span>
          <span><i className="lg lg--p50" /> медиана</span>
          <span><i className="lg lg--trend" /> тренд (детерм. дрейф)</span>
        </div>
      )}

      {res?.rate && (
        <>
          <h2 className="forecast__group">Внешнее условие — ключевая ставка (тот же движок)</h2>
          <div className="forecast__grid"><Card p={res.rate} pct onZoom={setZoom} /></div>
        </>
      )}

      {goods.length > 0 && <h2 className="forecast__group">Изделия (цены сбыта)</h2>}
      <div className="forecast__grid">
        {goods.map((p) => <Card key={p.id} p={p} onZoom={setZoom} />)}
      </div>

      {raws.length > 0 && <h2 className="forecast__group">Сырьё (закупочные цены)</h2>}
      <div className="forecast__grid">
        {raws.map((p) => <Card key={p.id} p={p} onZoom={setZoom} />)}
      </div>

      {zoom && <ZoomModal p={zoom} pct={zoom.role === 'rate'} onClose={() => setZoom(null)} />}
    </div>
  )
}

function Card({ p, pct, onZoom }: { p: ForecastProduct; pct?: boolean; onZoom?: (p: ForecastProduct) => void }) {
  const last = p.p50.length - 1
  const delta = ((p.p50[last] - p.base) / p.base) * 100
  const fmtVal = (v: number) => (pct ? `${v.toFixed(1)}%` : money(v))
  return (
    <div className="forecast__card">
      <div className="forecast__card-head">
        <span className="forecast__name">{p.name}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className={`forecast__delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</span>
          {onZoom && <button className="forecast__zoom" title="Увеличить · детальные значения" onClick={() => onZoom(p)}>⛶</button>}
        </span>
      </div>
      <PriceFan p={p} />
      {p.fit?.data_driven && (
        <div className="forecast__fit mono" title={`AIC: нормаль ${p.fit.aic_normal.toFixed(1)} · Лаплас ${p.fit.aic_laplace.toFixed(1)}${p.fit.aic_t != null ? ` · t ${p.fit.aic_t.toFixed(1)}` : ''}${p.fit.aic_stable != null ? ` · α-stable ${p.fit.aic_stable.toFixed(1)}` : ''}`}>
          {p.fit.dist === 'stable' ? `◆ α-stable (α=${(p.fit.alpha ?? 2).toFixed(2)}, тяж. хвосты)`
            : p.fit.dist === 't' ? `◆ t-Стьюдент (ν=${(p.fit.nu ?? 0).toFixed(0)}, тяж. хвосты)`
            : p.fit.dist === 'laplace' ? '◆ Лаплас (тяж. хвосты)' : '○ нормаль'}
          {' · σ '}{(p.fit.sigma * 100).toFixed(1)}%/мес · история {p.fit.n_obs}
        </div>
      )}
      <div className="forecast__card-foot mono">
        через {last} мес: <b>{fmtVal(p.p50[last])}</b>
        <span className="forecast__range"> ({fmtVal(p.p10[last])} – {fmtVal(p.p90[last])})</span>
      </div>
    </div>
  )
}

/** Увеличенный график + детальная таблица значений прогноза по месяцам. */
function ZoomModal({ p, pct, onClose }: { p: ForecastProduct; pct?: boolean; onClose: () => void }) {
  const fmtVal = (v: number) => (pct ? `${v.toFixed(2)}%` : money(v))
  const N = p.p50.length
  return (
    <div className="forecast__modal" onClick={onClose}>
      <div className="forecast__modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="forecast__modal-head">
          <b>{p.name} — прогноз по месяцам</b>
          <button className="btn" onClick={onClose}>✕ Закрыть</button>
        </div>
        <div className="forecast__modal-chart"><PriceFan p={p} /></div>
        <table className="forecast__vtable mono">
          <thead><tr><th>Мес</th><th>P10</th><th>Медиана (P50)</th><th>P90</th><th>Тренд</th></tr></thead>
          <tbody>
            {Array.from({ length: N }, (_, t) => (
              <tr key={t}>
                <td>+{t}</td>
                <td>{fmtVal(p.p10[t])}</td>
                <td><b>{fmtVal(p.p50[t])}</b></td>
                <td>{fmtVal(p.p90[t])}</td>
                <td className="forecast__vtrend">{p.trend ? fmtVal(p.trend[t]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
