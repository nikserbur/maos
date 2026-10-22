/**
 * «Оптимизация» — Стадия 2: робастный портфель под стохастические цены.
 * Герой — устойчивый портфель и распределение прибыли с хвостом CVaR;
 * рядом — «максимум ожидания», цена робастности, Парето, загрузка,
 * проверка вне выборки и сравнение эвристики с точной LP-моделью (HiGHS).
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type OptPortfolio, type OptimizeParams, type PriceScenario, type Product, type WorkCenterType } from '../../lib/api'
import { dateTime, money, num, pct } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { getDecisionContext, setDecisionContext } from '../../shell/context'
import { ParetoFrontier } from './ParetoFrontier'
import { ExpectedCard, PriceOfRobustness, RobustHero } from './PortfolioCards'
import { EmptyState, ErrorBanner, ScreenHeader, Segmented, Skeleton, StatusChip, Switch, rise } from '../../ui/kit'
import { BarList } from '../../ui/charts'
import { ParamField } from '../../ui/ParamField'
import type { Provenance } from '../method-map/types'
import { criterionOverrides, failOptRun, finishOptRun, inheritCriterion, patchOptForm, startOptRun, useOptStore } from './optStore'
import { OBJECTIVES, isSoft, type Objective, type OptResultExt, type OptRunParams } from './optTypes'
import './optimization.css'
import './opt-screen.css'

/** Порог «горячей» загрузки — только пометка строки, не цвет бара (X1 §4 п. 5, §5 п. 9). */
const HOT_LOAD = 0.8

/** Загрузка оборудования портфелем — `BarList`: названия в две строки без обрезки, бар одного цвета. */
function ResourceLoad({ pf, nameOf }: { pf: OptPortfolio; nameOf: (id: string) => string }) {
  const rows = [...pf.resource_load].sort((a, b) => b.utilization - a.utilization).slice(0, 14)
  if (rows.length === 0) return <p className="opt-note">Нет загрузки.</p>
  return (
    <BarList compact fmt={(v) => pct(v, 0)} max={1} valueHeader="Загрузка"
      ariaLabel={`Загрузка ${rows.length} типов оборудования портфелем: от ${pct(rows[0].utilization, 0)} до ${pct(rows[rows.length - 1].utilization, 0)}`}
      rows={rows.map((l) => ({
        key: l.wc_type_id, label: nameOf(l.wc_type_id), value: Math.min(1, l.utilization), marked: l.utilization >= HOT_LOAD,
        secondary: l.utilization >= HOT_LOAD ? <span className="glyph-setup">близко к пределу</span> : undefined,
      }))} />
  )
}

const pctPts = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${num(Math.abs(v), 1)} %`)

function ExactCard({ result, nameOf }: { result: OptResultExt; nameOf: (id: string) => string }) {
  const ex = result.exact
  if (!ex) return null
  if (ex.status !== 'optimal') {
    return (
      <section className="dk-card opt2-span-12" style={rise(5)}>
        <p className="text-caps opt-eyebrow">Точная модель (LP, HiGHS)</p>
        <p className="opt-note">Статус: {ex.status ?? '—'}{ex.reason ? ` — ${ex.reason}` : ''}. Для критериев «E − λσ» и «мин. сожаление» точная LP-постановка не применяется.</p>
      </section>
    )
  }
  const g = ex.gap_vs_heuristic ?? {}
  const duals = (ex.duals ?? []).filter((d) => d.shadow_price > 0).slice(0, 8)
  const maxDual = Math.max(1, ...duals.map((d) => d.shadow_price))
  return (
    <section className="dk-card opt2-span-12 dk-rise" style={rise(5)} aria-labelledby="opt-exact-title">
      <div className="dk-card__head">
        <div>
          <p className="text-caps opt-eyebrow">Эвристика ↔ точная модель<InfoTip id="opt.cvar" /></p>
          <h3 className="dk-card__title" id="opt-exact-title">Точное решение: LP Рокафеллара — Урясева (HiGHS)</h3>
        </div>
        <StatusChip tone="running">оптимум найден</StatusChip>
      </div>
      <p className="opt-note">
        Те же {ex.n_scenarios ?? result.samples} сценариев (общие случайные числа), вогнутая выручка аппроксимирована
        кусочно-линейно (отрезков: {ex.pwl_segments ?? "—"}, ошибка ≤ {money(ex.pwl_max_error ?? 0)}). Решено за {num(ex.solve_ms ?? 0, 0)} мс.
      </p>
      <div className="opt2-exact__grid">
        <div><p className="text-caps opt-eyebrow">выигрыш по цели</p><div className="opt2-gain">{pctPts(g.objective_pct)}</div></div>
        <div><p className="text-caps opt-eyebrow">вне выборки</p><div className="opt2-gain">{pctPts(g.oos_objective_pct)}</div></div>
        <div><p className="text-caps opt-eyebrow">E[прибыль]</p><div className="opt2-gain">{pctPts(g.expected_pct)}</div></div>
        <div><p className="text-caps opt-eyebrow">CVaR</p><div className="opt2-gain">{pctPts(g.cvar_pct)}</div></div>
      </div>
      {duals.length > 0 && (
        <>
          <p className="text-caps opt-eyebrow">Теневые цены мощностей — точный сигнал теории ограничений</p>
          <table className="opt2-table">
            <thead><tr><th>Тип оборудования</th><th>₽ за час мощности</th><th>Загрузка</th></tr></thead>
            <tbody>
              {duals.map((d) => (
                <tr key={d.wc_type}>
                  <td>{nameOf(d.wc_type)}</td>
                  <td><span className="opt2-bar" style={{ width: `${Math.max(6, (d.shadow_price / maxDual) * 120)}px` }} />{money(d.shadow_price)}</td>
                  <td>{pct(d.utilization, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

function OosCard({ result }: { result: OptResultExt }) {
  const o = result.oos
  if (!o) return null
  const ok = Math.abs(o.gap_cvar) < 0.05 && Math.abs(o.gap_expected) < 0.05
  return (
    <section className="dk-card dk-rise" style={rise(4)}>
      <div className="dk-card__head">
        <p className="text-caps opt-eyebrow">Проверка вне выборки<InfoTip id="opt.oos_gap" values={{ gap_expected: o.gap_expected, gap_cvar: o.gap_cvar }} /></p>
        <StatusChip tone={ok ? 'running' : 'setup'}>{ok ? 'устойчиво' : 'есть переобучение'}</StatusChip>
      </div>
      <div className="opt-drows">
        <div className="opt-drow"><span className="opt-drow__label">E на свежих сценариях</span><span className="opt-drow__value num">{money(o.expected)}</span><span className="opt2-meta">Δ {pct(o.gap_expected, 1)}</span></div>
        <div className="opt-drow"><span className="opt-drow__label">CVaR на свежих сценариях</span><span className="opt-drow__value num">{money(o.cvar)}</span><span className="opt2-meta">Δ {pct(o.gap_cvar, 1)}</span></div>
      </div>
    </section>
  )
}

export function OptimizationScreen() {
  const store = useOptStore()
  const { form, result, running, error, inherited } = store
  const ovr = criterionOverrides(store)
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [wcTypes, setWcTypes] = useState<WorkCenterType[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [planName, setPlanName] = useState('')
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const loadRefs = () => {
    setLoadErr(null)
    Promise.all([api.scenarios.list(), api.products.list(), api.workCenterTypes.list()])
      .then(([sc, pr, wc]) => {
        setScenarios(sc); setProducts(pr); setWcTypes(wc)
        // Сценарий — из контекста решения (карта/«Сценарии»), иначе первый в списке.
        const ctx = getDecisionContext().scenarioId
        const start = (ctx && sc.find((x) => x.id === ctx)) || sc[0]
        if (start && !form.scenarioId) patchOptForm({ scenarioId: start.id, horizonMonths: String(start.months || 12) })
        const cur = sc.find((x) => x.id === (form.scenarioId || start?.id))
        if (cur) inheritFrom(cur)
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : 'нет связи с сервером'))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadRefs, [])

  /** Критерий живёт в сценарии (UX-V2 §8 п. 3): форма наследует objective / α / max_share. */
  const inheritFrom = (sc: PriceScenario) => inheritCriterion({
    scenarioId: sc.id, scenarioName: sc.name,
    objective: (['cvar', 'worstcase', 'meanvariance', 'minregret'].includes(sc.objective ?? '') ? sc.objective : 'cvar') as Objective,
    alpha: String(Number(sc.alpha) || 0.1), maxShare: String(Number(sc.max_share) || 0.35),
  })
  /** Паспорт поля критерия (UX-V2 §8 п. 3): из сценария ○ или переопределено для прогона ■ с «вернуть». */
  const passport = (changed: boolean, field: 'objective' | 'alpha' | 'maxShare') => inherited ? {
    provenance: (changed ? 'manual' : 'default') as Provenance,
    owner: changed ? 'этот прогон' : `из сценария «${inherited.scenarioName}»`,
    changed,
    onRevert: changed ? () => patchOptForm({ [field]: inherited[field] } as Partial<typeof form>) : undefined,
  } : {}

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
    setSavedMsg(null)
    const params: OptRunParams = {
      scenario_id: form.scenarioId || undefined,
      objective: form.objective,
      samples: Number(form.samples) || 3000,
      alpha: Number(form.alpha) || 0.1,
      max_share: Number(form.maxShare) || 0.35,
      horizon_hours: (Number(form.horizonMonths) || 12) * 720,
      ...(form.exact ? { compare_exact: true, solver: 'exact' as const } : {}),
    }
    try {
      const res = await api.optimize.run(params as OptimizeParams) as OptResultExt
      finishOptRun(res)
      setDecisionContext({ scenarioId: form.scenarioId, portfolioRunId: res.run_id })
    } catch (e) {
      failOptRun({ message: e instanceof Error ? e.message : 'Ошибка оптимизации', kind: 'api' })
    }
  }

  const savePlan = async () => {
    if (!result?.run_id) return
    try {
      const p = await api.optimize.savePlan(result.run_id, planName.trim() || `Оптимизация ${dateTime(Date.now())}`)
      setSavedMsg(`Программа «${p.name}» сохранена (${p.orders} изделий) — откройте «План».`)
      setPlanName('')
    } catch (e) {
      setSavedMsg('Не сохранено: ' + (e instanceof Error ? e.message : 'ошибка'))
    }
  }

  const soft = isSoft(result)
  const objHint = OBJECTIVES.find((o) => o.id === form.objective)?.hint ?? ''

  return (
    <div className="opt2">
      <ScreenHeader
        eyebrow="Стадия 2 · что выпускать"
        title="Робастный портфель"
        blocks={['decisions', 'criteria']}
        subtitle={<>Цены продукции — случайные величины сценария. Методом статистических испытаний строится распределение
          прибыли каждого портфеля и выбирается <b>робастное</b> решение — лучшее в неблагоприятных сценариях, а не в среднем.</>}
        actions={result && !soft && result.run_id
          ? <button type="button" className="btn" onClick={() => document.getElementById('opt2-save')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} title="Главная связка Стадия 2 → Стадия 1: сохранить программу и открыть «План»">Передать в «План» ↓</button>
          : undefined}
      />

      <section className="dk-card opt2-params dk-rise" style={rise(0)} aria-label="Параметры оптимизации">
        <div className="opt2-params__grid">
          <ParamField label="Сценарий внешних условий" value={null} size="md">
            <select className="dk-select" value={form.scenarioId} aria-label="Сценарий внешних условий" onChange={(e) => {
              const sc = scenarios.find((s) => s.id === e.target.value)
              patchOptForm({ scenarioId: e.target.value, ...(sc?.months ? { horizonMonths: String(sc.months) } : {}) })
              if (sc) inheritFrom(sc)
              setDecisionContext({ scenarioId: e.target.value })
            }}>
              {scenarios.length === 0 && <option value="">— базовые цены НСИ —</option>}
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </ParamField>
          <ParamField label="Критерий" value={null} size="md" {...passport(ovr.objective, 'objective')}>
            <Segmented label="Критерий робастности" value={form.objective}
              onChange={(id: Objective) => patchOptForm({ objective: id })}
              options={OBJECTIVES.map((o) => ({ id: o.id, label: o.label, title: o.hint }))} />
          </ParamField>
          <ParamField label="α хвоста" value={Number(form.alpha)} unit="доля" size="md" info="opt.cvar" min={0.01} max={0.5} step={0.05}
            onChange={(v) => patchOptForm({ alpha: String(v) })} {...passport(ovr.alpha, 'alpha')} />
          <ParamField label="Прогонов" value={Number(form.samples)} unit="сценариев" size="md" min={200} step={500}
            onChange={(v) => patchOptForm({ samples: String(v) })} provenance="manual" owner="этот прогон" />
          <ParamField label="Макс. доля изделия" value={Number(form.maxShare)} unit="доля" size="md" min={0.1} max={1} step={0.05}
            onChange={(v) => patchOptForm({ maxShare: String(v) })} {...passport(ovr.maxShare, 'maxShare')} />
          <ParamField label="Горизонт" value={Number(form.horizonMonths)} unit="мес" size="md" min={1} max={36} step={1}
            onChange={(v) => patchOptForm({ horizonMonths: String(v) })} provenance="default" owner="из сценария" />
        </div>
        <div className="opt2-params__row">
          <Switch checked={form.exact} onChange={(v) => patchOptForm({ exact: v })}
            hint="Решить ту же задачу точно (LP Рокафеллара — Урясева, HiGHS) и показать разрыв с эвристикой">
            Сравнить с точной LP-моделью
          </Switch>
          <span className="opt2-params__hint">{objHint}</span>
          <button type="button" className="btn btn--primary opt2-run" onClick={run} disabled={running}>
            {running ? 'Моделируем…' : 'Найти робастное решение'}
          </button>
        </div>
      </section>

      {loadErr && <ErrorBanner onRetry={loadRefs}>Справочники не загрузились: {loadErr}</ErrorBanner>}
      {error && <ErrorBanner tone={error.kind === 'validation' ? 'setup' : 'down'} onRetry={error.kind === 'api' ? run : undefined}>{error.message}</ErrorBanner>}

      {running && !result && (
        <div className="opt2-grid">
          <div className="dk-card dk-span-8"><Skeleton h={22} w="40%" /><Skeleton h={48} w="60%" /><Skeleton h={200} /></div>
          <div className="opt2-col-4"><div className="dk-card"><Skeleton h={140} /></div><div className="dk-card"><Skeleton h={120} /></div></div>
        </div>
      )}

      {!result && !running && !error && (
        <EmptyState title="Портфель ещё не рассчитан" diagram="cvar-tail"
          action={<button type="button" className="btn" onClick={run}>Найти робастное решение ↑</button>}>
          Выберите сценарий цен и критерий. Система построит распределение прибыли для ~120 портфелей и выберет тот,
          у которого лучше всего среднее в худших α сценариев (CVaR).
        </EmptyState>
      )}

      {result && soft && (
        <ErrorBanner tone="setup">{result.warnings?.join(' ') || 'Нет товарных изделий для оптимизации.'}</ErrorBanner>
      )}

      {result && !soft && (
        <div className="opt2-grid">
          <RobustHero result={result} nameOf={nameOf} footer={result.run_id && (
            <div className="opt2-save" id="opt2-save">
              <input value={planName} placeholder="Название производственной программы…" onChange={(e) => setPlanName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && savePlan()} />
              <button type="button" className="btn btn--primary" onClick={savePlan}>Передать в «План»</button>
              {savedMsg && <span className="opt2-save__msg">{savedMsg}</span>}
            </div>
          )} />
          <div className="opt2-col-4">
            <ExpectedCard result={result} />
            <PriceOfRobustness result={result} />
            <OosCard result={result} />
          </div>

          <ExactCard result={result} nameOf={nameOf} />

          {result.candidates?.length > 1 && (
            <section className="dk-card opt2-span-6 dk-rise" style={rise(6)}>
              <div className="dk-card__head">
                <p className="text-caps opt-eyebrow">Граница Парето «доходность ↔ риск»<InfoTip id="opt.pareto" /></p>
                <span className="opt2-meta">{result.candidates.filter((c) => c.is_pareto).length} недоминируемых из {result.candidates.length}</span>
              </div>
              <ParetoFrontier candidates={result.candidates} />
            </section>
          )}
          <section className="dk-card opt2-span-6 dk-rise" style={rise(7)}>
            <div className="dk-card__head">
              <p className="text-caps opt-eyebrow">Загрузка оборудования портфелем<InfoTip id="opt.resource_load" /></p>
            </div>
            <ResourceLoad pf={result.robust} nameOf={nameOf} />
          </section>

          {result.warnings?.length > 0 && (
            <div className="opt2-span-12"><ErrorBanner tone="setup">{result.warnings.join(' · ')}</ErrorBanner></div>
          )}
        </div>
      )}
    </div>
  )
}
