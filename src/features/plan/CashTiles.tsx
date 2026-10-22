/**
 * Плитки кассы в результате плана (UX-V2 §4.4 п. 3): CVaR минимума кассы (CFaR) рядом с
 * «Длиной расписания», P(разрыв) с интервалом Уилсона, DSCR, пик долга; мини-кривая «цены
 * ликвидности» PoL(L_min) и карточка траншей кредитной линии (решение блока [4]). Данные —
 * POST /api/optimize/cash с `schedule_ref_id` текущего плана (профиль отгрузок из расписания).
 * Без результата — честное состояние с кнопкой запуска, не скрытая плитка.
 * Бейджи — один `StatusChip` (цвет + глиф) вместо четырёх стилей (X1 §5 п. 11); DSCR — «×».
 */
import type { CashLpResult } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { LineChart, axisMoney } from '../../ui/charts'
import { StatusChip, type Tone as ChipTone } from '../../ui/kit'
import { InfoTip } from '../../ui/InfoTip'
import { FmtValue, SubLabel, Tile, Value } from './kpiParts'
import './kpi.css'
import './plan-screen.css'

interface CashTilesProps {
  cash: CashLpResult | null
  running: boolean
  error: string | null
  onRun: () => void
  /** Откуда профиль отгрузок: план (schedule_ref_id) или равномерный [К]. */
  scheduleRefId?: string | null
  /** Кнопка расчёта — единственная primary экрана; false — если primary уже занята («Пересчитать с правками»). */
  primary?: boolean
}

const THR = { breachWarn: 0.05, breachBad: 0.15, debtWarn: 0.7, debtBad: 0.9 }
/** Порог ковенанта DSCR (норматив кредитного договора, r-паспорт в fin_params). */
const COVENANT = 1.2
/** Выше этого DSCR показываем «≫ ковенант» — число не читается как сумма. */
const DSCR_SHOW_MAX = 99
const breachTone = (p: number): ChipTone => (p < THR.breachWarn ? 'running' : p < THR.breachBad ? 'setup' : 'down')
const dscrTone = (v: number, cov: number): ChipTone => (v >= cov ? 'running' : v >= 1 ? 'setup' : 'down')
const debtTone = (share: number): ChipTone => (share < THR.debtWarn ? 'running' : share < THR.debtBad ? 'setup' : 'down')

/**
 * Мини-кривая PoL(L_min) — `LineChart` chart-системы: ось L_min → цена ликвидности, полоса ДИ,
 * вертикальная отметка текущего L_min, первая неразрешимая точка — отметка «неразрешимо».
 */
function PolCurve({ points, current }: { points: NonNullable<CashLpResult['pol_curve']>; current: number }) {
  const sorted = points.slice().sort((a, b) => a.l_min - b.l_min)
  const ok = sorted.filter((p) => p.status === 'optimal' && typeof p.pol === 'number')
  if (ok.length < 2) return <p className="pl-note">Кривая цены ликвидности не построена (pol_curve выключен или одна точка).</p>
  const labels = sorted.map((p) => money(p.l_min))
  const values = sorted.map((p) => (p.status === 'optimal' && typeof p.pol === 'number' ? p.pol : Number.NaN))
  const hasCi = ok.some((p) => p.pol_ci)
  const band = hasCi
    ? { lo: sorted.map((p) => (p.pol_ci ? p.pol_ci[0] : Number.NaN)), hi: sorted.map((p) => (p.pol_ci ? p.pol_ci[1] : Number.NaN)), label: 'ДИ 95 %' }
    : undefined
  const curIdx = sorted.reduce((a, p, i) => (Math.abs(p.l_min - current) < Math.abs(sorted[a].l_min - current) ? i : a), 0)
  const infIdx = sorted.findIndex((p) => p.status !== 'optimal')
  return (
    <LineChart labels={labels} height={132} compact xHeader="L_min" fmtY={axisMoney} unit="₽"
      series={[{ key: 'pol', name: 'цена ликвидности', values, fmt: money, band }]}
      annotations={[
        { key: 'cur', index: curIdx, kind: 'line', label: `L_min ${money(current)}` },
        ...(infIdx >= 0 ? [{ key: 'inf', index: infIdx, kind: 'line' as const, label: 'неразрешимо' }] : []),
      ]}
      ariaLabel={`Цена ликвидности по L_min: от ${money(ok[0].pol as number)} при ${money(ok[0].l_min)} до ${money(ok[ok.length - 1].pol as number)} при ${money(ok[ok.length - 1].l_min)}`} />
  )
}

/** Транши: медианный долг по неделям — линия с полосой до p95, первый транш — точка с подписью. */
function TrancheChart({ tr, firstDraw }: { tr: NonNullable<CashLpResult['tranches']>; firstDraw: number }) {
  const weeks = tr.debt.p50.length
  const labels = Array.from({ length: weeks }, (_, t) => `нед. ${t + 1}`)
  return (
    <LineChart labels={labels} height={140} compact xHeader="неделя" fmtY={axisMoney} unit="₽"
      series={[{ key: 'p50', name: 'долг · медиана', values: tr.debt.p50, fmt: money, band: { lo: tr.debt.p50, hi: tr.debt.p95, label: 'до p95' } }]}
      annotations={firstDraw >= 0 ? [{ key: 'first', index: firstDraw, seriesKey: 'p50', label: `транш ${money(tr.drawdown.p50[firstDraw])}` }] : []}
      tipRows={(t) => [{ key: 'p95', label: 'долг p95', value: money(tr.debt.p95[t]) }, { key: 'dd', label: 'транш p50', value: money(tr.drawdown.p50[t]) }]}
      ariaLabel={`Медианный долг по ${weeks} неделям: ${tr.debt.p50.map((v) => money(v)).join(', ')}`} />
  )
}

export function CashTiles({ cash, running, error, onRun, scheduleRefId, primary = true }: CashTilesProps) {
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
          {error && <p className="pl-note pl-note--danger">{error}</p>}
        </div>
        <button type="button" className={`btn${primary ? ' btn--primary' : ''}`} onClick={onRun} disabled={running}>{running ? 'Считаем кассу…' : 'Рассчитать кассу'}</button>
      </div>
    )
  }
  const w = cash.waterfall?.lp_recourse ?? cash.waterfall?.rule
  const covenant = COVENANT
  const dscr = w?.dscr_min_p05 ?? 0
  const pol = cash.price_of_liquidity
  const tr = cash.tranches
  const weeks = tr?.drawdown?.p50?.length ?? 0
  const firstDraw = tr?.drawdown?.p50?.findIndex((v) => v > 0) ?? -1
  return (
    <div className="pl-bento pl-bento--cash">
      <Tile metric="cash.cfar" label={`Минимальный остаток кассы · CVaR β = ${pct(cash.beta, 0)}`} span="s5" hero
            values={{ cfar: w?.cfar, beta: cash.beta, n: cash.n_scenarios, ci_lo: w?.cfar_ci?.[0], ci_hi: w?.cfar_ci?.[1] }}
            status={<StatusChip tone={(w?.cfar ?? 0) >= 0 ? 'running' : 'down'}>{(w?.cfar ?? 0) >= 0 ? 'касса не уходит ниже нуля' : 'в хвосте касса отрицательна'}</StatusChip>}>
        <FmtValue text={money(w?.cfar ?? cash.cfar)} />
        <div className="pl-tile__sub">
          медиана минимума <span className="num">{money(w?.cash_min_p50)}</span>
          {w?.cfar_ci && <> · ДИ 95 % <span className="num">[{money(w.cfar_ci[0])}; {money(w.cfar_ci[1])}]</span></>}
        </div>
        <div className="pl-tile__div" />
        <div className="pl-tile__k">
          <SubLabel metric="cash.p_breach" label="Вероятность кассового разрыва"
                    values={{ p: w?.p_breach, ci_lo: w?.p_breach_ci?.[0], ci_hi: w?.p_breach_ci?.[1], warn: THR.breachWarn, bad: THR.breachBad }} />
          {w && <StatusChip tone={breachTone(w.p_breach)}>{w.p_breach < THR.breachWarn ? 'в норме' : w.p_breach < THR.breachBad ? 'внимание' : 'критично'}</StatusChip>}
        </div>
        <FmtValue text={pct(w?.p_breach ?? cash.p_negative_cash, 1)} size="md" />
        <div className="pl-tile__sub">
          {w?.p_breach_ci && <>Уилсон 95 % <span className="num">[{pct(w.p_breach_ci[0], 1)}; {pct(w.p_breach_ci[1], 1)}]</span> · </>}
          {w && w.p_breach > 0 ? <>первый разрыв не позже <span className="num">{num(w.t_breach_p10, 0)}-й</span> недели (p10)</> : 'разрывов в сценариях нет'}
        </div>
      </Tile>

      <Tile metric="cash.dscr_min_p05" label="DSCR · 5 % квантиль" values={{ dscr: w?.dscr_min_p05, covenant, p_cov: w?.p_covenant }}
            status={w && <StatusChip tone={dscrTone(dscr, covenant)}>{dscr >= covenant ? 'ковенант соблюдён' : 'ниже ковенанта'}</StatusChip>}>
        {dscr > DSCR_SHOW_MAX
          ? <Value text="≫" unit={`${num(covenant, 1)}× (ковенант)`} />
          : <Value text={num(dscr, 1)} unit="×" />}
        <div className="pl-tile__sub">ковенант <span className="num">{num(covenant, 1)}×</span> · P(нарушение) <span className="num">{pct(w?.p_covenant ?? 0, 1)}</span></div>
      </Tile>

      <Tile metric="cash.debt_peak" label="Пик кредитной линии" span="s4"
            values={{ peak: w?.debt_peak, share: w?.debt_peak_share, limit: cash.duals?.credit_limit }}
            status={w && <StatusChip tone={debtTone(w.debt_peak_share)}>{pct(w.debt_peak_share, 0)} лимита</StatusChip>}>
        <FmtValue text={money(w?.debt_peak)} />
        <div className="pl-tile__sub">проценты за горизонт <span className="num">{money(w?.int_cost)}</span> · ставка <span className="num">{pct(cash.weekly_rate * 52, 1)}</span></div>
      </Tile>

      <Tile metric="cash.pol" label="Цена ликвидности · PoL(L_min)" span="s7"
            values={{ pol: pol?.value, ci_lo: pol?.ci?.[0], ci_hi: pol?.ci?.[1], pol_obj: pol?.objective_delta, dual: pol?.local_dual }}
            status={<StatusChip tone={cash.duals?.liquidity_binding ? 'setup' : 'running'}>{cash.duals?.liquidity_binding ? 'ограничение активно' : 'ограничение не связывает'}</StatusChip>}>
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
            status={<StatusChip tone="info">{cash.financing_stage === 'recourse' ? 'рекурс d_i,t' : 'график заранее d_t'}</StatusChip>}>
        {tr && weeks > 0 ? (
          <>
            <TrancheChart tr={tr} firstDraw={firstDraw} />
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
