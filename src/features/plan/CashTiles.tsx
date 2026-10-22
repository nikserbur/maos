/**
 * Плитки кассы в результате плана (UX-V2 §4.4 п. 3): CVaR минимума кассы (CFaR) рядом с
 * «Длиной расписания», P(разрыв) с интервалом Уилсона, DSCR, пик долга; мини-кривая «цены
 * ликвидности» PoL(L_min) и карточка траншей кредитной линии (решение блока [4]). Данные —
 * POST /api/optimize/cash с `schedule_ref_id` текущего плана (профиль отгрузок из расписания).
 * Без результата — честное состояние с кнопкой запуска, не скрытая плитка.
 */
import type { CashLpResult } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { Chip } from './ui'
import { FmtValue, SubLabel, Tile, Value } from './kpiParts'
import type { Tone } from './types'
import './kpi.css'
import './plan-screen.css'

interface CashTilesProps {
  cash: CashLpResult | null
  running: boolean
  error: string | null
  onRun: () => void
  /** Откуда профиль отгрузок: план (schedule_ref_id) или равномерный [К]. */
  scheduleRefId?: string | null
}

const THR = { breachWarn: 0.05, breachBad: 0.15, debtWarn: 0.7, debtBad: 0.9 }
const breachTone = (p: number): Tone => (p < THR.breachWarn ? 'good' : p < THR.breachBad ? 'warn' : 'bad')
const dscrTone = (v: number, cov: number): Tone => (v >= cov ? 'good' : v >= 1 ? 'warn' : 'bad')

/** Мини-кривая PoL(L): ось L_min → цена ликвидности; неразрешимые точки — штрих. */
function PolCurve({ points, current }: { points: NonNullable<CashLpResult['pol_curve']>; current: number }) {
  const ok = points.filter((p) => p.status === 'optimal' && typeof p.pol === 'number')
  if (ok.length < 2) return <p className="pl-note">Кривая цены ликвидности не построена (pol_curve выключен или одна точка).</p>
  const W = 260, H = 84, PL = 8, PR = 8, PT = 10, PB = 18
  const xs = points.map((p) => p.l_min)
  const lo = Math.min(...xs), hi = Math.max(...xs)
  const ys = ok.map((p) => p.pol as number)
  const ylo = Math.min(0, ...ys), yhi = Math.max(...ys) || 1
  const X = (l: number) => PL + ((l - lo) / Math.max(1e-9, hi - lo)) * (W - PL - PR)
  const Y = (v: number) => PT + (1 - (v - ylo) / Math.max(1e-9, yhi - ylo)) * (H - PT - PB)
  const line = ok.map((p) => `${X(p.l_min).toFixed(1)},${Y(p.pol as number).toFixed(1)}`).join(' ')
  const ci = ok.filter((p) => p.pol_ci).map((p) => ({ x: X(p.l_min), lo: Y(p.pol_ci![0]), hi: Y(p.pol_ci![1]) }))
  const band = ci.length > 1 ? `${ci.map((c) => `${c.x.toFixed(1)},${c.hi.toFixed(1)}`).join(' ')} ${[...ci].reverse().map((c) => `${c.x.toFixed(1)},${c.lo.toFixed(1)}`).join(' ')}` : ''
  const infeasible = points.filter((p) => p.status !== 'optimal')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="pl-pol" role="img"
         aria-label={`Цена ликвидности по L_min: от ${money(ok[0].pol as number)} при ${money(ok[0].l_min)} до ${money(ok[ok.length - 1].pol as number)} при ${money(ok[ok.length - 1].l_min)}`}>
      {band && <polygon className="pl-pol__ci" points={band} />}
      <polyline className="pl-pol__line" points={line} />
      {ok.map((p) => <circle key={p.l_min} className="pl-pol__dot" cx={X(p.l_min)} cy={Y(p.pol as number)} r={2.5} />)}
      {infeasible.length > 0 && <rect className="pl-pol__inf" x={X(Math.min(...infeasible.map((p) => p.l_min)))} y={PT} width={Math.max(4, W - PR - X(Math.min(...infeasible.map((p) => p.l_min))))} height={H - PT - PB} />}
      <line className="pl-pol__cur" x1={X(current)} x2={X(current)} y1={PT} y2={H - PB} />
      <text className="pl-pol__tick" x={PL} y={H - 5}>L_min {money(lo)}</text>
      <text className="pl-pol__tick" x={W - PR} y={H - 5} textAnchor="end">{money(hi)}{infeasible.length ? ' · неразрешимо' : ''}</text>
    </svg>
  )
}

export function CashTiles({ cash, running, error, onRun, scheduleRefId }: CashTilesProps) {
  if (!cash) {
    return (
      <div className="pl-cash-empty">
        <div>
          <p className="pl-cash-empty__t">Касса под этот план ещё не считалась</p>
          <p className="pl-note">
            CVaR-LP с кассой возьмёт те же сценарии цен, что портфель (CRN), профиль отгрузок —
            {scheduleRefId ? ' из этого расписания' : ' равномерный [К] (нет опорного плана)'}; ответ — CFaR, P(разрыва), DSCR, транши и цена ликвидности.
            Считается ~2–15 с (HiGHS).
          </p>
          {error && <p className="pl-note" style={{ color: 'var(--intent-danger)' }}>{error}</p>}
        </div>
        <button type="button" className="btn btn--primary" onClick={onRun} disabled={running}>{running ? 'Считаем кассу…' : 'Рассчитать кассу'}</button>
      </div>
    )
  }
  const w = cash.waterfall?.lp_recourse ?? cash.waterfall?.rule
  const covenant = 1.2
  const pol = cash.price_of_liquidity
  const tr = cash.tranches
  const weeks = tr?.drawdown?.p50?.length ?? 0
  const firstDraw = tr?.drawdown?.p50?.findIndex((v) => v > 0) ?? -1
  return (
    <div className="pl-bento pl-bento--cash">
      <Tile metric="cash.cfar" label={`Минимальный остаток кассы · CVaR β = ${pct(cash.beta, 0)}`} span="s5" hero
            values={{ cfar: w?.cfar, beta: cash.beta, n: cash.n_scenarios, ci_lo: w?.cfar_ci?.[0], ci_hi: w?.cfar_ci?.[1] }}
            status={<Chip tone={(w?.cfar ?? 0) >= 0 ? 'good' : 'bad'}>{(w?.cfar ?? 0) >= 0 ? 'касса не уходит ниже нуля' : 'в хвосте касса отрицательна'}</Chip>}>
        <FmtValue text={money(w?.cfar ?? cash.cfar)} />
        <div className="pl-tile__sub">
          медиана минимума <span className="num">{money(w?.cash_min_p50)}</span>
          {w?.cfar_ci && <> · ДИ 95 % <span className="num">[{money(w.cfar_ci[0])}; {money(w.cfar_ci[1])}]</span></>}
        </div>
        <div className="pl-tile__div" />
        <div className="pl-tile__k">
          <SubLabel metric="cash.p_breach" label="Вероятность кассового разрыва"
                    values={{ p: w?.p_breach, ci_lo: w?.p_breach_ci?.[0], ci_hi: w?.p_breach_ci?.[1], warn: THR.breachWarn, bad: THR.breachBad }} />
          {w && <Chip tone={breachTone(w.p_breach)}>{w.p_breach < THR.breachWarn ? 'в норме' : w.p_breach < THR.breachBad ? 'внимание' : 'критично'}</Chip>}
        </div>
        <FmtValue text={pct(w?.p_breach ?? cash.p_negative_cash, 1)} size="md" />
        <div className="pl-tile__sub">
          {w?.p_breach_ci && <>Уилсон 95 % <span className="num">[{pct(w.p_breach_ci[0], 1)}; {pct(w.p_breach_ci[1], 1)}]</span> · </>}
          {w && w.p_breach > 0 ? <>первый разрыв не позже <span className="num">{num(w.t_breach_p10, 0)}-й</span> недели (p10)</> : 'разрывов в сценариях нет'}
        </div>
      </Tile>

      <Tile metric="cash.dscr_min_p05" label="DSCR · 5 % квантиль" values={{ dscr: w?.dscr_min_p05, covenant, p_cov: w?.p_covenant }}
            status={w && <Chip tone={dscrTone(w.dscr_min_p05, covenant)}>{w.dscr_min_p05 >= covenant ? 'ковенант соблюдён' : 'ниже ковенанта'}</Chip>}>
        <Value text={num(Math.min(9999, w?.dscr_min_p05 ?? 0), 1)} />
        <div className="pl-tile__sub">ковенант <span className="num">{num(covenant, 1)}</span> · P(нарушение) <span className="num">{pct(w?.p_covenant ?? 0, 1)}</span></div>
      </Tile>

      <Tile metric="cash.debt_peak" label="Пик кредитной линии" span="s4"
            values={{ peak: w?.debt_peak, share: w?.debt_peak_share, limit: cash.duals?.credit_limit }}
            status={w && <Chip tone={w.debt_peak_share < THR.debtWarn ? 'good' : w.debt_peak_share < THR.debtBad ? 'warn' : 'bad'}>{pct(w.debt_peak_share, 0)} лимита</Chip>}>
        <FmtValue text={money(w?.debt_peak)} />
        <div className="pl-tile__sub">проценты за горизонт <span className="num">{money(w?.int_cost)}</span> · ставка <span className="num">{pct(cash.weekly_rate * 52, 1)}</span></div>
      </Tile>

      <Tile metric="cash.pol" label="Цена ликвидности · PoL(L_min)" span="s7"
            values={{ pol: pol?.value, ci_lo: pol?.ci?.[0], ci_hi: pol?.ci?.[1], pol_obj: pol?.objective_delta, dual: pol?.local_dual }}
            status={<Chip tone={cash.duals?.liquidity_binding ? 'warn' : 'good'}>{cash.duals?.liquidity_binding ? 'ограничение активно' : 'ограничение не связывает'}</Chip>}>
        <div className="pl-tile__pair">
          <div>
            <FmtValue text={money(pol?.value ?? 0)} />
            <div className="pl-tile__sub">
              {pol?.ci && <>ДИ <span className="num">[{money(pol.ci[0])}; {money(pol.ci[1])}]</span> · </>}по критерию <span className="num">{money(pol?.objective_delta ?? 0)}</span> · L_min <span className="num">{money(cash.l_min)}</span>
            </div>
          </div>
          <div className="pl-pol-wrap">{cash.pol_curve ? <PolCurve points={cash.pol_curve} current={cash.l_min} /> : <p className="pl-note">Кривая не запрашивалась (pol_curve).</p>}</div>
        </div>
      </Tile>

      <Tile metric="cash.int_cost" label="Транши кредитной линии" span="s5" values={{ int: w?.int_cost, rate: cash.weekly_rate * 52 }}
            status={<Chip>{cash.financing_stage === 'recourse' ? 'рекурс d_i,t' : 'график заранее d_t'}</Chip>}>
        {tr && weeks > 0 ? (
          <>
            <div className="pl-tranche" role="img" aria-label={`Медианный долг по неделям: ${tr.debt.p50.map((v) => money(v)).join(', ')}`}>
              {tr.debt.p50.map((v, t) => {
                const mx = Math.max(1e-9, ...tr.debt.p95)
                return (
                  <span key={t} className="pl-tranche__col" title={`неделя ${t + 1}: долг p50 ${money(v)} · p95 ${money(tr.debt.p95[t])} · транш p50 ${money(tr.drawdown.p50[t])}`}>
                    <i className="pl-tranche__p95" style={{ height: `${(tr.debt.p95[t] / mx) * 100}%` }} />
                    <i className="pl-tranche__p50" style={{ height: `${(v / mx) * 100}%` }} />
                  </span>
                )
              })}
            </div>
            <div className="pl-tile__sub">
              {firstDraw >= 0 ? <>первый транш — неделя <span className="num">{firstDraw + 1}</span>, медиана <span className="num">{money(tr.drawdown.p50[firstDraw])}</span></> : 'транши в медианном сценарии не нужны'}
              {' '}· {weeks} нед · {cash.n_scenarios} сценариев · HiGHS {num(cash.solve_ms, 0)} мс
            </div>
          </>
        ) : <p className="pl-note">Транши не возвращены.</p>}
        <div className="pl-tile__sub">
          профиль отгрузок: {cash.shipment_profile.source === 'plan' ? `из плана (${cash.shipment_profile.products_from_plan} изделий)` : 'равномерный [К]'}
          {cash.key_rate && <> · ставка линии: {cash.key_rate.source === 'MacroSampler' ? 'генератор по сценарию' : 'fin_params (константа)'}</>}
          <InfoTip id="cash.npv" values={{ npv_o: w?.npv_owner_mean, p_neg: w?.p_npv_owner_neg, npv_b: w?.npv_bank_mean }} />
        </div>
      </Tile>
    </div>
  )
}
