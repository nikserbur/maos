/**
 * ГА поверх диспетч-правила (Стадия 1): выигрыш на отложенных сценариях, кривая
 * сходимости против базовой линии правила и найденное составное правило формулой.
 */
import type { SchedImprover } from '../../lib/api'
import { hours, num } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { Chip } from '../../ui/kit'

/** Координата SVG с точностью 0,1 px (без toFixed — числа только через format.ts). */
const px = (v: number) => Math.round(v * 10) / 10

const CRITERIA: ReadonlyArray<[keyof NonNullable<SchedImprover['weights']>, string]> = [
  ['due', 'срок'], ['rem', 'остаток'], ['duration', 'длительность'], ['inputs', 'входы'], ['setup', 'наладка'],
]

const STOP_LABEL: Record<NonNullable<SchedImprover['stopped']>, string> = {
  generations: 'лимит поколений',
  stall: 'нет улучшений',
  time: 'лимит времени',
}

/** Слагаемые формулы ключа по убыванию |w|; веса ≈ 0 опускаются. */
function formulaTerms(w: NonNullable<SchedImprover['weights']>) {
  return CRITERIA
    .map(([k, label]) => ({ label, w: w[k] }))
    .filter((t) => Math.abs(t.w) >= 0.005)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
}

function Convergence({ history, baseline }: { history: NonNullable<SchedImprover['history']>; baseline: number }) {
  if (history.length < 2) return null
  const W = 240
  const H = 72
  const values = [baseline, ...history.map((h) => h.best)]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const x = (g: number) => (g / Math.max(1, history.length - 1)) * W
  const y = (v: number) => 4 + (1 - (v - lo) / span) * (H - 8)
  const best = history.map((h, i) => `${px(x(i))},${px(y(h.best))}`).join(' ')
  return (
    <figure className="pl-ga__chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label={`Сходимость ГА: F от ${num(history[0].best, 0)} до ${num(history[history.length - 1].best, 0)}`}>
        <line className="pl-ga__base" x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} />
        <polyline className="pl-ga__best" points={best} />
      </svg>
      <figcaption className="pl-ga__legend">
        <span><i className="pl-ga__key pl-ga__key--best" />лучшее F по поколениям</span>
        <span><i className="pl-ga__key pl-ga__key--base" />правило</span>
      </figcaption>
    </figure>
  )
}

export function GaImproverCard({ imp, rule }: { imp: SchedImprover; rule: string }) {
  const val = imp.validation
  if (imp.method !== 'ga' || !val) return null
  const adopted = imp.adopted === true
  const terms = imp.weights ? formulaTerms(imp.weights) : []
  const gens = imp.iterations
  const mkRule = imp.makespan_mean_rule
  const mkFinal = imp.makespan_mean_final
  return (
    <section className={`pl-ga${adopted ? '' : ' pl-ga--kept'}`} aria-labelledby="pl-ga-title">
      <div className="pl-ga__main">
        <div className="pl-ga__eyebrow text-caps" id="pl-ga-title">
          Генетический алгоритм поверх правила {rule}
          <InfoTip id="plan.ga" values={{ val: val.improvement_pct / 100, nv: val.scenarios, gens }} />
        </div>
        {adopted ? (
          <p className="pl-ga__headline">
            <span className="pl-ga__big num">−{num(val.improvement_pct, 1)}<span className="unit"> %</span></span>
            <span>целевой функции F на {val.scenarios} отложенных сценариях — план построен по найденному правилу</span>
          </p>
        ) : (
          <p className="pl-ga__headline">
            <span className="pl-ga__big">оставлено {rule}</span>
            <span>кандидат ГА не лучше правила на отложенных сценариях — принимать подгонку под выборку нельзя</span>
          </p>
        )}
        {adopted && terms.length > 0 && (
          <p className="pl-ga__formula num" aria-label="Найденное правило приоритета">
            ключ = {terms.map((t, i) => (
              <span key={t.label}>
                {i === 0 ? (t.w < 0 ? '−' : '') : (t.w < 0 ? ' − ' : ' + ')}
                {num(Math.abs(t.w), 2)}·{t.label}
              </span>
            ))}
            <span> + δ<sub>заказа</sub></span>
          </p>
        )}
        <div className="pl-bn__chips">
          {adopted && <Chip tone="good">обучение −{num(imp.improvement_pct, 1)} % · {imp.train_scenarios} сценариев</Chip>}
          {adopted && mkRule !== undefined && mkFinal !== undefined && (
            <Chip tone="accent">E[Cmax] {hours(mkRule, 0)} → {hours(mkFinal, 0)}</Chip>
          )}
          <Chip>{gens} поколений × {imp.population ?? '—'} · {num(imp.evaluations ?? 0, 0)} оценок</Chip>
          {imp.stopped && <Chip tone="idle">остановка: {STOP_LABEL[imp.stopped]}</Chip>}
        </div>
      </div>
      {imp.history && <Convergence history={imp.history} baseline={imp.score_before} />}
    </section>
  )
}
