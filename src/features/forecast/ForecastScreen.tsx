/**
 * «Мониторинг» (X2 «ответ сначала», конвейер Сценарий → Портфель → План → Мониторинг): вердикт одной
 * строкой; ≤ 5 показателей (заказы в срок, узкое место, кассовый разрыв частотой, ставка через N мес,
 * ряды хуже «как вчера»); исключения по важности (каждое ведёт в веер или «План»); веер ставки и
 * инфляция; топ-10 рядов по |Δ медианы| таблицей и ссылка «Все ряды → Сценарии › Прогноз».
 * Сценарий по умолчанию — сценарий последнего плана, иначе рабочий; в адресе `?sc=<id>&mode=manual`.
 * Ручные параметры «что если» — за раскрытием; открыв их, источник переключается на «ручные».
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForecastProduct } from '../../lib/api'
import { countText, dateTimeShort, num, pct, signed } from '../../explain/format'
import { useDecisionContext } from '../../shell/context'
import { useHashParams } from '../../shell/router'
import { Sparkline } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { RunProgress } from '../../ui/RunProgress'
import { Chip, ErrorBanner, ScreenHeader, Skeleton } from '../../ui/kit'
import { useCashStore } from '../finance/cashStore'
import { ensureRefs, useRefs } from '../method-map/useMethodMapState'
import { useOptStore } from '../optimization/optStore'
import { usePlanStore } from '../plan/planStore'
import { fromMacroMode, toMacroMode } from '../scenarios/regimeMenu'
import { effectiveScenario } from '../scenarios/scenarioDefaults'
import { ForecastFan, ForecastTable } from './ForecastGrid'
import { ForecastZoom } from './ForecastZoom'
import { FORECAST_BACKTEST, FORECAST_ETA_S, FORECAST_PHASES, FORECAST_RUNS, forecastDelta, verdictText } from './forecastModel'
import { forecastKey, publishForecast, useCachedForecast } from './forecastStore'
import { Exceptions, KpiStrip, ManualPanel, buildExceptions, conditionsText, manualFrom, type ManualParams, type PlanFacts } from './MonitorParts'
import './forecast.css'

const TOP_N = 10
const MANUAL_FIELDS = 6
const SERIES = ['ряд', 'ряда', 'рядов'] as const

/** Факты последнего плана и кассы для полосы показателей и исключений. */
function usePlanFacts(): PlanFacts {
  const plan = usePlanStore()
  const cash = useCashStore()
  const refs = useRefs()
  const kpi = plan.result?.kpi
  const bn = plan.result?.bottleneck ?? refs.kpi?.bottleneck
  const planId = plan.result?.plan_id ?? refs.kpi?.plan_id ?? null
  const w = cash.result?.waterfall?.lp_recourse
  return {
    planNo: planId && /^\d+$/.test(planId) ? planId : null,
    otd: typeof kpi?.otd === 'number' ? kpi.otd : typeof refs.kpi?.kpi.otd === 'number' ? refs.kpi.kpi.otd : null,
    bottleneck: bn && typeof bn.utilization === 'number' ? { name: bn.wc_name || 'рабочий центр', load: bn.utilization } : null,
    cashGap: w ? { p: w.p_breach, ci: w.p_breach_ci ?? null } : null,
  }
}

export function ForecastScreen() {
  const refs = useRefs()
  const ctx = useDecisionContext()
  const plan = usePlanStore()
  const opt = useOptStore()
  const facts = usePlanFacts()
  const [hp, setHp] = useHashParams()
  useEffect(() => { void ensureRefs() }, [])

  // Сценарий: адрес → сценарий последнего плана (через его портфель) → рабочий → первый.
  const ids = refs.scenarios.map((s) => s.id)
  const known = (id?: string | null) => (id && ids.includes(id) ? id : undefined)
  const planSc = plan.result && plan.params.runId && opt.result?.run_id === plan.params.runId ? opt.result.scenario_id : undefined
  const scId = known(hp.sc) ?? known(planSc) ?? known(ctx.scenarioId) ?? ids[0] ?? ''
  const sc = refs.full[scId] ?? refs.scenarios.find((s) => s.id === scId) ?? null
  const manual = hp.mode === 'manual' || (refs.status === 'ready' && !scId)

  const [draft, setDraft] = useState<ManualParams>(() => manualFrom(sc))
  const [committed, setCommitted] = useState<ManualParams | null>(null)
  useEffect(() => { if (!manual) setDraft(manualFrom(sc)) }, [sc, manual])
  // Ручной режим из адреса (F5): считаем по текущим полям один раз, дальше — только по «Пересчитать».
  useEffect(() => { if (manual && committed === null) setCommitted(draft) }, [manual]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = committed ?? draft

  const months = effectiveScenario(sc ?? {}).months
  const key = manual ? `manual|${JSON.stringify(run)}` : forecastKey(scId, sc?.macro_mode, months)
  const params = useMemo(() => {
    if (manual) return { months: run.months, inflation: run.inflation, fx: run.fx, demand: run.demand, volatility: run.volatility, corr: run.corr, runs: FORECAST_RUNS, backtest: FORECAST_BACKTEST }
    const mode = toMacroMode(fromMacroMode(sc?.macro_mode), months)
    const m = typeof mode === 'string' ? null : mode
    return { scenario_id: scId, runs: FORECAST_RUNS, backtest: FORECAST_BACKTEST, macro_stress: m?.stress ?? null, macro_ref: m?.ref }
  }, [manual, run, scId, sc?.macro_mode, months])
  const { result, at, loading, error, refresh } = useCachedForecast(key, params, manual || Boolean(scId))
  const [zoom, setZoom] = useState<ForecastProduct | null>(null)
  const onOpen = useCallback((p: ForecastProduct) => setZoom(p), [])

  useEffect(() => {
    if (result && at) publishForecast(result, { scenarioId: manual ? null : scId, scenarioName: manual ? null : sc?.name ?? null, source: manual ? 'manual' : 'scenario', runs: FORECAST_RUNS, at })
  }, [result, at]) // eslint-disable-line react-hooks/exhaustive-deps

  const setManual = (on: boolean) => {
    if (on) setCommitted(draft)
    setHp({ mode: on ? 'manual' : null })
  }
  const stale = manual && committed !== null && JSON.stringify(committed) !== JSON.stringify(draft)
  const scenarioHref = sc ? `#/scenarios/${encodeURIComponent(sc.id)}/forecast` : '#/scenarios'
  const exc = buildExceptions(result, facts, scenarioHref)
  const top = useMemo(() => (result?.products ?? [])
    .map((p) => ({ p, d: Math.abs(forecastDelta(p)?.value ?? 0) })).sort((a, b) => b.d - a.d).slice(0, TOP_N).map((x) => x.p), [result])
  const total = (result?.products.length ?? 0) + (result?.rate ? 1 : 0)
  const source = manual ? 'Ручные параметры' : sc ? `Сценарий «${sc.name || 'Без названия'}»` : 'Сценарий не выбран'
  const prov = [source, facts.planNo ? `план №${facts.planNo}` : '', `${num(FORECAST_RUNS, 0)} прогонов`, at ? dateTimeShort(at) : ''].filter(Boolean).join(' · ')

  return (
    <div className={`forecast mon${loading && result ? ' is-refetching' : ''}`}>
      <ScreenHeader title="Мониторинг" blocks={['monitoring', 'external']} className="forecast__head"
        subtitle="Внешние условия и цены: что изменилось к плану и насколько надёжен прогноз"
        provenance={<><Chip size="sm" title="Откуда этот прогноз">{prov}</Chip><InfoTip id="forecast.fan" /></>}
        actions={<button type="button" className="btn" onClick={refresh} aria-busy={loading || undefined}>{loading ? 'Считаем…' : 'Обновить прогноз'}</button>} />

      <RunProgress phases={FORECAST_PHASES} running={loading} etaSeconds={FORECAST_ETA_S} title={result ? 'Пересчитываем прогноз' : 'Считаем прогноз'} />
      {error !== null && <ErrorBanner title={result ? 'Пересчёт не удался — показан прежний прогноз' : 'Прогноз не рассчитан'} error={error} onRetry={refresh} />}

      {result ? <p className="mon-verdict">{verdictText(result)}</p> : <Skeleton h={22} w="60%" />}
      <KpiStrip res={result} plan={facts} />
      {result ? <Exceptions crit={exc.crit} warn={exc.warn} onOpen={onOpen} /> : <Skeleton h={72} />}

      <section className="mon-src" aria-label="Условия прогноза">
        {!manual && sc && <p className="mon-src__sum">{conditionsText(manualFrom(sc))} · <a className="pf-link" href={`#/scenarios/${encodeURIComponent(sc.id)}/conditions`}>изменить в Сценариях →</a></p>}
        <details className="mon-src__manual" open={manual} onToggle={(e) => { const on = (e.currentTarget as HTMLDetailsElement).open; if (on !== manual) setManual(on) }}>
          <summary>Ручные параметры ({num(MANUAL_FIELDS, 0)}) {manual ? '▾ · источник: ручные' : '▸'}</summary>
          <ManualPanel value={draft} onChange={setDraft} stale={stale} running={loading} onRun={() => setCommitted(draft)}
            extra={sc ? <button type="button" className="btn btn--ghost" onClick={() => setManual(false)}>Вернуться к сценарию</button> : undefined} />
        </details>
      </section>

      <div className="mon-row">
        <div className="mon-rate">
          {result?.rate ? <ForecastFan p={result.rate} height={220} showLegend onOpen={onOpen} /> : result ? <p className="fc-muted">Веер ставки недоступен: генератор не ответил.</p> : <Skeleton h={300} />}
        </div>
        <InflationTile index={result?.inflation_index ?? null} months={result?.months ?? months} />
      </div>

      <section className="mon-top" aria-labelledby="mon-top-t">
        <div className="mon-top__head">
          <h2 className="mon-h text-caps" id="mon-top-t">Сильнее всего меняются · {countText(top.length, SERIES)}</h2>
          <a className="pf-link" href={scenarioHref}>Все {countText(total, SERIES)} → Сценарии › Прогноз</a>
        </div>
        {result ? <ForecastTable products={top} onOpen={onOpen} withQuality={false} sortBy="delta" caption="Ряды с наибольшим изменением медианы" loading={loading} />
          : <Skeleton h={360} />}
      </section>

      {zoom && <ForecastZoom p={zoom} scenarioId={manual ? null : scId} synthetic={result?.synthetic} onClose={() => setZoom(null)} />}
    </div>
  )
}

/** Инфляция: спарклайн индекса и накопленный рост за горизонт. */
function InflationTile({ index, months }: { index: readonly number[] | null; months: number }) {
  const cum = index && index.length ? index[index.length - 1] / 100 - 1 : null
  return (
    <div className="mon-infl" role="group" aria-label="Инфляция">
      <span className="text-caps mon-infl__k">Инфляция цен <InfoTip id="forecast.inflation" values={{ cum, months }} /></span>
      {index ? (
        <>
          <b className="mon-infl__v num">{cum === null ? '—' : signed(cum, '%')}</b>
          <span className="fc-muted">накопленная за {num(months, 0)} мес · в среднем {pct(Math.pow(1 + (cum ?? 0), 1 / Math.max(1, months)) - 1, 1)} в месяц</span>
          <Sparkline points={index} width={240} height={48} />
        </>
      ) : <Skeleton h={120} />}
    </div>
  )
}
