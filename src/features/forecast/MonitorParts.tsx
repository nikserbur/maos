/**
 * Части экрана «Мониторинг» (X2 «ответ сначала»): полоса ≤ 5 показателей рядом с риском, исключения
 * по важности (каждое ведёт в веер или в «План»), сводка условий сценария только для чтения и ручные
 * параметры «что если» за раскрытием (открыв их, пользователь переключает источник на «ручные» —
 * ручные значения никогда не игнорируются молча).
 */
import type { ReactNode } from 'react'
import type { ForecastProduct, ForecastResult, PriceScenario } from '../../lib/api'
import { NBSP, countText, freqText, num, pct, rangeText } from '../../explain/format'
import { ParamField } from '../../ui/ParamField'
import { KpiTile } from '../../ui/kit'
import { effectiveScenario } from '../scenarios/scenarioDefaults'
import { forecastDelta, qualityOf, qualitySummary } from './forecastModel'
import './forecast.css'

/** Пороги исключений. */
const CASH_GAP_ALERT = 0.05
const CASH_GAP_CRIT = 0.15
const OTD_ALERT = 0.9
const OTD_CRIT = 0.75
const BOTTLENECK_ALERT = 0.9
const MOVE_ALERT = 0.1
const MOVES_SHOWN = 4

export interface PlanFacts {
  planNo: string | null
  otd: number | null
  bottleneck: { name: string; load: number } | null
  cashGap: { p: number; ci: [number, number] | null } | null
}

/* ── Полоса показателей ───────────────────────────────────────────────────── */

const NotComputed = ({ href, action }: { href: string; action: string }) => (
  <span className="mon-nc">не рассчитано · <a className="pf-link" href={href}>{action}</a></span>
)

export function KpiStrip({ res, plan }: { res: ForecastResult | null; plan: PlanFacts }) {
  const rate = res?.rate
  const last = rate ? rate.p50.length - 1 : -1
  const s = res ? qualitySummary(res.products) : null
  return (
    <div className="mon-kpis" role="group" aria-label="Ключевые показатели">
      <KpiTile metric="plan.otd" label="Заказы в срок · OTD" value={plan.otd === null ? undefined : pct(plan.otd, 0)}
        interval={plan.planNo ? `план №${plan.planNo}` : undefined}>
        {plan.otd === null && <NotComputed href="#/plan/new" action="построить план →" />}
      </KpiTile>
      <KpiTile metric="plan.bottleneck" label="Узкое место" value={plan.bottleneck ? pct(plan.bottleneck.load, 0) : undefined} interval={plan.bottleneck?.name}>
        {!plan.bottleneck && <NotComputed href="#/plan/new" action="построить план →" />}
      </KpiTile>
      <KpiTile metric="cash.p_breach" label="Кассовый разрыв" value={plan.cashGap ? freqText(plan.cashGap.p) : undefined}
        interval={plan.cashGap ? <>сценариев{plan.cashGap.ci ? ` · ДИ оценки 95${NBSP}% ${rangeText(plan.cashGap.ci[0], plan.cashGap.ci[1], '%')}` : ''}</> : undefined}>
        {!plan.cashGap && <NotComputed href="#/plan" action="рассчитать кассу в «Плане» →" />}
      </KpiTile>
      <KpiTile metric="forecast.fan" label={rate ? `Ставка ЦБ через ${num(last, 0)} мес` : 'Ставка ЦБ к горизонту'} value={rate ? pct(rate.p50[last] / 100, 1) : undefined}
        interval={rate ? `P10–P90 · ${rangeText(rate.p10[last] / 100, rate.p90[last] / 100, '%')}` : undefined}>
        {!rate && res && <span className="mon-nc">генератор ставки недоступен</span>}
      </KpiTile>
      <KpiTile metric="forecast.backtest" label="Хуже «как вчера»" value={s && s.total ? `${num(s.worse, 0)} из ${num(s.total, 0)}` : undefined}
        interval={s && s.total ? 'рядов: наивный прогноз точнее модели' : undefined} />
    </div>
  )
}

/* ── Исключения ───────────────────────────────────────────────────────────── */

interface Exception { key: string; text: string; href?: string; open?: ForecastProduct }

export function buildExceptions(res: ForecastResult | null, plan: PlanFacts, scenarioHref: string): { crit: Exception[]; warn: Exception[] } {
  const crit: Exception[] = []
  const warn: Exception[] = []
  if (plan.cashGap && plan.cashGap.p >= CASH_GAP_ALERT) {
    const e = { key: 'cash', text: `Кассовый разрыв ${freqText(plan.cashGap.p)} сценариев`, href: '#/plan' }
    ;(plan.cashGap.p >= CASH_GAP_CRIT ? crit : warn).push(e)
  }
  if (plan.otd !== null && plan.otd < OTD_ALERT) {
    const e = { key: 'otd', text: `Вовремя только ${pct(plan.otd, 0)} заказов последнего плана`, href: '#/plan' }
    ;(plan.otd < OTD_CRIT ? crit : warn).push(e)
  }
  if (plan.bottleneck && plan.bottleneck.load >= BOTTLENECK_ALERT) {
    warn.push({ key: 'bn', text: `Узкое место «${plan.bottleneck.name}» загружено на ${pct(plan.bottleneck.load, 0)}`, href: '#/plan' })
  }
  if (res) {
    const all = [...(res.rate ? [res.rate] : []), ...res.products]
    const badRate = res.rate && qualityOf(res.rate).level === 'bad'
    if (badRate && res.rate) crit.push({ key: 'rate', text: 'Веер ставки не откалиброван — интервалы ставки уже реальных', open: res.rate })
    const outside = qualitySummary(res.products).outside
    if (outside > 0) warn.push({ key: 'cal', text: `${countText(outside, ['ряд', 'ряда', 'рядов'])}: факт бэктеста чаще вне P10–P90`, href: scenarioHref })
    const moves = all.filter((p) => p.role !== 'rate')
      .map((p) => ({ p, d: forecastDelta(p) }))
      .filter((x) => x.d && Math.abs(x.d.value) >= MOVE_ALERT)
      .sort((a, b) => Math.abs(b.d!.value) - Math.abs(a.d!.value))
      .slice(0, MOVES_SHOWN)
    for (const m of moves) warn.push({ key: `mv-${m.p.id}`, text: `${m.p.name}: медиана ${m.d!.label}`, open: m.p })
  }
  return { crit, warn }
}

export function Exceptions({ crit, warn, onOpen }: { crit: readonly Exception[]; warn: readonly Exception[]; onOpen: (p: ForecastProduct) => void }) {
  if (crit.length === 0 && warn.length === 0) {
    return <p className="mon-ok"><span aria-hidden="true">●</span> Исключений нет: план, касса и прогноз в пределах порогов.</p>
  }
  const group = (title: string, glyph: string, items: readonly Exception[], cls: string) => items.length > 0 && (
    <section className={`mon-exc__g ${cls}`} aria-label={title}>
      <h3 className="mon-exc__t text-caps"><span className="mon-exc__glyph" aria-hidden="true">{glyph}</span> {title} · {num(items.length, 0)}</h3>
      <ul className="mon-exc__list">
        {items.map((e) => (
          <li key={e.key}>
            {e.open
              ? <button type="button" className="pf-link" onClick={() => onOpen(e.open!)}>{e.text} →</button>
              : <a className="pf-link" href={e.href}>{e.text} →</a>}
          </li>
        ))}
      </ul>
    </section>
  )
  return (
    <div className="mon-exc">
      {group('Требует решения', '✕', crit, 'is-crit')}
      {group('Внимание', '▲', warn, 'is-warn')}
    </div>
  )
}

/* ── Условия: сводка сценария и ручные параметры ──────────────────────────── */

export interface ManualParams { months: number; inflation: number; fx: number; demand: number; volatility: number; corr: number }

export function manualFrom(sc: PriceScenario | null): ManualParams {
  const e = effectiveScenario(sc ?? {})
  return { months: e.months, inflation: e.inflation, fx: e.fx, demand: e.demand, volatility: e.volatility, corr: e.market_corr }
}

/** «инфляция 1,5 %/мес · курс ×1 · спрос ×1 · волатильность 5 %/мес · ρ 0,5 · 6 мес». */
export function conditionsText(m: ManualParams): string {
  return [
    `инфляция ${pct(m.inflation, 1)}/мес`, `курс ×${num(m.fx, 2)}`, `спрос ×${num(m.demand, 2)}`,
    `волатильность ${pct(m.volatility, 1)}/мес`, `ρ ${num(m.corr, 2)}`, `${num(m.months, 0)} мес`,
  ].join(' · ')
}

interface ManualProps {
  value: ManualParams
  onChange: (next: ManualParams) => void
  stale: boolean
  onRun: () => void
  running: boolean
  extra?: ReactNode
}

/** Ручные параметры «что если»: поля с единицами; «Пересчитать» — главное действие панели. */
export function ManualPanel({ value: m, onChange, stale, onRun, running, extra }: ManualProps) {
  const set = (k: keyof ManualParams) => (v: number) => onChange({ ...m, [k]: v })
  return (
    <div className="mon-manual">
      <div className="mon-manual__grid">
        <ParamField label="Горизонт" value={m.months} unit="мес" min={1} max={36} step={1} onChange={(v) => set('months')(Math.max(1, Math.min(36, Math.round(v))))} />
        <ParamField label="Инфляция" value={m.inflation * 100} unit="%/мес" min={0} max={10} step={0.1} onChange={(v) => set('inflation')(v / 100)} />
        <ParamField label="Курс" value={m.fx} unit="×" min={0.5} max={2} step={0.05} onChange={set('fx')} />
        <ParamField label="Спрос" value={m.demand} unit="×" min={0.3} max={2} step={0.05} onChange={set('demand')} />
        <ParamField label="Волатильность" value={m.volatility * 100} unit="%/мес" min={0} max={25} step={0.5} onChange={(v) => set('volatility')(v / 100)} />
        <ParamField label="Корреляция цен ρ" value={m.corr} min={0} max={0.98} step={0.05} onChange={(v) => set('corr')(Math.max(0, Math.min(0.98, v)))} />
      </div>
      <div className="mon-manual__foot">
        {stale && <span className="mon-stale"><span aria-hidden="true">▲</span> параметры изменены — прогноз ниже по прежним</span>}
        {extra}
        <button type="button" className="btn btn--primary" onClick={onRun} aria-busy={running || undefined}>{running ? 'Считаем…' : 'Пересчитать по ручным'}</button>
      </div>
    </div>
  )
}
