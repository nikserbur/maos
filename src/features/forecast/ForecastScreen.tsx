/**
 * «Мониторинг» (владелец: «невзрачно»; X2 «сначала ответ», «честные состояния», конвейер Сценарий →
 * Портфель → План → Мониторинг). Сверху вниз:
 *  шапка (источник · план; «Что если…» и «Обновить прогноз») → деловой статус словами и полнота данных
 *  отдельно, одна фраза ответа (сбыт, сырьё, вывод для маржи, ставка), надёжность, основа расчёта →
 *  четыре плитки (цены сбыта, закупочные цены, заказы в срок, касса) → «Сигналы» карточками и строка
 *  «не рассчитано» → «Внешние условия» (ставка, инфляция, курс — веера генератора; «не прогноз» — один
 *  раз в мета-строке) → «Цены» (топ-10 по изменению медианы, «Все 76 рядов цен →»).
 * Источник — сценарий с пресетом «Базовый» (обученный генератор), а не «рабочий» (useMonitorSource);
 * «что если» — только из панели «Что если…» (`?mode=manual&wp=…`), пересчёт — по кнопке.
 * Сбой прогноза не прячет план и кассу.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForecastProduct } from '../../lib/api'
import { countText, num } from '../../explain/format'
import { useDecisionContext } from '../../shell/context'
import { useHashParams } from '../../shell/router'
import { RunProgress } from '../../ui/RunProgress'
import { Chip, ErrorBanner, ScreenHeader, Section, SkeletonRows, Skeleton, errorDetail } from '../../ui/kit'
import { ensureRefs, useRefs } from '../method-map/useMethodMapState'
import { useOptStore } from '../optimization/optStore'
import { usePlanStore } from '../plan/planStore'
import { FORECAST_TAB_TITLE } from '../scenarios/scenarioPresets'
import { ForecastTable } from './ForecastGrid'
import { ForecastZoom } from './ForecastZoom'
import { MacroFans } from './MacroFans'
import { AlertList, MissingChip } from './MonitorAlerts'
import { HeadlineBasis, HeadlineChips } from './MonitorBasis'
import { KpiRow, StatusHeadline } from './MonitorHeadline'
import { FORECAST_ETA_S, FORECAST_PHASES, FORECAST_RUNS, forecastDelta } from './forecastModel'
import { publishForecast, useCachedForecast } from './forecastStore'
import { narrowBand } from './macroModel'
import { PRICE_SERIES, forecastPhase, headlineText, horizonBy, monitorStatus, normalizeForecast, priceMove, trustText } from './monitorModel'
import { buildSignals, planLabel, severityMeta, type SignalAction } from './monitorSignals'
import { useMonitorSource } from './useMonitorSource'
import { usePlanFacts } from './usePlanFacts'
import { WhatIfPanel } from './WhatIfPanel'
import { WHAT_IF_CLEAR, whatIfLabel, whatIfToParams, type WhatIf } from './whatIfModel'
import './forecast.css'
import './monitor.css'

const TOP_N = 10

const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function ForecastScreen() {
  const refs = useRefs()
  const ctx = useDecisionContext()
  const plan = usePlanStore()
  const opt = useOptStore()
  const facts = usePlanFacts()
  const [hp, setHp] = useHashParams()
  useEffect(() => { void ensureRefs() }, [])

  const planSc = plan.result && plan.params.runId && opt.result?.run_id === plan.params.runId ? opt.result.scenario_id : undefined
  const src = useMonitorSource(refs, hp, { context: ctx.scenarioId, plan: planSc })
  const { scId, sc, manual, whatIf, stressName, anchor } = src
  const overrides = src.whatIfOn && (whatIf.inflation !== null || whatIf.usd !== null || whatIf.demand !== null)
  /** Имя «что если» для чипа и фразы: пресет («Как 2022») или свои поправки панели. */
  const whatIfName = stressName ?? (overrides ? 'Что если' : null)

  const { result: raw, at, loading, error, refresh } = useCachedForecast(src.key, src.params, manual ? !src.waitGen : Boolean(scId))
  const { res: result, rateError } = useMemo(() => normalizeForecast(raw), [raw])
  const [zoom, setZoom] = useState<ForecastProduct | null>(null)
  const [panel, setPanel] = useState(false)
  const [filter, setFilter] = useState<{ ids: readonly string[]; title: string } | null>(null)
  const onOpen = useCallback((p: ForecastProduct) => setZoom(p), [])

  useEffect(() => {
    if (raw && at) publishForecast(raw, { scenarioId: manual ? null : scId, scenarioName: manual ? null : sc?.name ?? null, source: manual ? 'manual' : 'scenario', runs: FORECAST_RUNS, at })
  }, [raw, at]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFilter(null) }, [src.key])

  const phase = forecastPhase({ hasResult: Boolean(result), loading, error, waiting: src.waitGen, refsReady: refs.status === 'ready' || refs.status === 'error' })
  const pending = phase === 'pending'
  const failed = phase === 'failed'
  const by = horizonBy(anchor, result?.months ?? src.months)
  /** Вкладка сценария; без сценария — список «Сценариев». */
  const tabHref = (tab: 'forecast' | 'conditions') => (sc ? `#/scenarios/${encodeURIComponent(sc.id)}/${tab}` : '#/scenarios')
  const rateHoldout = refs.macro?.holdout?.variables.key_pp ?? null
  const signals = useMemo(() => buildSignals({
    res: result, forecastFailed: failed, rateFailed: Boolean(result) && !result?.rate, plan: facts,
    scenario: { id: manual ? null : scId || null, name: manual ? null : sc?.name ?? null },
    hrefs: { forecast: tabHref('forecast'), conditions: tabHref('conditions') },
    by, generatorCpi: src.genCpi, forecastAt: at, cbrLast: anchor, today: thisMonth(), rateHoldout, stress: Boolean(stressName),
  }), [result, failed, facts, manual, scId, sc, by, src.genCpi, at, anchor, rateHoldout, stressName]) // eslint-disable-line react-hooks/exhaustive-deps
  const status = pending ? null : monitorStatus(signals)
  const goods = useMemo(() => (result ? priceMove(result.products, 'product') : null), [result])
  const rawMove = useMemo(() => (result ? priceMove(result.products, 'raw') : null), [result])
  const total = result?.products.length ?? 0
  const top = useMemo(() => {
    const ps = result?.products ?? []
    const pool = filter ? ps.filter((p) => filter.ids.includes(p.id)) : ps
    return pool.map((p) => ({ p, d: Math.abs(forecastDelta(p)?.value ?? 0) })).sort((a, b) => b.d - a.d).slice(0, filter ? pool.length : TOP_N).map((x) => x.p)
  }, [result, filter])
  const synthetic = Boolean(result?.synthetic)
  const demo = Boolean(result && (result.synthetic || result.demo))

  const runWhatIf = (w: WhatIf) => { setPanel(false); setHp(whatIfToParams(w)) }
  const backToScenario = () => { setPanel(false); setHp(WHAT_IF_CLEAR) }
  /** К прогнозу по обученному генератору: без «что если» и без явного стрессового сценария. */
  const showForecast = () => { setPanel(false); setHp({ ...WHAT_IF_CLEAR, sc: null }) }
  const onAction = (a: SignalAction) => {
    if (a.kind === 'retry') refresh()
    else if (a.kind === 'whatif') setPanel(true)
    else if (a.kind === 'open') { const p = [...(result?.rate ? [result.rate] : []), ...(result?.products ?? [])].find((x) => x.id === a.id); if (p) setZoom(p) }
    else if (a.kind === 'filter') {
      setFilter({ ids: a.ids, title: a.title })
      document.getElementById('mon-prices')?.scrollIntoView({ block: 'start' })
    }
  }

  const source = src.whatIfOn ? `Что если: ${whatIfLabel(whatIf)}`
    : sc ? `${stressName ? 'Что если' : 'Прогноз'} · сценарий «${sc.name || 'Без названия'}»` : 'Прогноз генератора · без сценария'
  const hasPlan = Boolean(facts.planKey || facts.otd !== null)
  const prov = [source, hasPlan ? planLabel(facts) : ''].filter(Boolean).join(' · ')
  const answer = result
    ? headlineText({ res: result, by, stress: whatIfName, rateNarrow: !stressName && narrowBand(rateHoldout) !== null })
    : failed ? 'Прогноз цен не рассчитан: сигналы цен и внешних условий недоступны.' : null
  const basisLink = src.whatIfOn
    ? <button type="button" className="pf-link" onClick={backToScenario}>вернуться к прогнозу</button>
    : <a className="pf-link" href={tabHref('conditions')}>{sc ? 'изменить в Сценариях →' : 'открыть Сценарии →'}</a>

  return (
    <div className={`forecast mon${loading && result ? ' is-refetching' : ''}`}>
      <ScreenHeader title="Мониторинг" blocks={['monitoring', 'external']} className="forecast__head"
        subtitle="Внешние условия и цены: что изменилось к плану и насколько надёжен прогноз"
        provenance={<Chip size="sm" title="Откуда этот прогноз">{prov}</Chip>}
        actions={<>
          <button type="button" className="btn btn--ghost" onClick={() => setPanel(true)} aria-haspopup="dialog">Что если…</button>
          <button type="button" className="btn" onClick={refresh} aria-busy={loading || undefined} disabled={src.waitGen}>{loading ? 'Считаем…' : 'Обновить прогноз'}</button>
        </>} />

      <RunProgress phases={FORECAST_PHASES} running={loading} etaSeconds={FORECAST_ETA_S} title={result ? 'Пересчитываем прогноз' : 'Считаем прогноз'} />
      {error !== null && <ErrorBanner title={result ? 'Пересчёт не удался — показан прежний прогноз' : 'Прогноз цен не рассчитан — план и касса ниже показаны'} error={error} onRetry={refresh} />}

      <StatusHeadline status={status} answer={answer} trust={result ? trustText(result.products) : null}
        missing={pending ? null : <MissingChip signals={signals} onAction={onAction} />}
        chips={<HeadlineChips whatIf={whatIfName} changes={src.changes} conditionsHref={sc && !manual ? tabHref('conditions') : null} demo={demo} synthetic={synthetic} />}
        action={whatIfName ? <button type="button" className="btn btn--sm" onClick={showForecast}>Показать прогноз (обучено на истории)</button> : null}
        basis={<HeadlineBasis preset={src.preset} whatIf={whatIfName} changes={src.changes} trained={refs.macro?.data ?? null} at={at} anchor={anchor}
          noBase={manual && !src.whatIfOn && refs.status === 'ready'} link={basisLink} />} />
      <KpiRow goods={goods} raw={rawMove} by={by} plan={facts} loading={pending} failed={failed} />

      <Section id="mon-signals" title="Сигналы" meta={pending ? 'считаем…' : severityMeta(signals)}>
        {pending ? <div className="mon-alerts__skel"><Skeleton h={112} /><Skeleton h={112} /></div> : <AlertList signals={signals} onAction={onAction} />}
      </Section>

      <Section id="mon-macro" title="Внешние условия"
        meta={stressName
          ? <span className="mon-stressnote"><span className="glyph-info" aria-hidden="true" /> не прогноз: так могло бы пойти в условиях «{stressName}»</span>
          : 'ставка, инфляция и курс — прогноз обученного генератора по рядам Банка России'}>
        <MacroFans rate={result?.rate ?? null} rateError={result ? rateError : failed ? errorDetail(error) || 'прогноз не рассчитан' : null}
          ratePending={!result && !failed} refetching={loading && Boolean(result)} sample={src.macro} summary={refs.macro} history={src.regimes?.history} anchor={anchor}
          stress={stressName} onRetry={refresh} onOpenRate={onOpen} />
      </Section>

      <Section id="mon-prices" title="Цены: сильнее всего меняются"
        meta={filter ? `${filter.title}: ${countText(top.length, ['позиция', 'позиции', 'позиций'])}` : result ? `топ-${num(top.length, 0)} из ${num(total, 0)} по изменению медианы` : undefined}
        tools={<>
          {filter && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilter(null)}>Показать топ-{num(TOP_N, 0)}</button>}
          {total > 0 && <a className="pf-link" href={tabHref('forecast')} title={`Сценарии › ${FORECAST_TAB_TITLE}`}>Все {countText(total, PRICE_SERIES)} →</a>}
        </>}>
        {result ? <ForecastTable products={top} onOpen={onOpen} withQuality={false} sortBy="delta" caption="Ряды цен с наибольшим изменением медианы" loading={loading} empty="Рядов цен в прогнозе нет" />
          : pending ? <SkeletonRows rows={6} cols={6} rowH={32} label="Считаем прогноз цен…" />
            : <p className="mon-muted">Таблица появится после расчёта прогноза — «Повторить» в баннере выше.</p>}
      </Section>

      {zoom && <ForecastZoom p={zoom} scenarioId={manual ? null : scId} synthetic={result?.synthetic} onClose={() => setZoom(null)} />}
      {panel && <WhatIfPanel initial={whatIf} active={src.whatIfOn} lastObs={src.lastObs} onRun={runWhatIf} onReset={backToScenario} onClose={() => setPanel(false)} />}
    </div>
  )
}
