import { useEffect, useState, type ReactNode } from 'react'
import { api, type PriceScenario, type OptResult, type ProductionPlan, type Product, type ScenarioPayload } from '../../lib/api'
import { ForecastScreen } from '../forecast/ForecastScreen'
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
  const [openId, setOpenId]       = useState('')   // выбранный сценарий (детальный вид)
  const [compareMode, setCompareMode] = useState(false)

  // Авто-выбор первого сценария для детального вида.
  useEffect(() => {
    if (!openId && scenarios.length) setOpenId(scenarios[0].id)
  }, [scenarios, openId])

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
    inflation: Number(sc.inflation) || 0, fx: Number(sc.fx) || 1, demand: Number(sc.demand) || 1,
    volatility: Number(sc.volatility) || 0.05, months: Number(sc.months) || 6,
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
  const createScenario = async () => {
    const name = window.prompt('Название нового сценария:', 'Новый сценарий')
    if (!name) return
    const sc = await api.scenarios.create({ name }).catch(() => null)
    await load()
    if (sc && sc.id) setOpenId(sc.id)   // сразу раскрываем для задания внешних условий
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

  const selected = scenarios.find((s) => s.id === openId) ?? null

  return (
    <div className="scn">
      <aside className="scn__side">
        <div className="scn__side-top">
          <span className="scn__side-title">Сценарии</span>
          <button className="btn btn--primary scn__new" title="Создать сценарий" onClick={createScenario}>＋</button>
        </div>
        <button className={`scn__cmpbtn${compareMode ? ' scn__cmpbtn--on' : ''}`}
                onClick={() => { setCompareMode((m) => !m); setSel([]) }}>
          ⇄ Сравнить сценарии
        </button>
        <div className="scn__list">
          {scenarios.map((sc) => {
            const active = compareMode ? sel.includes(sc.id) : sc.id === openId
            return (
              <button key={sc.id} className={`scn__item${active ? ' scn__item--active' : ''}`}
                      onClick={() => (compareMode ? toggle(sc.id) : setOpenId(sc.id))}>
                {compareMode && <span className={`scn__check${sel.includes(sc.id) ? ' scn__check--on' : ''}`}>{sel.includes(sc.id) ? '✓' : ''}</span>}
                <span className="scn__item-main">
                  <span className="scn__item-name">{sc.name}</span>
                  <span className="scn__item-sub">{(OBJECTIVES[sc.objective || 'cvar'] || '').split(' ')[0]} · {sc.mode === 'deterministic' ? 'детерм.' : 'стох.'}</span>
                </span>
              </button>
            )
          })}
          {!scenarios.length && <p className="scn__empty">Нет сценариев.<br />«＋» — создать.</p>}
        </div>
      </aside>

      <main className="scn__main">
        {compareMode ? (
          <div className="scn__compare">
            <div className="scn__compare-head">
              <h2 className="scn__h">Сравнение сценариев</h2>
              <button className="btn btn--primary" disabled={sel.length !== 2 || busy} onClick={compare}>
                {busy ? 'Оптимизируем…' : `Сравнить выбранные (${sel.length}/2)`}
              </button>
            </div>
            <p className="scn__hint">Отметьте слева <b>два</b> сценария и нажмите «Сравнить» — прогон робастной оптимизации для каждого, метрики бок о бок.</p>
            {error && <div className="scn__err">{error}</div>}
            {ready && <CompareTable cols={cols} />}
          </div>
        ) : selected ? (
          <ScenarioDetail key={selected.id} sc={selected} plans={plans} products={products}
            onPatch={patch} onSetOverride={setOverride} onClearOverrides={clearOverrides}
            onClone={() => clone(selected.id)} onRemove={() => { remove(selected.id); setOpenId('') }} />
        ) : (
          <div className="scn__placeholder">Выберите сценарий слева или создайте новый («＋»).</div>
        )}
      </main>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="scn__field">
      <span className="scn__field-l">{label}{hint && <i className="scn__field-h"> {hint}</i>}</span>
      {children}
    </label>
  )
}

/** Детальный вид сценария: красивые контролы внешних условий + графики цен. */
function ScenarioDetail({ sc, plans, products, onPatch, onSetOverride, onClearOverrides, onClone, onRemove }: {
  sc: PriceScenario; plans: ProductionPlan[]; products: Product[]
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
  onSetOverride: (sc: PriceScenario, pid: string, price: string) => void
  onClearOverrides: (sc: PriceScenario) => void
  onClone: () => void; onRemove: () => void
}) {
  return (
    <div className="scn__detail">
      <div className="scn__detail-head">
        <input className="scn__name-input" value={sc.name} onChange={(e) => onPatch(sc, { name: e.target.value })} />
        <div className="scn__detail-actions">
          <button className="btn" onClick={onClone}>Клонировать</button>
          <button className="btn" onClick={onRemove}>Удалить</button>
        </div>
      </div>

      <div className="scn__cards">
        <section className="scn__card">
          <h3 className="scn__card-h">Внешние условия (рынок)</h3>
          <div className="scn__grid">
            <Field label="Инфляция" hint="%/мес">
              <input type="number" step={0.1} value={(Number(sc.inflation) || 0) * 100}
                     onChange={(e) => onPatch(sc, { inflation: String((Number(e.target.value) || 0) / 100) })} />
            </Field>
            <Field label="Курс" hint="×"><input type="number" step={0.05} value={sc.fx ?? '1'} onChange={(e) => onPatch(sc, { fx: e.target.value })} /></Field>
            <Field label="Спрос" hint="×"><input type="number" step={0.05} value={sc.demand ?? '1'} onChange={(e) => onPatch(sc, { demand: e.target.value })} /></Field>
            <Field label="Волатильность" hint="%/мес">
              <input type="number" step={0.5} value={(Number(sc.volatility) || 0.05) * 100}
                     onChange={(e) => onPatch(sc, { volatility: String((Number(e.target.value) || 0) / 100) })} />
            </Field>
            <Field label="Корреляция рынка"><input type="number" step={0.05} min={0} max={1} value={sc.market_corr ?? '0.5'} onChange={(e) => onPatch(sc, { market_corr: e.target.value })} /></Field>
            <Field label="Горизонт" hint="мес"><input type="number" min={1} max={36} value={sc.months ?? '6'} onChange={(e) => onPatch(sc, { months: e.target.value })} /></Field>
          </div>
        </section>

        <section className="scn__card">
          <h3 className="scn__card-h">Цель оптимизации</h3>
          <div className="scn__grid">
            <Field label="Цель"><select value={sc.objective || 'cvar'} onChange={(e) => onPatch(sc, { objective: e.target.value })}>{Object.entries(OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="α" hint="хвост CVaR"><input type="number" step={0.05} min={0.01} max={0.5} value={sc.alpha ?? '0.1'} onChange={(e) => onPatch(sc, { alpha: e.target.value })} /></Field>
            <Field label="Макс. доля изделия"><input type="number" step={0.05} min={0.1} max={1} value={sc.max_share ?? '0.6'} onChange={(e) => onPatch(sc, { max_share: e.target.value })} /></Field>
            <Field label="Режим"><select value={sc.mode || 'stochastic'} onChange={(e) => onPatch(sc, { mode: e.target.value })}><option value="stochastic">стохастический</option><option value="deterministic">детерминированный</option></select></Field>
          </div>
        </section>

        <section className="scn__card">
          <h3 className="scn__card-h">Период и план (Стадия 1)</h3>
          <div className="scn__grid">
            <Field label="План производства"><select value={sc.plan_id || ''} onChange={(e) => onPatch(sc, { plan_id: e.target.value })}><option value="">— нет —</option>{plans.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</select></Field>
            <Field label="Период с"><input type="date" value={sc.start_date || ''} onChange={(e) => onPatch(sc, { start_date: e.target.value })} /></Field>
            <Field label="по"><input type="date" value={sc.end_date || ''} onChange={(e) => onPatch(sc, { end_date: e.target.value })} /></Field>
          </div>
        </section>

        <section className="scn__card">
          <h3 className="scn__card-h">Точечные оверрайды цен</h3>
          <OverrideEditor sc={sc} products={products} onSet={(pid, price) => onSetOverride(sc, pid, price)} onClear={() => onClearOverrides(sc)} />
        </section>
      </div>

      <section className="scn__card scn__card--chart">
        <h3 className="scn__card-h">Прогноз цен по сценарию</h3>
        <ForecastScreen scenarioId={sc.id} />
      </section>
    </div>
  )
}

/** Таблица сравнения двух сценариев (метрики бок о бок, подсветка лучшего). */
function CompareTable({ cols }: { cols: { id: string; sc?: PriceScenario; r?: OptResult }[] }) {
  return (
    <table className="scen__cmp">
      <thead><tr><th>Показатель</th>{cols.map((c) => <th key={c.id}>{c.sc!.name}</th>)}</tr></thead>
      <tbody>
        {ROWS.map((row) => {
          const vals = cols.map((c) => row.get(c.r!))
          const best = row.better === 'high' ? Math.max(...vals) : Math.min(...vals)
          return (
            <tr key={row.label}>
              <td className="scen__metric">{row.label}</td>
              {cols.map((c, i) => <td key={c.id} className={vals[i] === best && vals[0] !== vals[1] ? 'scen__best' : ''}>{row.fmt(vals[i])}</td>)}
            </tr>
          )
        })}
        <tr>
          <td className="scen__metric">Топ-изделия (вклад)</td>
          {cols.map((c) => <td key={c.id} className="scen__top">{[...c.r!.robust.items].sort((a, b) => b.contribution - a.contribution).slice(0, 3).map((it) => <div key={it.product_id}>{it.product_id}: {money(it.contribution)}</div>)}</td>)}
        </tr>
      </tbody>
    </table>
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
