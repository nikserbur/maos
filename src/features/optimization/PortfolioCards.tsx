/**
 * Карточки результата «Портфеля» (X2 «ответ сначала»): герой — вердикт одной строкой, три числа
 * (E · CVaR · P(убыток) частотой), передача в «План», состав, распределение прибыли и плитки
 * VaR/худший/σ/сожаление; рядом — «Для сравнения» (Δ к устойчивому, условие смены выбора) и цена
 * робастности одной строкой. Числа — текстом (--text), состояние — глифом и словом; ▲ охрой —
 * только «выбрано» и плитка оптимизируемой метрики. Логика и числа результата не меняются.
 */
import type { ReactNode } from 'react'
import { money, num, pct, pp, signed } from '../../explain/format'
import { InfoTip, type InfoTipValues } from '../../ui/InfoTip'
import { CapsLabel, Chip, DeltaChip, KpiTile, rise, type DeltaBetter } from '../../ui/kit'
import { PortfolioComposition } from './Composition'
import { ProfitDistribution } from './ProfitDistribution'
import { metricValues, porValues } from './optTips'
import { criterionText, lossFreqText, verdictText } from './optText'
import { kpiLabels, type OptResultExt } from './optTypes'

/** Какую плитку критерий оптимизирует (▲ охрой): CVaR, худший сценарий или сожаление; у E − λ·σ — две метрики, без пометки. */
const OBJECTIVE_TILE: Readonly<Record<string, 'cvar' | 'worst' | 'regret'>> = { cvar: 'cvar', worstcase: 'worst', minregret: 'regret' }

/** ▲ охрой — «цель оптимизации» (единственное значение охры на экране, кроме «выбрано»). */
function ObjectiveMark() {
  return (
    <span className="opt-obj" title="Эту метрику оптимизирует критерий">
      <span aria-hidden="true">▲</span><span className="opt-obj__word">цель</span>
    </span>
  )
}

/* ── Герой: устойчивый портфель ─────────────────────────────────────────── */
interface HeroProps {
  result: OptResultExt
  nameOf: (id: string) => string
  /** Блок «Передать в «План»» — сразу под вердиктом и числами. */
  handoff?: ReactNode
}

export function RobustHero({ result, nameOf, handoff }: HeroProps) {
  const m = result.robust.metrics
  const tips = metricValues(m, result.samples, result.alpha)
  const L = kpiLabels(result.alpha)
  const target = OBJECTIVE_TILE[result.objective]
  const mark = (k: 'cvar' | 'worst' | 'regret') => (target === k ? <ObjectiveMark /> : undefined)
  return (
    <section className="dk-card dk-card--hero opt-hero dk-span-8 dk-rise" style={rise(1)} aria-labelledby="opt-hero-title">
      <div className="opt-hero__head">
        <span className="text-caps opt-hero__eyebrow">Решение системы</span>
        <h2 className="opt-hero__title" id="opt-hero-title">Устойчивый портфель</h2>
        <Chip size="sm" title="Портфель, выбранный критерием"><span className="opt-sel" aria-hidden="true">▲</span>выбрано</Chip>
        <Chip size="sm" title="Критерий выбора портфеля">{criterionText(result.objective, result.alpha, result.lambda)}</Chip>
      </div>
      <p className="opt-hero__verdict">{verdictText(result)}</p>

      <div className="opt-hero__kpis">
        <KpiTile size="hero" metric="opt.expected" label={L.expected} values={tips['opt.expected']} value={money(m.expected)} className="opt-kpi opt-kpi--e" />
        <KpiTile size="hero" metric="opt.cvar" label={L.cvar} values={tips['opt.cvar']} value={money(m.cvar)} status={mark('cvar')} className="opt-kpi opt-kpi--tail" />
        <KpiTile size="hero" metric="opt.p_loss" label={L.p_loss} values={tips['opt.p_loss']} value={pct(m.p_loss)} interval={lossFreqText(m.p_loss)} className="opt-kpi" />
      </div>

      {handoff}

      <PortfolioComposition pf={result.robust} nameOf={nameOf} limit={result.max_share} />

      <div className="opt-hero__chart">
        <ProfitDistribution result={result} />
      </div>

      <div className="opt-hero__tiles">
        <KpiTile size="sm" metric="opt.var" label={L.var} values={tips['opt.var']} value={money(m.var)} />
        <KpiTile size="sm" metric="opt.worst" label={L.worst} values={tips['opt.worst']} value={money(m.worst_case)} status={mark('worst')} />
        <KpiTile size="sm" metric="opt.sigma" label={L.std} values={tips['opt.sigma']} value={money(m.std)} />
        <KpiTile size="sm" metric="opt.max_regret" label={L.regret} values={tips['opt.max_regret']} value={money(m.max_regret)} status={mark('regret')} />
      </div>
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
  /** high — больше лучше (E, CVaR, худший), low — меньше лучше (σ, P). */
  better: DeltaBetter
  fmt: (v: number) => string
  sub?: string
}

function DeltaRow({ label, tip, values, value, delta, better, fmt, sub }: DeltaRowProps) {
  return (
    <div className="opt-drow">
      <span className="opt-drow__label"><CapsLabel text={label} /><InfoTip id={tip} values={values} /></span>
      <span className="opt-drow__value num">{value}{sub && <span className="opt-drow__sub">{sub}</span>}</span>
      <DeltaChip value={delta} better={better} fmt={fmt} title="Разница с устойчивым портфелем" />
    </div>
  )
}

const rub = (v: number) => signed(v, '₽')
const points = (v: number) => pp(v, { signed: true })

export function ExpectedCard({ result }: { result: OptResultExt }) {
  const e = result.expected.metrics
  const r = result.robust.metrics
  const tips = metricValues(e, result.samples, result.alpha)
  const L = kpiLabels(result.alpha)
  const gain = e.expected - r.expected
  return (
    <section className="dk-card opt-maxe dk-rise" style={rise(2)} aria-labelledby="opt-maxe-title">
      <div className="dk-card__head">
        <div>
          <p className="text-caps opt-eyebrow">Для сравнения</p>
          <h3 className="dk-card__title" id="opt-maxe-title"><span className="opt-sq" aria-hidden="true" />Максимум ожидания</h3>
        </div>
        <Chip size="sm">хрупкий</Chip>
      </div>
      <p className="opt-note">Лучший по среднему кандидат без предела доли. Δ — разница с устойчивым портфелем.</p>
      <div className="opt-drows">
        <DeltaRow label={L.expected} tip="opt.expected" values={tips['opt.expected']} value={money(e.expected)} delta={gain} better="high" fmt={rub} />
        <DeltaRow label={L.cvar} tip="opt.cvar" values={tips['opt.cvar']} value={money(e.cvar)} delta={e.cvar - r.cvar} better="high" fmt={rub} />
        <DeltaRow label={L.worst} tip="opt.worst" values={tips['opt.worst']} value={money(e.worst_case)} delta={e.worst_case - r.worst_case} better="high" fmt={rub} />
        <DeltaRow label={L.std} tip="opt.sigma" values={tips['opt.sigma']} value={money(e.std)} delta={e.std - r.std} better="low" fmt={rub} />
        <DeltaRow label={L.p_loss} tip="opt.p_loss" values={tips['opt.p_loss']} value={pct(e.p_loss)} delta={e.p_loss - r.p_loss} better="low" fmt={points}
          sub={lossFreqText(e.p_loss)} />
      </div>
      <p className="opt-flip">
        «Макс. E» лучше, только если важно лишь среднее: {signed(gain, '₽')} в среднем, но в худших {pct(result.alpha, 0)} —{' '}
        <span className="num">{money(e.cvar)}</span> вместо <span className="num">{money(r.cvar)}</span>.
      </p>
    </section>
  )
}

/* ── Цена робастности: одна строка, подробности — в «i» ─────────────────── */
export function PriceOfRobustness({ result }: { result: OptResultExt }) {
  const e = result.expected.metrics
  const r = result.robust.metrics
  const por = result.price_of_robustness
  const share = e.expected !== 0 ? por / Math.abs(e.expected) : null
  const note = (
    <>
      Риск убытка — {pct(r.p_loss)} вместо {pct(e.p_loss)}. При корреляции цен ρ = {num(result.market_corr, 2)} диверсификация
      снижает σ с {money(e.std)} до {money(r.std)}.
    </>
  )
  return (
    <section className="dk-card opt-por dk-rise" style={rise(3)} aria-labelledby="opt-por-title">
      <p className="text-caps opt-eyebrow" id="opt-por-title">
        Цена робастности
        <InfoTip id="opt.price_of_robustness" values={porValues(result)['opt.price_of_robustness']} note={note} />
      </p>
      <p className="dk-kpi__value dk-kpi__value--md opt-por__value num">{money(por)}</p>
      <p className="opt-por__text">
        {share != null ? `${pct(share)} ожидаемой прибыли «макс. E» — ` : ''}плата за худший сценарий{' '}
        <span className="num">{money(r.worst_case)}</span> вместо <span className="num">{money(e.worst_case)}</span>
      </p>
    </section>
  )
}
