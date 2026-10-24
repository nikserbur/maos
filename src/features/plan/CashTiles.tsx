/**
 * Раздел «Касса под этот план» (UX-V2 §4.4 п. 3; X2 «честные состояния»): строка управления —
 * «Финансирование» и «Рассчитать кассу» (единственная primary раздела); исход по одному селектору
 * cashOutcome: не считалась · считается (прогресс с временем, фазой и «Отменить») · не рассчитана
 * (▲ словами, «Повторить», «Подробнее» — статус, причина, время решателя) · есть: минимум кассы с ДИ
 * и N, разрыв как частота, DSCR, пик долга, недельный веер P5–P50–P95, транши и цена ликвидности.
 * Норма — нейтрально, отклонения — глиф + слово. Данные — POST /api/optimize/cash с профилем
 * отгрузок этого расписания (schedule_ref_id).
 */
import { useEffect, useState } from 'react'
import type { CashLpResult } from '../../lib/api'
import { financingLabel } from '../../explain/labels'
import { freqText, money, num, pct } from '../../explain/format'
import { CASH_PHASES, RunProgress } from '../../ui/RunProgress'
import { InlineError, Segmented, StatusChip } from '../../ui/kit'
import { InfoTip } from '../../ui/InfoTip'
import { cancelCash } from '../finance/cashStore'
import { CashFan, PolCurve, TrancheChart } from './CashCharts'
import { cashEtaSeconds, cashFailDetail, cashFailHint, cashFailTitle, cashOutcome } from './cashOutcome'
import { FmtValue, SubLabel, Tile, Value } from './kpiParts'
import { cvarName } from './verdict'
import './kpi.css'
import './plan-screen.css'

type Financing = 'recourse' | 'first'

interface CashTilesProps {
  cash: CashLpResult | null
  running: boolean
  error: string | null
  onRun: (financing: Financing) => void
  /** Финансирование по умолчанию — из параметров прогона. */
  financing: Financing
  /** Откуда профиль отгрузок: план (schedule_ref_id) или равномерный. */
  scheduleRefId?: string | null
  /** Кнопка расчёта — primary раздела; false — если primary занята («Пересчитать с правками»). */
  primary?: boolean
}

const THR = { breachWarn: 0.05, breachBad: 0.15, debtWarn: 0.7, debtBad: 0.9 }
/** Порог ковенанта DSCR (норматив кредитного договора, паспорт fin_params). */
const COVENANT = 1.2
/** Выше этого DSCR показываем «≫ ковенант» — число не читается как сумма. */
const DSCR_SHOW_MAX = 99

function CashControls({ fin, setFin, onRun, running, primary, done }: { fin: Financing; setFin: (f: Financing) => void; onRun: () => void; running: boolean; primary: boolean; done: boolean }) {
  return (
    <div className="pl-cash-ctl">
      <span className="pl-cash-ctl__k text-caps">Финансирование</span>
      <Segmented label="Финансирование кассы" size="sm" fit value={fin} onChange={setFin}
        options={[{ id: 'recourse', label: financingLabel('recourse') }, { id: 'first', label: financingLabel('first') }]} />
      <span className="pl-note">критерий — CVaR прибыли при ограничении «касса ≥ L_min»</span>
      <span className="pl-cash-ctl__spacer" />
      <button type="button" className={`btn${primary ? ' btn--primary' : ''}`} onClick={onRun} aria-disabled={running}>
        {running ? 'Считаем кассу…' : done ? 'Пересчитать кассу' : 'Рассчитать кассу'}
      </button>
    </div>
  )
}

export function CashTiles({ cash, running, error, onRun, financing, scheduleRefId, primary = true }: CashTilesProps) {
  const [fin, setFin] = useState<Financing>(financing)
  useEffect(() => { setFin(financing) }, [financing])
  const outcome = cashOutcome(cash, running, error)
  const run = () => { if (!running) onRun(fin) }

  const controls = <CashControls fin={fin} setFin={setFin} onRun={run} running={running} primary={primary} done={outcome === 'ok'} />
  if (outcome === 'running') {
    return (
      <div className="pl-cash">
        {controls}
        <div className="pl-cash-run">
          <RunProgress phases={CASH_PHASES} running etaSeconds={cashEtaSeconds(cash?.n_scenarios)} title="Считаем кассу (ЛП, HiGHS)" />
          <button type="button" className="btn btn--sm" onClick={cancelCash}>Отменить</button>
        </div>
      </div>
    )
  }
  if (outcome === 'failed') {
    return (
      <div className="pl-cash">
        {controls}
        <InlineError tone="warn" title={cashFailTitle(cash, error)} message={cashFailHint(cash, error)} detail={cashFailDetail(cash, error)} onRetry={run} />
      </div>
    )
  }
  if (outcome === 'none' || !cash) {
    return (
      <div className="pl-cash">
        {controls}
        <p className="pl-note">
          Касса под этот план ещё не считалась: те же сценарии цен, что у портфеля, профиль отгрузок —
          {scheduleRefId ? ' из этого расписания' : ' равномерный (нет опорного плана)'}. Обычно 2–15 с.
        </p>
      </div>
    )
  }
  return <div className="pl-cash">{controls}<CashResultTiles cash={cash} /></div>
}

function CashResultTiles({ cash }: { cash: CashLpResult }) {
  const w = cash.waterfall?.lp_recourse ?? cash.waterfall?.rule
  const dscr = w?.dscr_min_p05 ?? Number.NaN
  const pol = cash.price_of_liquidity
  const tr = cash.tranches
  const weeks = tr?.drawdown?.p50?.length ?? 0
  const firstDraw = tr?.drawdown?.p50?.findIndex((v) => v > 0) ?? -1
  const pBreach = w?.p_breach ?? cash.p_negative_cash
  const breachState = pBreach >= THR.breachBad ? 'down' : pBreach >= THR.breachWarn ? 'setup' : null
  const debtState = w ? (w.debt_peak_share >= THR.debtBad ? 'down' : w.debt_peak_share >= THR.debtWarn ? 'setup' : null) : null
  return (
    <div className="pl-bento pl-bento--cash">
      <Tile metric="cash.cfar" label={`Минимальный остаток кассы · ${cvarName(cash.beta)}`} span="s5"
            values={{ cfar: w?.cfar, beta: cash.beta, n: cash.n_scenarios, ci_lo: w?.cfar_ci?.[0], ci_hi: w?.cfar_ci?.[1] }}
            status={(w?.cfar ?? 0) < 0 ? <StatusChip tone="down">в хвосте касса отрицательна</StatusChip> : undefined}>
        <FmtValue text={money(w?.cfar ?? cash.cfar)} size="md" />
        <div className="pl-tile__sub">
          медиана минимума <span className="num">{money(w?.cash_min_p50)}</span>
          {w?.cfar_ci && <> · ДИ оценки 95 % <span className="num">[{money(w.cfar_ci[0])}; {money(w.cfar_ci[1])}]</span></>} · N = {num(cash.n_scenarios, 0)}
        </div>
        <div className="pl-tile__div" />
        <div className="pl-tile__k">
          <SubLabel metric="cash.p_breach" label="Кассовый разрыв"
                    values={{ p: w?.p_breach, ci_lo: w?.p_breach_ci?.[0], ci_hi: w?.p_breach_ci?.[1], warn: THR.breachWarn, bad: THR.breachBad }} />
          {breachState && <StatusChip tone={breachState}>{breachState === 'down' ? 'критично' : 'внимание'}</StatusChip>}
        </div>
        <div className="pl-tile__sub pl-tile__sub--lead">{freqText(pBreach)} сценариев</div>
        <div className="pl-tile__sub">
          {w?.p_breach_ci && <>ДИ Уилсона 95 % <span className="num">[{pct(w.p_breach_ci[0], 1)}; {pct(w.p_breach_ci[1], 1)}]</span> · </>}
          {w && w.p_breach > 0 ? <>первый разрыв не позже <span className="num">{num(w.t_breach_p10, 0)}-й</span> недели (P10)</> : 'разрывов в сценариях нет'}
        </div>
      </Tile>

      <Tile metric="cash.dscr_min_p05" label="DSCR · 5 % квантиль" values={{ dscr: w?.dscr_min_p05, covenant: COVENANT, p_cov: w?.p_covenant }}
            status={Number.isFinite(dscr) && dscr < COVENANT ? <StatusChip tone={dscr >= 1 ? 'setup' : 'down'}>ниже ковенанта</StatusChip> : undefined}>
        {dscr > DSCR_SHOW_MAX ? <Value text="≫" unit={`${num(COVENANT, 1)}× (ковенант)`} size="md" /> : <Value text={num(dscr, 1)} unit="×" size="md" />}
        <div className="pl-tile__sub">ковенант <span className="num">{num(COVENANT, 1)}×</span> · нарушение — {freqText(w?.p_covenant ?? 0)} сценариев</div>
      </Tile>

      <Tile metric="cash.debt_peak" label="Пик кредитной линии" span="s4" values={{ peak: w?.debt_peak, share: w?.debt_peak_share, limit: cash.duals?.credit_limit }}
            status={debtState ? <StatusChip tone={debtState}>{pct(w?.debt_peak_share ?? 0, 0)} лимита</StatusChip> : undefined}>
        <FmtValue text={money(w?.debt_peak)} size="md" />
        <div className="pl-tile__sub">{pct(w?.debt_peak_share ?? 0, 0)} лимита · проценты за горизонт <span className="num">{money(w?.int_cost)}</span> · ставка <span className="num">{pct(cash.weekly_rate * 52, 1)}</span></div>
      </Tile>

      <Tile metric="cash.cfar" label="Остаток кассы по неделям" span="s7" values={{ cfar: w?.cfar, beta: cash.beta, n: cash.n_scenarios }}>
        {tr?.cash ? <CashFan q={tr.cash} lMin={cash.l_min} n={cash.n_scenarios} /> : <p className="pl-note">Недельный остаток кассы не возвращён сервером.</p>}
      </Tile>

      <Tile metric="cash.int_cost" label="Транши кредитной линии" span="s5" values={{ int: w?.int_cost, rate: cash.weekly_rate * 52 }}>
        {tr && weeks > 0 ? (
          <>
            <TrancheChart tr={tr} firstDraw={firstDraw} />
            <div className="pl-tile__sub">
              {firstDraw >= 0 ? <>первый транш — неделя <span className="num">{firstDraw + 1}</span>, медиана <span className="num">{money(tr.drawdown.p50[firstDraw])}</span></> : 'транши в медианном сценарии не нужны'}
              {' '}· {financingLabel(cash.financing_stage)} · решатель {num(cash.solve_ms, 0)} мс
            </div>
          </>
        ) : <p className="pl-note">Транши не возвращены.</p>}
        <div className="pl-tile__sub">
          профиль отгрузок: {cash.shipment_profile.source === 'plan' ? `из плана (${num(cash.shipment_profile.products_from_plan, 0)} изделий)` : 'равномерный'}
          {cash.key_rate && <> · ставка линии: {cash.key_rate.source === 'MacroSampler' ? 'генератор по сценарию' : 'постоянная из параметров проекта'}</>}
          <InfoTip id="cash.npv" values={{ npv_o: w?.npv_owner_mean, p_neg: w?.p_npv_owner_neg, npv_b: w?.npv_bank_mean }} />
        </div>
      </Tile>

      <Tile metric="cash.pol" label="Цена ликвидности · PoL(L_min)" span="s12"
            values={{ pol: pol?.value, ci_lo: pol?.ci?.[0], ci_hi: pol?.ci?.[1], pol_obj: pol?.objective_delta, dual: pol?.local_dual }}
            status={cash.duals?.liquidity_binding ? <StatusChip tone="setup">ограничение активно</StatusChip> : undefined}>
        <div className="pl-tile__pair">
          <div>
            <FmtValue text={money(pol?.value ?? 0)} size="md" />
            <div className="pl-tile__sub">
              {pol?.ci && <>ДИ оценки <span className="num">[{money(pol.ci[0])}; {money(pol.ci[1])}]</span> · </>}по критерию <span className="num">{money(pol?.objective_delta ?? 0)}</span> · L_min <span className="num">{money(cash.l_min)}</span>
              {!cash.duals?.liquidity_binding && ' · ограничение не связывает'}
            </div>
          </div>
          <div className="pl-pol-wrap">{cash.pol_curve ? <PolCurve points={cash.pol_curve} current={cash.l_min} /> : <p className="pl-note">Кривая не запрашивалась.</p>}</div>
        </div>
      </Tile>
    </div>
  )
}
