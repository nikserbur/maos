/**
 * Вкладка «Прогноз цен» (одно имя у любого сценария) — X2 «внимание — первым, таблица вместо стены».
 * Первой строкой — как этим пользоваться (владелец: «непонятно, как использовать исторический
 * прогноз»): «Эти пути цен идут в Портфель и кассу сценария «X»» и чип «● прогноз по Базовому» /
 * «◆ что если, не прогноз». Затем проверка модели цен на истории (одна для всех сценариев) и две
 * плитки, «Требуют внимания» — 6 вееров в индексе «сейчас = 100», все ряды таблицей; строка
 * открывает веер в боковой панели. Цены изделий идут от путей генератора сценария (ставка, курс,
 * инфляция пресета доходят до цен). Ответ кэшируется по сценарию, режиму, горизонту И условиям
 * (инфляция, курс, спрос, разброс, связь цен, распределения, точечные цены) — правка «Условий»
 * пересчитывает веер; «Обновить» пересчитывает, оставляя прежнее на экране (приглушённо).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForecastProduct, ForecastResult, PriceScenario } from '../../lib/api'
import { countText, num, pct, rangeText } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { RunProgress } from '../../ui/RunProgress'
import { Chip, ErrorBanner, KpiTile, Skeleton } from '../../ui/kit'
import { ForecastGrid, ForecastTable } from '../forecast/ForecastGrid'
import { ForecastZoom } from '../forecast/ForecastZoom'
import {
  COVERAGE_NOMINAL, FORECAST_BACKTEST, FORECAST_ETA_S, FORECAST_PHASES, FORECAST_RUNS, attentionSet, qualitySummary, reliabilityText,
} from '../forecast/forecastModel'
import { forecastKey, publishForecast, useCachedForecast } from '../forecast/forecastStore'
import { fromMacroMode, toMacroMode } from './regimeMenu'
import { effectiveScenario } from './scenarioDefaults'
import { scenarioViewOf, viewTitle, type ScenarioView } from './scenarioPresets'
import './scenarios-v2.css'

/** Строк таблицы до «Показать все N». */
const TABLE_TOP = 20
/** «из 21 изделия», «из 76 изделий». */
const OF_ITEMS = ['изделия', 'изделий', 'изделий'] as const

/** Подпись условий сценария для ключа кэша прогноза: любая правка «Условий»/«Распределений» — новый ключ. */
export function conditionsSignature(sc: PriceScenario): string {
  const src = JSON.stringify([
    sc.inflation, sc.fx, sc.demand, sc.volatility, sc.market_corr, sc.mode,
    (sc.distributions ?? []).map((d) => [d.product_id, d.dist_type, d.mean, d.stddev, d.beta, d.min_val, d.max_val, d.mode_val]),
    (sc.overrides ?? []).map((o) => [o.product_id, o.base_price, o.base_cost]),
  ])
  let h = 5381
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** `anchor` — последний месяц данных ЦБ РФ («сейчас»): ось вееров в календарных месяцах, как в Мониторинге. */
export function ForecastTab({ sc, anchor }: { sc: PriceScenario; anchor?: string | null }) {
  const months = effectiveScenario(sc).months
  const key = forecastKey(sc.id, `${sc.macro_mode || 'base'}#${conditionsSignature(sc)}`, months)
  const params = useMemo(() => {
    const mode = toMacroMode(fromMacroMode(sc.macro_mode), months)
    const m = typeof mode === 'string' ? null : mode
    return { scenario_id: sc.id, runs: FORECAST_RUNS, backtest: FORECAST_BACKTEST, macro_stress: m?.stress ?? null, macro_ref: m?.ref }
  }, [sc.id, sc.macro_mode, months])
  const { result, at, loading, error, refresh } = useCachedForecast(key, params)
  const [zoom, setZoom] = useState<ForecastProduct | null>(null)
  const onOpen = useCallback((p: ForecastProduct) => setZoom(p), [])

  useEffect(() => {
    if (result && at) publishForecast(result, { scenarioId: sc.id, scenarioName: sc.name, source: 'scenario', runs: FORECAST_RUNS, at })
  }, [result, at]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !result) return <ErrorBanner title="Прогноз не рассчитан" error={error} onRetry={refresh} />
  if (!result) {
    return (
      <div className="sc2-tab" aria-busy="true">
        <RunProgress phases={FORECAST_PHASES} running etaSeconds={FORECAST_ETA_S} title="Считаем прогноз" />
        <Skeleton h={168} />
        <div className="fc-grid">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={260} />)}</div>
      </div>
    )
  }
  const series = [...(result.rate ? [result.rate] : []), ...result.products]
  const attention = attentionSet(result.products)
  const view = scenarioViewOf(sc)
  return (
    <div className={`sc2-tab sc2-fc${loading ? ' is-refetching' : ''}`}>
      <RunProgress phases={FORECAST_PHASES} running={loading} etaSeconds={FORECAST_ETA_S} title="Пересчитываем прогноз" />
      {error !== null && <ErrorBanner title="Пересчёт не удался — показан прежний прогноз" error={error} onRetry={refresh} />}
      <UsageLead name={sc.name} view={view} />
      <QualityBlock res={result} onRefresh={refresh} refreshing={loading} isForecast={view.isForecast} />
      <section className="sc2-group" aria-labelledby="sc2-attn">
        <h3 className="sc2-cap" id="sc2-attn">Требуют внимания <span className="sc2-cap__affects">худшие по проверке и самые широкие веера</span></h3>
        <div className="sc2-fc__body"><ForecastGrid products={attention} onOpen={onOpen} anchor={anchor} /></div>
      </section>
      <section className="sc2-group" aria-labelledby="sc2-all">
        <h3 className="sc2-cap" id="sc2-all">Все ряды · {num(series.length, 0)}</h3>
        <div className="sc2-fc__body"><ForecastTable products={series} onOpen={onOpen} caption="Все ряды прогноза" loading={loading} limit={TABLE_TOP} /></div>
      </section>
      {zoom && <ForecastZoom p={zoom} scenarioId={sc.id} synthetic={result.synthetic} anchor={anchor} onClose={() => setZoom(null)} />}
    </div>
  )
}

/** Как пользоваться вкладкой: куда идут эти пути цен и прогноз ли это. */
function UsageLead({ name, view }: { name: string; view: ScenarioView }) {
  return (
    <p className="sc2-lead">
      <Chip size="sm" title={view.mode}><span aria-hidden="true">{view.glyph}</span> {view.isForecast ? 'прогноз по Базовому' : `что если · ${viewTitle(view)}`}</Chip>
      <span>
        Эти пути цен идут в Портфель и кассу сценария «{name || 'Без названия'}».{' '}
        {view.isForecast
          ? 'Это прогноз: генератор, обученный на истории, продолжает сегодняшние ставку, курс и инфляцию.'
          : 'Это проверка «что если», а не прогноз: условия сценария отличаются от Базового.'}
      </span>
    </p>
  )
}

/** Проверка модели цен на истории: вердикт и две плитки; что именно проверяется — в подзаголовке. */
function QualityBlock({ res, onRefresh, refreshing, isForecast }: { res: ForecastResult; onRefresh: () => void; refreshing: boolean; isForecast: boolean }) {
  const s = qualitySummary(res.products)
  const better = s.total - s.worse
  const demo = res.synthetic || res.demo
  const weak = s.total > 0 && better < s.total / 2
  return (
    <section className="sc2-quality" aria-labelledby="sc2-q-t">
      <div className="sc2-quality__head">
        <h3 className="sc2-cap" id="sc2-q-t">Проверка модели цен на истории <InfoTip id="forecast.backtest" /></h3>
        <span className="sc2-badges">
          {demo && <Chip size="sm" title="История цен синтетическая — качество демонстрационное"><span aria-hidden="true">▲</span> демо-данные (синтетика)</Chip>}
          {res.rate && res.rate.synthetic === false && <Chip size="sm">ставка — обученный генератор, ряды ЦБ РФ</Chip>}
        </span>
        <button type="button" className="btn btn--sm" onClick={onRefresh} aria-busy={refreshing || undefined}>{refreshing ? 'Пересчитываем…' : 'Обновить'}</button>
      </div>
      <p className="sc2-muted sc2-quality__sub">
        Последние {num(s.backtestK || FORECAST_BACKTEST, 0)} мес истории скрыты от модели, её прогноз сравнён с фактом. Проверка одна для всех сценариев:
        сценарий меняет только внешние условия ({isForecast ? 'это — прогноз по Базовому' : 'это — пути цен «что если», не прогноз'}).
      </p>
      {s.total > 0 && <p className="sc2-quality__sub">Надёжность рядов цен: {reliabilityText(res.products)}</p>}
      {(weak || demo) && s.total > 0 && (
        <ErrorBanner tone="setup" title={`Модель точнее «как вчера» ${weak ? 'лишь ' : ''}для ${num(better, 0)} из ${countText(s.total, OF_ITEMS)}${demo ? '; история синтетическая — веера ориентировочные' : ''}`} />
      )}
      <div className="sc2-quality__tiles">
        <KpiTile metric="forecast.backtest" label="Где «как вчера» точнее модели" value={`${num(s.worse, 0)} из ${num(s.total, 0)}`}
          interval="рядов: для них веер — ориентир, а не прогноз" />
        <KpiTile metric="forecast.crps" label="Факт внутри «8 из 10 исходов»" value={s.covAvg === null ? '—' : pct(s.covAvg, 0)}
          interval={<>при ожидаемых {pct(COVERAGE_NOMINAL, 0)}{s.covMin !== null && s.covMax !== null ? ` · разброс ${rangeText(s.covMin, s.covMax, '%')}` : ''}</>} />
      </div>
    </section>
  )
}
