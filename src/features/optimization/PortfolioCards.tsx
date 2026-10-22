import type { ReactNode } from 'react'
import type { OptMetrics, OptPortfolio } from '../../lib/api'
import { money, num, pct, signed } from '../../explain/format'
import { InfoTip, type InfoTipValues } from '../../ui/InfoTip'
import { StatusChip, rise } from './kit/kit'
import { ProfitDistribution, ProfitLegend } from './ProfitDistribution'
import { objectiveLabel, type OptResultExt } from './optTypes'

/* ── Состав портфеля: изделия × объём × вклад ───────────────────────────── */
function PortfolioComposition({
  pf, nameOf, label = 'Состав портфеля',
}: {
  pf: OptPortfolio
  nameOf: (id: string) => string
  label?: string
}) {
  const items = [...pf.items].filter((it) => it.qty > 0).sort((a, b) => b.contribution - a.contribution)
  if (items.length === 0) return <p className="opt-note">Портфель пуст.</p>
  const maxRisk = Math.max(1e-9, ...items.map((it) => Math.abs(it.risk_contribution)))
  const d = pf.diversification
  return (
    <div className="opt-pf" aria-label={label}>
      <div className="opt-pf__head">
        <p className="text-caps opt-eyebrow">{label}</p>
        <div className="pf-div">
          <span className="pf-div__chip">{num(d.n_products, 0)} изд.</span>
          <span className="pf-div__chip" title="Индекс Херфиндаля — Хиршмана">HHI {num(d.hhi, 2)}</span>
          <span className={`pf-div__chip${d.concentration > 0.55 ? ' pf-div__chip--warn' : ''}`}>
            конц. {pct(d.concentration, 0)}
          </span>
        </div>
      </div>
      <ul className="pf-items">
        {items.map((it) => (
          <li className="pf-item" key={it.product_id}>
            <span className="pf-item__name" title={nameOf(it.product_id)}>{nameOf(it.product_id)}</span>
            <span className="pf-item__qty num">{num(it.qty, 0)}</span>
            <span className="pf-item__risk" title={`Вклад в риск: ${pct(it.risk_contribution)}`}>
              <span className="pf-item__risk-bar" style={{ width: `${(Math.abs(it.risk_contribution) / maxRisk) * 100}%` }} />
              <span className="pf-item__risk-pct">{money(it.contribution)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Плитка KPI ─────────────────────────────────────────────────────────── */
interface KpiProps {
  label: string
  tip: string
  values: InfoTipValues
  value: string
  size?: 'hero' | 'md' | 'sm'
  tone?: 'good' | 'bad'
  dot?: 'u' | 'r'
  sub?: ReactNode
}

export function Kpi({ label, tip, values, value, size = 'sm', tone, dot, sub }: KpiProps) {
  const valueCls = size === 'hero' ? 'kpi-hero' : `dk-kpi__value--${size}`
  const toneCls = tone === 'good' ? ' dk-tone-good' : tone === 'bad' ? ' dk-tone-bad' : ''
  return (
    <div className={`dk-kpi opt-kpi opt-kpi--${size}`}>
      <span className="dk-kpi__label text-caps">
        {dot && <i className={`opt-dot opt-dot--${dot}`} aria-hidden="true" />}
        {label}
        <InfoTip id={tip} values={values} />
      </span>
      <span className={`dk-kpi__value ${valueCls}${toneCls}`}>{value}</span>
      {sub && <span className="dk-kpi__sub">{sub}</span>}
    </div>
  )
}

function metricValues(m: OptMetrics, n: number, alpha: number) {
  return {
    expected: { expected: m.expected, n },
    cvar: { cvar: m.cvar, alpha, n },
    var: { var: m.var, alpha },
    std: { std: m.std },
    p_loss: { p_loss: m.p_loss, n },
    worst: { worst: m.worst_case, n },
    regret: { regret: m.max_regret },
  }
}

/* ── Герой: устойчивый портфель + распределение прибыли ─────────────────── */
interface HeroProps {
  result: OptResultExt
  nameOf: (id: string) => string
  footer?: ReactNode
}

export function RobustHero({ result, nameOf, footer }: HeroProps) {
  const m = result.robust.metrics
  const v = metricValues(m, result.samples, result.alpha)
  const d = result.robust.diversification
  const hasExp = result.histogram.some((b) => (b.count_expected ?? 0) > 0)
  return (
    <section className="dk-card dk-card--hero opt-hero dk-span-8 dk-rise" style={rise(1)} aria-labelledby="opt-hero-title">
      <div className="opt-hero__top">
        <div className="opt-hero__id">
          <div className="opt-hero__eyebrow">
            <span className="text-caps">Решение системы</span>
            <StatusChip tone="setup">выбрано</StatusChip>
            <StatusChip tone="info">{`${objectiveLabel(result.objective)} · α = ${pct(result.alpha, 0)}`}</StatusChip>
          </div>
          <h2 className="opt-hero__title" id="opt-hero-title">Устойчивый портфель</h2>
          <p className="opt-hero__lead">
            {`${num(d.n_products, 0)} изделий · ${num(result.samples, 0)} сценариев${result.scenario_name ? ` · «${result.scenario_name}»` : ''}`}
          </p>
        </div>
        <div className="opt-hero__kpis">
          <Kpi size="hero" dot="r" label="CVaR" tip="opt.cvar" values={v.cvar} value={money(m.cvar)} tone={m.cvar < 0 ? 'bad' : undefined} />
          <Kpi size="hero" dot="u" label="Ожидаемая прибыль" tip="opt.expected" values={v.expected} value={money(m.expected)} />
        </div>
      </div>

      <PortfolioComposition pf={result.robust} nameOf={nameOf} />

      <div className="opt-hero__chart">
        <ProfitDistribution histogram={result.histogram} metrics={m} alpha={result.alpha} samples={result.samples} />
        <ProfitLegend hasExpected={hasExp} />
      </div>

      <div className="opt-hero__tiles">
        <Kpi label="VaR" tip="opt.var" values={v.var} value={money(m.var)} />
        <Kpi label="Худший сценарий" tip="opt.worst" values={v.worst} value={money(m.worst_case)} tone={m.worst_case < 0 ? 'bad' : undefined} />
        <Kpi label="P(убыток)" tip="opt.p_loss" values={v.p_loss} value={pct(m.p_loss)} tone={m.p_loss > 0.02 ? 'bad' : 'good'} />
        <Kpi label="σ прибыли" tip="opt.sigma" values={v.std} value={money(m.std)} />
        <Kpi label="Макс. сожаление" tip="opt.max_regret" values={v.regret} value={money(m.max_regret)} />
      </div>

      {footer && <div className="opt-hero__foot">{footer}</div>}
    </section>
  )
}

/* ── «Максимум ожидания» для сравнения ──────────────────────────────────── */
interface DeltaRowProps {
  label: string
  tip: string
  values: InfoTipValues
  value: string
  delta: number
  /** high — больше лучше (E, CVaR, худший), low — меньше лучше (σ, P, сожаление). */
  better: 'high' | 'low'
  unit: '₽' | '%'
}

function DeltaRow({ label, tip, values, value, delta, better, unit }: DeltaRowProps) {
  const good = better === 'high' ? delta > 0 : delta < 0
  const tone = Math.abs(delta) < 1e-9 ? 'idle' : good ? 'running' : 'down'
  return (
    <div className="opt-drow">
      <span className="opt-drow__label">{label}<InfoTip id={tip} values={values} /></span>
      <span className="opt-drow__value num">{value}</span>
      <StatusChip tone={tone} title="Разница с устойчивым портфелем">{signed(delta, unit)}</StatusChip>
    </div>
  )
}

export function ExpectedCard({ result }: { result: OptResultExt }) {
  const e = result.expected.metrics
  const r = result.robust.metrics
  const v = metricValues(e, result.samples, result.alpha)
  return (
    <section className="dk-card opt-maxe dk-rise" style={rise(2)} aria-labelledby="opt-maxe-title">
      <div className="dk-card__head">
        <div>
          <p className="text-caps opt-eyebrow">Для сравнения</p>
          <h3 className="dk-card__title" id="opt-maxe-title">Максимум ожидания</h3>
        </div>
        <StatusChip tone="idle">хрупкий</StatusChip>
      </div>
      <p className="opt-note">Лучший по среднему кандидат без ограничения концентрации. Δ — разница с устойчивым портфелем.</p>
      <div className="opt-drows">
        <DeltaRow label="E[Π]" tip="opt.expected" values={v.expected} value={money(e.expected)} delta={e.expected - r.expected} better="high" unit="₽" />
        <DeltaRow label="CVaR" tip="opt.cvar" values={v.cvar} value={money(e.cvar)} delta={e.cvar - r.cvar} better="high" unit="₽" />
        <DeltaRow label="Худший" tip="opt.worst" values={v.worst} value={money(e.worst_case)} delta={e.worst_case - r.worst_case} better="high" unit="₽" />
        <DeltaRow label="σ" tip="opt.sigma" values={v.std} value={money(e.std)} delta={e.std - r.std} better="low" unit="₽" />
        <DeltaRow label="P(убыток)" tip="opt.p_loss" values={v.p_loss} value={pct(e.p_loss)} delta={e.p_loss - r.p_loss} better="low" unit="%" />
      </div>
    </section>
  )
}

/* ── Цена робастности ───────────────────────────────────────────────────── */
export function PriceOfRobustness({ result }: { result: OptResultExt }) {
  const e = result.expected.metrics
  const r = result.robust.metrics
  const por = result.price_of_robustness
  const share = e.expected !== 0 ? por / Math.abs(e.expected) : null
  const values = { por, e_exp: e.expected, e_rob: r.expected }
  return (
    <section className="dk-card opt-por dk-rise" style={rise(3)} aria-labelledby="opt-por-title">
      <p className="text-caps opt-eyebrow" id="opt-por-title">
        Цена робастности
        <InfoTip id="opt.price_of_robustness" values={values} />
      </p>
      <p className="opt-por__value kpi-hero">{money(por)}</p>
      {share != null && <p className="dk-kpi__sub">{`${pct(share)} ожидаемой прибыли портфеля «макс. E»`}</p>}
      <p className="opt-por__text">
        Столько среднего система уступает, чтобы худший сценарий стал{' '}
        <b className="num">{money(r.worst_case)}</b> вместо <b className="num">{money(e.worst_case)}</b>,
        а риск убытка — <b className="num">{pct(r.p_loss)}</b> вместо <b className="num">{pct(e.p_loss)}</b>.
        При корреляции цен ρ = <b className="num">{num(result.market_corr, 2)}</b> диверсификация снижает σ
        с <b className="num">{money(e.std)}</b> до <b className="num">{money(r.std)}</b>.
      </p>
    </section>
  )
}
