/**
 * KPI построенного плана в трёх ярусах (X1 §5.1): ярус A — три плитки-героя «Длина расписания
 * E[Cmax] + хвост», «OTD», «CFaR кассы»; ярус C — остальные показатели одной свёрнутой таблицей
 * «показатель · значение · контекст» (KpiTable). Каждый показатель — с «i» (metrics.plan.ts),
 * значения — из живых полей ответа /api/schedule; ничего не удалено — свёрнуто.
 */
import type { CashLpResult, ScheduleResult } from '../../lib/api'
import { hours, money, num, pct } from '../../explain/format'
import { KpiTable } from './KpiTable'
import { Chip } from './ui'
import { FmtValue, TailStrip, Tile, Value } from './kpiParts'
import { kpiOf, type Tone } from './types'
import './kpi.css'

const OTD_GOOD = 0.99
const OTD_WARN = 0.9
const BREACH_WARN = 0.05
const BREACH_BAD = 0.15

const otdTone = (otd: number): Tone => (otd >= OTD_GOOD ? 'good' : otd >= OTD_WARN ? 'warn' : 'bad')
const breachTone = (p: number): Tone => (p < BREACH_WARN ? 'good' : p < BREACH_BAD ? 'warn' : 'bad')

export interface PlanKpisProps {
  result: ScheduleResult
  /** Касса под этот план (слой F); null — ещё не считалась. */
  cash: CashLpResult | null
  cashRunning: boolean
  /** Переход к секции кассы (там — единственная primary-кнопка расчёта). */
  onGoCash: () => void
}

export function PlanKpis({ result, cash, cashRunning, onGoCash }: PlanKpisProps) {
  const k = kpiOf(result)
  const n = result.n_orders
  const horizon = result.portfolio_horizon_hours ?? 0
  const tailPct = k.makespan_mean > 0 ? k.makespan_cvar / k.makespan_mean - 1 : 0
  const w = cash?.waterfall?.lp_recourse ?? cash?.waterfall?.rule
  const cfar = w?.cfar ?? cash?.cfar
  const pBreach = w?.p_breach ?? cash?.p_negative_cash

  const cvarChip = horizon > 0
    ? (k.makespan_cvar > horizon
      ? <Chip tone="bad" title={`Горизонт Стадии 2: ${hours(horizon, 0)}`}>не вписывается в горизонт</Chip>
      : <Chip tone="good" title={`Горизонт Стадии 2: ${hours(horizon, 0)}`}>в горизонте Стадии 2</Chip>)
    : <Chip tone="accent">хвост +{pct(tailPct, 0)} к E</Chip>

  return (
    <div className="pl-kpi">
      <div className="pl-bento pl-bento--tier-a">
        <Tile metric="plan.makespan" label="Длина расписания · E[Cmax]" span="s5" hero
              values={{ mean: k.makespan_mean, det: k.makespan, n: result.samples }}
              status={<Chip title={`${num(result.samples, 0)} прогонов Монте-Карло — хвост длительностей`}>Монте-Карло</Chip>}>
          <FmtValue text={hours(k.makespan_mean)} />
          <TailStrip det={k.makespan} mean={k.makespan_mean} cvar={k.makespan_cvar} worst={k.makespan_worst} />
          <div className="pl-tile__foot">{cvarChip}</div>
        </Tile>

        <Tile metric="plan.otd" label="Заказы в срок · OTD" span="s4" values={{ otd: k.otd, n, n_late: k.n_late }}
              status={<Chip tone={otdTone(k.otd)}>{k.otd >= OTD_GOOD ? 'все в срок' : 'есть опоздания'}</Chip>}>
          <Value text={num(k.otd * 100, k.otd >= OTD_GOOD ? 0 : 1)} unit="%" />
          <div className="pl-meter" aria-hidden="true">
            <span className={`pl-meter__fill${otdTone(k.otd) === 'good' ? '' : ` pl-meter__fill--${otdTone(k.otd)}`}`}
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, k.otd))})` }} />
          </div>
          <div className="pl-tile__sub">
            {k.n_late > 0
              ? <>с опозданием <span className="num">{num(k.n_late, 0)}</span> из {num(n, 0)} заказов</>
              : <>все <span className="num">{num(n, 0)}</span> заказов в срок</>}
          </div>
        </Tile>

        {cash && w ? (
          <Tile metric="cash.cfar" label={`Минимум кассы · CFaR β = ${pct(cash.beta, 0)}`} span="s3"
                values={{ cfar, beta: cash.beta, n: cash.n_scenarios, ci_lo: w.cfar_ci?.[0], ci_hi: w.cfar_ci?.[1] }}
                status={<Chip tone={(cfar ?? 0) >= 0 ? 'good' : 'bad'}>{(cfar ?? 0) >= 0 ? 'касса ≥ 0' : 'разрыв в хвосте'}</Chip>}>
            <FmtValue text={money(cfar)} />
            <div className="pl-tile__sub">
              P(разрыва) <span className={`num ${breachTone(pBreach ?? 0) === 'good' ? '' : `glyph-${breachTone(pBreach ?? 0) === 'warn' ? 'setup' : 'down'}`}`}>{pct(pBreach, 1)}</span>
              {' '}· <button type="button" className="pf-link" onClick={onGoCash}>касса ↓</button>
            </div>
          </Tile>
        ) : (
          <div className="pl-tile pl-tile--s3 pl-tile--empty" role="group" aria-label="Касса под этот план">
            <div className="pl-tile__k"><span className="pl-tile__label text-caps">Минимум кассы · CFaR</span></div>
            <p className="pl-tile__sub">{cashRunning ? 'Считаем кассу (HiGHS)…' : 'Касса под этот план ещё не считалась: CVaR-LP с профилем отгрузок из расписания.'}</p>
            <div className="pl-tile__foot"><button type="button" className="btn btn--sm" onClick={onGoCash} disabled={cashRunning}>к расчёту кассы ↓</button></div>
          </div>
        )}
      </div>

      <KpiTable result={result} />
    </div>
  )
}
