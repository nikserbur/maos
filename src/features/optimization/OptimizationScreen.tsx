/**
 * «Портфель» — Стадия 2: робастный портфель под стохастические цены (X2 «ответ сначала»).
 * Шапка — каноническое имя экрана и родословная прогона («#a1b2c3 · «Базовый» · CVaR · N = 3 000 ·
 * дата»); параметры после расчёта свёрнуты в строку; герой — вердикт, три числа и передача в «План»;
 * рядом — «Для сравнения», цена робастности, проверка вне выборки; ниже — LP, Парето, загрузка.
 * Результат переживает F5 (прогон из контекста решения, «из истории») и помечается «устарело ▲»,
 * если параметры или входы изменились после расчёта. Оптимизатор и его числа не меняются.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type OptimizeParams, type OptRunSummary, type PriceScenario, type Product, type WorkCenterType } from '../../lib/api'
import { getDecisionContext, isStale, setDecisionContext, useInputsChanged } from '../../shell/context'
import { screenTitle } from '../../shell/screens'
import { Chip, EmptyState, ErrorBanner, ScreenHeader, Skeleton, errorText } from '../../ui/kit'
import { ExpectedCard, PriceOfRobustness, RobustHero } from './PortfolioCards'
import { ExactCard, LoadCard, OosCard, ParetoCard } from './ResultCards'
import { OptParams } from './OptParams'
import { PlanHandoff } from './PlanHandoff'
import { metricValues } from './optTips'
import { formFromResult, lineageText, serverTime, staleFields } from './optText'
import {
  failOptRun, finishOptRun, getOptState, inheritCriterion, patchOptForm, startOptRun, useOptStore,
} from './optStore'
import { OBJECTIVES, isSoft, lpApplies, type Objective, type OptResultExt, type OptRunParams } from './optTypes'
import './optimization.css'
import './opt-screen.css'

const SUBTITLE = 'Робастный выбор: какие изделия выпускать, чтобы неблагоприятные цены не привели к большому убытку'

/** Прогон из контекста решения (F5): результат «из истории»; время — из журнала прогонов. */
async function restoreRun(id: string): Promise<OptResultExt | null> {
  try {
    const [res, runs] = await Promise.all([
      api.optimize.run_get(id),
      api.optimize.runs().catch((): OptRunSummary[] => []), // без журнала — без времени, но с результатом
    ])
    const ext = { ...(res as OptResultExt), run_id: id }
    const now = getOptState()
    if (now.result || now.running || isSoft(ext)) return null // свежий прогон пользователя важнее истории
    finishOptRun(ext, { origin: 'history', ranAt: serverTime(runs.find((r) => r.id === id)?.created_at) })
    patchOptForm(formFromResult(ext))
    return ext
  } catch (e) {
    // Прогона больше нет (сброс базы) — снимаем висячую ссылку; экран начинает с параметров.
    if (typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404) setDecisionContext({ portfolioRunId: undefined })
    return null
  }
}

function inheritFrom(sc: PriceScenario): void {
  inheritCriterion({
    scenarioId: sc.id, scenarioName: sc.name,
    objective: (['cvar', 'worstcase', 'meanvariance', 'minregret'].includes(sc.objective ?? '') ? sc.objective : 'cvar') as Objective,
    alpha: String(Number(sc.alpha) || 0.1), maxShare: String(Number(sc.max_share) || 0.35),
  })
}

export function OptimizationScreen() {
  const { form, result, running, error, inherited, ranAt, origin } = useOptStore()
  const changed = useInputsChanged()
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [wcTypes, setWcTypes] = useState<WorkCenterType[]>([])
  const [loadErr, setLoadErr] = useState<unknown>(null)
  /** null — по умолчанию (раскрыты, когда результата нет или он устарел); иначе — выбор пользователя. */
  const [paramsOpen, setParamsOpen] = useState<boolean | null>(null)

  const loadRefs = (restoring?: Promise<OptResultExt | null>) => {
    setLoadErr(null)
    Promise.all([api.scenarios.list(), api.products.list(), api.workCenterTypes.list(), restoring ?? Promise.resolve(null)])
      .then(([sc, pr, wc, restored]) => {
        setScenarios(sc); setProducts(pr); setWcTypes(wc)
        // Сценарий — из восстановленного прогона, формы или контекста решения, иначе первый в списке.
        const wanted = getOptState().form.scenarioId || getDecisionContext().scenarioId
        const start = (wanted && sc.find((x) => x.id === wanted)) || sc[0]
        if (start && !getOptState().form.scenarioId) patchOptForm({ scenarioId: start.id, horizonMonths: String(start.months || 12) })
        const cur = sc.find((x) => x.id === (getOptState().form.scenarioId || start?.id))
        if (cur) inheritFrom(cur)
        // Критерий живёт в сценарии, но восстановленный прогон показывает свои параметры (без ложного «устарело»).
        if (restored) patchOptForm(formFromResult(restored))
      })
      .catch((e: unknown) => setLoadErr(e))
  }
  useEffect(() => {
    const id = getDecisionContext().portfolioRunId
    const s = getOptState()
    loadRefs(!s.result && !s.running && id ? restoreRun(id) : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    products.forEach((p) => map.set(p.id, p.name))
    wcTypes.forEach((t) => map.set(t.id, t.name))
    return (id: string) => map.get(id) ?? id
  }, [products, wcTypes])

  const validate = (): string | null => {
    const sell = products.filter((p) => p.sellable === '1')
    if (sell.length === 0) return 'Нет товарных изделий. Отметьте «Товарная позиция» в «Справочники → Изделия» и задайте цену и спрос.'
    const noDemand = sell.filter((p) => (Number(p.demand_max) || 0) <= 0)
    if (noDemand.length) return `У товарных изделий не задан годовой спрос: ${noDemand.slice(0, 3).map((p) => `«${p.name}»`).join(', ')}${noDemand.length > 3 ? ` и ещё ${noDemand.length - 3}` : ''}.`
    const noPrice = sell.filter((p) => (Number(p.base_price) || 0) <= 0)
    if (noPrice.length) return `У товарных изделий не задан ориентир цены: ${noPrice.slice(0, 3).map((p) => `«${p.name}»`).join(', ')}.`
    return null
  }

  const run = async () => {
    const v = validate()
    if (v) { failOptRun({ message: v, kind: 'validation' }); return }
    startOptRun()
    const params: OptRunParams = {
      scenario_id: form.scenarioId || undefined,
      objective: form.objective,
      samples: Number(form.samples) || 3000,
      alpha: Number(form.alpha) || 0.1,
      max_share: Number(form.maxShare) || 0.35,
      horizon_hours: (Number(form.horizonMonths) || 12) * 720,
      // Переключатель LP недоступен вне CVaR/худшего случая — флаг не отправляется.
      ...(form.exact && lpApplies(form.objective) ? { compare_exact: true, solver: 'exact' as const } : {}),
    }
    try {
      const res = await api.optimize.run(params as OptimizeParams) as OptResultExt
      finishOptRun(res)
      setParamsOpen(null)
      setDecisionContext({ scenarioId: form.scenarioId, portfolioRunId: res.run_id })
    } catch (e) {
      failOptRun({ message: e instanceof Error ? e.message : 'Ошибка оптимизации', kind: 'api' })
    }
  }

  const onScenario = (id: string) => {
    const sc = scenarios.find((s) => s.id === id)
    patchOptForm({ scenarioId: id, ...(sc?.months ? { horizonMonths: String(sc.months) } : {}) })
    if (sc) inheritFrom(sc)
    setDecisionContext({ scenarioId: id })
  }
  const toParams = () => {
    setParamsOpen(true)
    window.requestAnimationFrame(() => document.getElementById('opt-params')?.focus())
  }

  const soft = isSoft(result)
  const live = result && !soft ? result : null
  const fields = live ? staleFields(form, live) : []
  const inputsAt = Math.max(changed.scenario ?? 0, changed.nsi ?? 0) || null
  const staleText = fields.length ? `параметры изменены после расчёта: ${fields.join(', ')}`
    : live && isStale(ranAt, inputsAt) ? 'сценарий или справочники изменены после расчёта' : null
  const stale = Boolean(staleText)
  const open = paramsOpen ?? (!live || stale)
  const objHint = OBJECTIVES.find((o) => o.id === form.objective)?.hint ?? ''

  return (
    <div className="opt2">
      <ScreenHeader
        eyebrow="Решения · Стадия 2 — что выпускать"
        title={screenTitle('optimization')}
        blocks={['decisions', 'criteria']}
        subtitle={SUBTITLE}
        provenance={live ? (
          <>
            <span className="opt2-lineage num">{lineageText(live, ranAt)}</span>
            {origin === 'history' && <Chip size="sm" title="Последний прогон восстановлен после перезагрузки">из истории</Chip>}
            {stale && <span className="glyph-setup opt2-lineage__stale">устарело</span>}
          </>
        ) : undefined}
      />

      <OptParams form={form} inherited={inherited} scenarios={scenarios} open={open} onToggle={setParamsOpen} onScenario={onScenario}
        staleText={staleText} alphaInfo={live ? metricValues(live.robust.metrics, live.samples, live.alpha)['opt.cvar'] : undefined}
        running={running} hasResult={Boolean(live)} primary={!live || stale} onRun={() => void run()} />

      {loadErr !== null && <ErrorBanner title="Справочники не загрузились" message={errorText(loadErr)} error={loadErr} onRetry={() => loadRefs()} />}
      {error && (error.kind === 'validation'
        ? <ErrorBanner tone="setup" title={error.message} />
        : <ErrorBanner title="Портфель не рассчитан" message={errorText(error.message)} detail={error.message} onRetry={() => void run()} />)}

      {running && !result && (
        <div className="opt2-grid" role="status" aria-busy="true">
          <span className="dk-vh">Моделируем портфели…</span>
          <div className="dk-card dk-span-8"><Skeleton h={22} w="40%" /><Skeleton h={48} w="60%" /><Skeleton h={200} /></div>
          <div className="opt2-col-4"><div className="dk-card"><Skeleton h={140} /></div><div className="dk-card"><Skeleton h={120} /></div></div>
        </div>
      )}

      {!result && !running && !error && (
        <EmptyState kind="first-use" title="Портфель ещё не рассчитан" diagram="cvar-tail"
          action={<button type="button" className="btn btn--ghost" onClick={toParams}>↑ к параметрам</button>}>
          Выберите сценарий и критерий и нажмите «Найти робастное решение». {objHint}
        </EmptyState>
      )}

      {result && soft && <ErrorBanner tone="setup" title={result.warnings?.join(' ') || 'Нет товарных изделий для оптимизации.'} />}

      {live && (
        <>
          {running && <p className="opt2-refresh" role="status">Пересчитывается — ниже прежний результат</p>}
          <div className={`opt2-grid${running ? ' is-refetching' : ''}`} aria-busy={running || undefined}>
            <RobustHero result={live} nameOf={nameOf} handoff={live.run_id
              ? <PlanHandoff key={live.run_id} runId={live.run_id} primary={!stale && !running} />
              : <p className="opt-note">Прогон не сохранён на сервере — передать в «План» нельзя. Пересчитайте.</p>} />
            <div className="opt2-col-4">
              <ExpectedCard result={live} />
              <PriceOfRobustness result={live} />
              <OosCard result={live} />
            </div>
            <ExactCard result={live} nameOf={nameOf} />
            <ParetoCard result={live} />
            <LoadCard result={live} nameOf={nameOf} />
            {live.warnings?.length > 0 && (
              <div className="opt2-span-12"><ErrorBanner tone="setup" title={live.warnings.join(' · ')} /></div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
