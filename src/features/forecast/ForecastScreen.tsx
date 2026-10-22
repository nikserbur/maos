/**
 * Мониторинг [7] (`#/monitoring`): внешние условия и прогноз цен — веера на chart-системе
 * (`FanChart`: история → сейчас → P10–P90 + медиана + тренд), одна общая легенда над сеткой
 * малых кратных, качество подбора/бэктеста строкой под заголовком карточки, детальные значения
 * и настройка цены — в `ForecastZoom`. Все числа — через src/explain/format.ts.
 */
import { useEffect, useState, useCallback } from 'react'
import { api, type ForecastResult, type ForecastProduct, type ForecastFit, type PriceScenario, type PriceDistribution } from '../../lib/api'
import { ScreenHeader } from '../../ui/kit'
import { FanChart, type FanQuality } from '../../ui/FanChart'
import { Legend, fanLegend } from '../../ui/charts'
import { Icon } from '../../shell/icons'
import { money, num, pct, signed } from '../../explain/format'
import { ForecastZoom } from './ForecastZoom'
import './forecast.css'

/** Подпись подобранного распределения; у ставки (MacroSampler) AIC-полей нет — только n_obs. */
export function fitLabel(fit: ForecastFit): string {
  switch (fit.dist) {
    case 'stable': return `◆ α-stable (α=${num(fit.alpha ?? 2, 2)}, тяж. хвосты)`
    case 't': return `◆ t-Стьюдент (ν=${num(fit.nu ?? 0, 0)}, тяж. хвосты)`
    case 'laplace': return '◆ Лаплас (тяж. хвосты)'
    case 'normal': return '○ нормаль'
    default: return `◆ ${String(fit.dist)}`
  }
}

/** Подсказка с AIC по тем распределениям, для которых он посчитан (`fit?.aic_*` может отсутствовать). */
export function aicTitle(fit: ForecastFit): string | undefined {
  const parts = [
    ['нормаль', fit.aic_normal], ['Лаплас', fit.aic_laplace], ['t', fit.aic_t], ['α-stable', fit.aic_stable],
  ].filter((x): x is [string, number] => typeof x[1] === 'number' && Number.isFinite(x[1]))
  return parts.length ? `AIC: ${parts.map(([n, v]) => `${n} ${num(v, 1)}`).join(' · ')}` : undefined
}

/** Качество прогноза из бэктеста (skill < 1 — лучше наивного). */
export function qualityOf(p: ForecastProduct): FanQuality {
  const b = p.backtest
  if (!b) return { status: 'none' }
  return {
    skill: 1 - b.skill, coverage80: b.coverage80, backtestK: b.k,
    crps: (b.pinball10 + b.pinball90) / 2, crpsLabel: 'прокси CRPS',
    status: b.skill < 1 ? 'ok' : 'warn',
  }
}

/** Форматтер значений: ставка — проценты (значения уже в %), цены — рубли. */
export const fmtFor = (p: ForecastProduct) => (p.role === 'rate' ? (v: number) => pct(v / 100, 1) : (v: number) => money(v))

export function ForecastScreen({ scenarioId: fixed, onOverride, onSetDist, distributions, refreshKey }:
  { scenarioId?: string
    onOverride?: (productId: string, price: string) => Promise<void> | void
    onSetDist?: (productId: string, patch: Partial<PriceDistribution>) => void
    distributions?: PriceDistribution[]
    refreshKey?: number } = {}) {
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
      ? { scenario_id: scenarioId, runs: 3000, backtest: 6 }
      : { months, inflation: inflation / 100, fx, demand, volatility: volatility / 100, corr, runs: 3000, backtest: 6 }
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
  useEffect(() => { run() }, [scenarioId, refreshKey])

  // Оверрайд цены прямо с графика → сохраняем в сценарий и пересчитываем веер.
  const applyOverride = useCallback(async (pid: string, price: string) => {
    await onOverride?.(pid, price)
    run()
  }, [onOverride, run])

  const products = res?.products ?? []
  const goods = products.filter((p) => p.role === 'product')
  const raws = products.filter((p) => p.role === 'raw')
  const cumInfl = res ? (res.inflation_index[res.inflation_index.length - 1] - 100) : 0
  const hasHistory = products.some((p) => (p.history?.length ?? 0) > 0)
  const hasTrend = products.some((p) => Boolean(p.trend))

  return (
    <div className={`forecast${loading && res ? ' is-refetching' : ''}`}>
      {!embedded && (
        <ScreenHeader
          eyebrow="Наблюдение · блок [7]"
          title="Мониторинг: внешние условия и прогноз цен"
          blocks={['monitoring', 'external']}
          subtitle="История → тренд (EMD) + гармоники + случайный остаток (распределение по AIC) → Монте-Карло с учётом макрофакторов. Веер — P10/P50/P90; кнопка «развернуть» на карточке — значения по месяцам и настройка цены."
          className="forecast__head"
        />
      )}

      {!embedded && <section className="forecast__controls" aria-label="Параметры прогноза">
        <label>Сценарий
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            <option value="">— ручные параметры —</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
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
      </section>}

      {error && <div className="forecast__error" role="alert"><span className="glyph-down" aria-hidden="true" /> {error}</div>}

      {res && (
        <p className="forecast__macro num">
          Накопленная инфляция за {res.months} мес: <b>{signed(cumInfl / 100, '%')}</b>
          {res.mode === 'deterministic' && <> · <b>режим: детерминированный (точечный)</b></>}
          {fx !== 1 && <> · курс ×{num(fx, 2)}</>}
          {demand !== 1 && <> · спрос ×{num(demand, 2)}</>}
          {' · '}индекс: {res.inflation_index.map((v) => num(v, 0)).join(' → ')}
        </p>
      )}

      {res && <Legend className="forecast__legend" items={fanLegend({ hasHistory, hasTrend })} />}

      {res?.rate && !embedded && (
        <>
          <h2 className="forecast__group text-caps">Внешнее условие — ключевая ставка (тот же движок)</h2>
          <div className="forecast__grid"><Card p={res.rate} onZoom={setZoom} /></div>
        </>
      )}

      {goods.length > 0 && <h2 className="forecast__group text-caps">Изделия (цены сбыта)</h2>}
      <div className="forecast__grid">
        {goods.map((p) => <Card key={p.id} p={p} onZoom={setZoom} />)}
      </div>

      {raws.length > 0 && <h2 className="forecast__group text-caps">Сырьё (закупочные цены)</h2>}
      <div className="forecast__grid">
        {raws.map((p) => <Card key={p.id} p={p} onZoom={setZoom} />)}
      </div>

      {zoom && <ForecastZoom p={zoom}
        onOverride={onOverride ? applyOverride : undefined}
        onSetDist={onSetDist} dist={distributions?.find((d) => d.product_id === zoom.id)}
        onClose={() => setZoom(null)} />}
    </div>
  )
}

/** Карточка-веер одного ряда: заголовок · дельта к горизонту · подбор распределения · качество. */
function Card({ p, onZoom }: { p: ForecastProduct; onZoom?: (p: ForecastProduct) => void }) {
  const last = p.p50.length - 1
  const delta = p.base > 0 ? (p.p50[last] - p.base) / p.base : 0
  const fmt = fmtFor(p)
  return (
    <div className="forecast__card">
      <FanChart
        a={p}
        fmt={fmt}
        quality={qualityOf(p)}
        title={p.name}
        showLegend={false}
        badges={<span className="forecast__delta num" title="Медиана к горизонту относительно базовой цены">{signed(delta, '%')}</span>}
      />
      <div className="forecast__card-foot">
        <span className="forecast__fit num" title={p.fit?.data_driven ? aicTitle(p.fit) : undefined}>
          {p.fit?.data_driven && <>
            {fitLabel(p.fit)}
            {Number.isFinite(p.fit.sigma) && <>{' · σ '}{pct(p.fit.sigma, 1)}/мес</>}
            {' · история '}{num(p.fit.n_obs, 0)}
          </>}
        </span>
        <span className="forecast__range num">
          через {last} мес: <b>{fmt(p.p50[last])}</b> ({fmt(p.p10[last])} – {fmt(p.p90[last])})
        </span>
        {onZoom && (
          <button type="button" className="btn btn--ghost btn--icon forecast__zoom" title="Развернуть: значения по месяцам, настройка цены" aria-label="Развернуть"
            onClick={() => onZoom(p)}>
            <Icon name="expand" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
