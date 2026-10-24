/**
 * KPI построенного плана (X2 «ответ сначала»): вердикт одной строкой, затем ярус A — герой «Длина
 * расписания E[Cmax]» с хвостом риска (дет. · CVaR · худший · N), «OTD» с хвостом просрочки и «Минимум
 * кассы» по единому исходу кассы (cashOutcome: не считалась · считается · есть · не рассчитана);
 * ярус C — остальные показатели одной свёрнутой таблицей (KpiTable). Норма — нейтрально, отклонение —
 * глиф + слово. Каждый показатель — с «i»; числа — только через format.ts.
 */
import type { CashLpResult, ScheduleResult } from '../../lib/api'
import { freqText, hours, money, num } from '../../explain/format'
import { Chip } from '../../ui/kit'
import { Meter, RangeStrip, type RangeMark } from '../../ui/charts'
import { KpiTable } from './KpiTable'
import { FmtValue, Tile, Value } from './kpiParts'
import { cashOutcome } from './cashOutcome'
import { kpiOf } from './types'
import { cvarName, planVerdict, tailShare } from './verdict'
import './kpi.css'

const OTD_FULL = 0.99
const OTD_WARN = 0.9

export interface PlanKpisProps {
  result: ScheduleResult
  /** Касса под этот план (слой F); null — ещё не считалась. */
  cash: CashLpResult | null
  cashRunning: boolean
  cashError: string | null
  /** Переход к секции кассы (там — расчёт и подробности). */
  onGoCash: () => void
}

/** Вердикт: одна строка, отклонения — ▲ + слово, норма — нейтрально. */
export function PlanVerdict({ result }: { result: ScheduleResult }) {
  const parts = planVerdict(result)
  return (
    <p className="pl-verdict" aria-label="Вердикт плана">
      {parts.map((p, i) => (
        <span key={p.key} className={p.warn ? 'pl-verdict__warn' : undefined}>
          {p.warn && <span className="glyph-setup" aria-hidden="true" />}{p.text}{i < parts.length - 1 ? '; ' : ''}
        </span>
      ))}
    </p>
  )
}

function TailCaption({ result }: { result: ScheduleResult }) {
  const k = kpiOf(result)
  const name = cvarName(result.alpha)
  const marks: RangeMark[] = [
    { key: 'det', value: k.makespan, label: 'детерминированное (Гант)', glyph: 'ring', tone: 'idle' },
    { key: 'mean', value: k.makespan_mean, label: 'E[Cmax]', glyph: 'dot', tone: 'accent' },
    { key: 'cvar', value: k.makespan_cvar, label: name, glyph: 'triangle', tone: 'warn' },
    { key: 'worst', value: k.makespan_worst, label: 'худший прогон', glyph: 'square', tone: 'danger' },
  ]
  return (
    <div className="pl-tail">
      <RangeStrip marks={marks} fmt={(v) => num(v, 1)} zone={k.makespan_worst > k.makespan_cvar ? [k.makespan_cvar, k.makespan_worst] : undefined}
        zoneLabel={`хвост ${name}…худший`}
        ariaLabel={`Длина расписания: детерминированная ${hours(k.makespan)}, E ${hours(k.makespan_mean)}, ${name} ${hours(k.makespan_cvar)}, худший ${hours(k.makespan_worst)}`} />
      <p className="pl-tail__cap num">
        <span className="glyph-idle">дет. {num(k.makespan, 1)}</span> · <span className="pl-tail__key">E {num(k.makespan_mean, 1)}</span> ·{' '}
        <span className="glyph-setup">{name} {num(k.makespan_cvar, 0)}</span> · <span className="glyph-down">худший {hours(k.makespan_worst, 0)}</span> · N = {num(result.samples, 0)} прогонов
      </p>
      <p className="pl-tile__sub">{name} — среднее {tailShare(result.alpha)} худших сценариев (разброс исходов, не ДИ оценки)</p>
    </div>
  )
}

function CashTile({ cash, outcome, onGoCash }: { cash: CashLpResult | null; outcome: ReturnType<typeof cashOutcome>; onGoCash: () => void }) {
  if (outcome === 'ok' && cash) {
    const w = cash.waterfall?.lp_recourse ?? cash.waterfall?.rule
    const cfar = w?.cfar ?? cash.cfar
    const pBreach = w?.p_breach ?? cash.p_negative_cash
    const negative = (cfar ?? 0) < 0
    return (
      <Tile metric="cash.cfar" label={`Минимум кассы · ${cvarName(cash.beta)}`} span="s3"
            values={{ cfar, beta: cash.beta, n: cash.n_scenarios, ci_lo: w?.cfar_ci?.[0], ci_hi: w?.cfar_ci?.[1] }}
            status={negative ? <Chip tone="bad">разрыв в хвосте</Chip> : undefined}>
        <FmtValue text={money(cfar)} />
        <div className="pl-tile__sub">
          {w?.cfar_ci && <>ДИ оценки 95 % <span className="num">[{money(w.cfar_ci[0])}; {money(w.cfar_ci[1])}]</span> · </>}N = {num(cash.n_scenarios, 0)}
        </div>
        <div className="pl-tile__sub">
          разрыв кассы — {freqText(pBreach)} сценариев · <button type="button" className="pf-link" onClick={onGoCash}>касса ↓</button>
        </div>
      </Tile>
    )
  }
  const text = outcome === 'running' ? 'Считаем кассу…'
    : outcome === 'failed' ? 'Решатель не дал оптимума — подробности и повтор в разделе «Касса».'
      : 'Касса под этот план ещё не считалась.'
  return (
    <div className="pl-tile pl-tile--s3 pl-tile--empty" role="group" aria-label="Минимум кассы">
      <div className="pl-tile__k"><span className="pl-tile__label text-caps">Минимум кассы</span></div>
      {outcome === 'failed' && <span className="pl-tile__state glyph-setup">не рассчитано</span>}
      <p className="pl-tile__sub">{text}</p>
      <div className="pl-tile__foot"><button type="button" className="pf-link" onClick={onGoCash}>{outcome === 'none' ? 'к расчёту кассы ↓' : 'касса ↓'}</button></div>
    </div>
  )
}

export function PlanKpis({ result, cash, cashRunning, cashError, onGoCash }: PlanKpisProps) {
  const k = kpiOf(result)
  const n = result.n_orders
  const onTime = Math.max(0, n - k.n_late)
  const horizon = result.portfolio_horizon_hours ?? 0
  const beyond = horizon > 0 && k.makespan_cvar > horizon
  const full = k.otd >= OTD_FULL
  const outcome = cashOutcome(cash, cashRunning, cashError)

  return (
    <div className="pl-kpi">
      <PlanVerdict result={result} />
      <div className="pl-bento pl-bento--tier-a">
        <Tile metric="plan.makespan" label="Длина расписания · E[Cmax]" span="s5" hero
              values={{ mean: k.makespan_mean, det: k.makespan, n: result.samples }}
              status={beyond ? <Chip tone="bad" title={`Горизонт Стадии 2: ${hours(horizon, 0)}`}>за горизонтом Стадии 2</Chip> : undefined}>
          <FmtValue text={hours(k.makespan_mean)} />
          <TailCaption result={result} />
        </Tile>

        <Tile metric="plan.otd" label="Заказы в срок · OTD" span="s4" values={{ otd: k.otd, n, n_late: k.n_late }}
              status={full ? <Chip><span aria-hidden="true">●</span> все в срок</Chip> : <Chip tone={k.otd >= OTD_WARN ? 'warn' : 'bad'}>есть опоздания</Chip>}>
          <Value text={num(k.otd * 100, full ? 0 : 1)} unit="%" />
          <Meter value={k.otd} tone={full ? 'neutral' : k.otd >= OTD_WARN ? 'warn' : 'danger'} className="pl-tile__meter" />
          <div className="pl-tile__sub">
            в хвосте ({cvarName(result.alpha)}) просрочка <span className="num">{hours(k.tardiness_cvar, 0)}</span> ·{' '}
            <span className="num">{num(onTime, 0)}</span> из {num(n, 0)} заказов в срок
          </div>
        </Tile>

        <CashTile cash={cash} outcome={outcome} onGoCash={onGoCash} />
      </div>

      <KpiTable result={result} />
    </div>
  )
}
