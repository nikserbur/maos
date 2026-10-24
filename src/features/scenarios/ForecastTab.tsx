/**
 * Вкладка «Прогноз и проверка» (X2 «внимание — первым, таблица вместо стены»): вердикт качества
 * одной строкой и две плитки (хуже наивного · попадание в полосу против нормы), затем «Требуют
 * внимания» — 6 вееров в индексе «сейчас = 100» на общей шкале, затем все ряды таблицей с динамикой;
 * строка открывает веер в боковой панели. Ответ кэшируется по сценарию, режиму и горизонту — повторный
 * вход не пересчитывает; «Обновить» пересчитывает, оставляя прежнее на экране (приглушённо).
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
  COVERAGE_NOMINAL, FORECAST_BACKTEST, FORECAST_ETA_S, FORECAST_PHASES, FORECAST_RUNS, attentionSet, qualitySummary,
} from '../forecast/forecastModel'
import { forecastKey, publishForecast, useCachedForecast } from '../forecast/forecastStore'
import { fromMacroMode, toMacroMode } from './regimeMenu'
import { effectiveScenario } from './scenarioDefaults'
import './scenarios-v2.css'

/** Строк таблицы до «Показать все N». */
const TABLE_TOP = 20
/** «из 21 изделия», «из 76 изделий». */
const OF_ITEMS = ['изделия', 'изделий', 'изделий'] as const

export function ForecastTab({ sc }: { sc: PriceScenario }) {
  const months = effectiveScenario(sc).months
  const key = forecastKey(sc.id, sc.macro_mode, months)
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
  return (
    <div className={`sc2-tab sc2-fc${loading ? ' is-refetching' : ''}`}>
      <RunProgress phases={FORECAST_PHASES} running={loading} etaSeconds={FORECAST_ETA_S} title="Пересчитываем прогноз" />
      {error !== null && <ErrorBanner title="Пересчёт не удался — показан прежний прогноз" error={error} onRetry={refresh} />}
      <QualityBlock res={result} onRefresh={refresh} refreshing={loading} />
      <section className="sc2-group" aria-labelledby="sc2-attn">
        <h3 className="sc2-cap text-caps" id="sc2-attn">Требуют внимания <span className="sc2-cap__affects">худшие по проверке и самые широкие веера</span></h3>
        <div className="sc2-fc__body"><ForecastGrid products={attention} onOpen={onOpen} /></div>
      </section>
      <section className="sc2-group" aria-labelledby="sc2-all">
        <h3 className="sc2-cap text-caps" id="sc2-all">Все ряды · {num(series.length, 0)}</h3>
        <div className="sc2-fc__body"><ForecastTable products={series} onOpen={onOpen} caption="Все ряды прогноза" loading={loading} limit={TABLE_TOP} /></div>
      </section>
      {zoom && <ForecastZoom p={zoom} scenarioId={sc.id} synthetic={result.synthetic} onClose={() => setZoom(null)} />}
    </div>
  )
}

/** Вердикт качества и две плитки; окно проверки и MASE — в подзаголовке. */
function QualityBlock({ res, onRefresh, refreshing }: { res: ForecastResult; onRefresh: () => void; refreshing: boolean }) {
  const s = qualitySummary(res.products)
  const better = s.total - s.worse
  const demo = res.synthetic || res.demo
  const weak = s.total > 0 && better < s.total / 2
  return (
    <section className="sc2-quality" aria-labelledby="sc2-q-t">
      <div className="sc2-quality__head">
        <h3 className="sc2-cap text-caps" id="sc2-q-t">Качество прогноза <InfoTip id="forecast.backtest" /></h3>
        <span className="sc2-badges">
          {demo && <Chip size="sm" title="История цен синтетическая — качество демонстрационное"><span aria-hidden="true">▲</span> демо-данные (синтетика)</Chip>}
          {res.rate && res.rate.synthetic === false && <Chip size="sm">ставка — обученный генератор, ряды ЦБ РФ</Chip>}
        </span>
        <button type="button" className="btn btn--sm" onClick={onRefresh} aria-busy={refreshing || undefined}>{refreshing ? 'Пересчитываем…' : 'Обновить'}</button>
      </div>
      <p className="sc2-muted sc2-quality__sub">
        Проверка: последние {num(s.backtestK || FORECAST_BACKTEST, 0)} мес скрыты от модели, прогноз сравнён с фактом · MASE — после импорта факта продаж
      </p>
      {(weak || demo) && s.total > 0 && (
        <ErrorBanner tone="setup" title={`Модель точнее «как вчера» ${weak ? 'лишь ' : ''}для ${num(better, 0)} из ${countText(s.total, OF_ITEMS)}${demo ? '; история синтетическая — веера ориентировочные' : ''}`} />
      )}
      <div className="sc2-quality__tiles">
        <KpiTile metric="forecast.backtest" label="Хуже наивного" value={`${num(s.worse, 0)} из ${num(s.total, 0)}`}
          interval="рядов, где прогноз «как вчера» ошибается меньше модели" />
        <KpiTile metric="forecast.crps" label="Попадание в полосу P10–P90" value={s.covAvg === null ? '—' : pct(s.covAvg, 0)}
          interval={<>при ожидаемых {pct(COVERAGE_NOMINAL, 0)}{s.covMin !== null && s.covMax !== null ? ` · разброс ${rangeText(s.covMin, s.covMax, '%')}` : ''}</>} />
      </div>
    </section>
  )
}
