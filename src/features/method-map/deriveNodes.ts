/**
 * Состояния подблоков по блокам (UX-V2 §3.4) — честно, из того, что фронтенд знает:
 * нет данных → `unconfigured`, значения кода/НСИ → `default`, введено пользователем →
 * `manual`, рассчитано по сценариям → `estimated`, вход изменился после расчёта →
 * `stale`, бэкенд вернул мягкую ошибку → `error`, не реализовано → `planned`.
 */
import { money, num, pct } from '../../explain/format'
import { METRIC_LIST } from '../../explain/metrics'
import { isSoft } from '../optimization/optTypes'
import type { DeriveInput } from './deriveInput'
import type { NodeLive, ParameterPassport } from './types'

type Live = Record<string, NodeLive>

const iso = (ms: number | null | undefined): string | undefined => (ms ? new Date(ms).toISOString() : undefined)

function external(input: DeriveInput, passports: Record<string, ParameterPassport>): Live {
  const { scenario, counts, forecast, macro } = input
  // Ползунки волны M (deprecated) не считаются ручным вводом: их значения в расчёт не идут.
  const used = ['scenario.fx', 'scenario.inflation', 'scenario.demand', 'scenario.volatility', 'scenario.market_corr', 'scenario.months']
    .map((id) => passports[id])
  const anyManual = used.some((p) => p.provenance === 'manual')
  const outOfRange = used.filter((p) => p.outOfRange)
  const rate = macro ? macro.last_obs.key_pp : passports['scenario.key_rate'].value
  const fx = passports['scenario.fx'].value
  const infl = passports['scenario.inflation'].value
  const fits = forecast?.products.filter((p) => p.fit?.data_driven).length ?? 0
  const synthetic = forecast?.synthetic || input.passport?.['r1.59']?.status === 'синтетика'
  const modeLabel = String(passports['macro.mode'].value ?? 'base')
  const cov = macro?.holdout?.variables
  return {
    'ext.macro': scenario
      ? {
        state: anyManual ? 'manual' : 'default',
        badge: scenario.name,
        detail: `ставка ${num(Number(rate), 1)} %${macro ? ' (ЦБ РФ)' : ''} · курс ×${num(Number(fx), 2)} · инфл. ${num(Number(infl), 2)} %/мес`,
        reason: outOfRange.length ? `вне разумного диапазона: ${outOfRange.map((p) => p.label).join(', ')}` : undefined,
      }
      : { state: 'unconfigured', badge: counts.scenarios ? 'сценарий не выбран' : 'нет сценариев', reason: 'Создайте сценарий из шаблона.' },
    'ext.prices': counts.products === 0
      ? { state: 'unconfigured', badge: 'нет изделий' }
      : forecast
        ? { state: fits > 0 ? 'estimated' : 'default', badge: `оценено по истории: ${fits} из ${forecast.products.length}`,
          detail: synthetic ? 'история синтетическая — демонстрация' : undefined,
          reason: synthetic ? 'ts_data.synthetic = 1: обучение и валидация запрещены (R7)' : undefined }
        : { state: 'default', badge: `${counts.sellable} товарных · ${counts.purchased} покупных`, detail: synthetic ? 'история синтетическая' : 'прогноз не запрошен' },
    'ext.generator': macro
      ? { state: 'estimated', badge: `${macro.regimes} режима · блок ${macro.block_months} мес · cbr.ru ${macro.data.first}…${macro.data.last}`,
        detail: `CRPS ${num(macro.selection.choice.joint_standardized_CRPS_13months, 3)} / персистентность ${num(macro.selection.choice.naive_persistence_joint_CRPS, 3)}`,
        reason: cov && cov.key_pp.coverage80 < 0.6 ? `покрытие 80 % ставки ${num(cov.key_pp.coverage80, 2)} — недопокрытие, используйте квантильный стресс` : undefined,
        updatedAt: macro.trained_at }
      : { state: 'default', badge: 'сводка генератора не загружена', detail: 'GET /api/macro/summary' },
    'ext.regimes': !scenario
      ? { state: 'unconfigured', badge: 'нет сценария' }
      : modeLabel === 'base'
        ? { state: 'default', badge: 'базовый — прогноз', detail: macro ? `P(спокойный) ${num(macro.holdout ? 1 - (macro.holdout.n ? 0 : 0) : 1, 0)}` : undefined }
        : { state: 'manual', badge: modeLabel, detail: 'стресс, не прогноз (§2.6б)' },
  }
}

function distributions(input: DeriveInput): Live {
  const { scenario, counts } = input
  const n = scenario?.distributions?.length ?? 0
  const m = counts.sellable + counts.purchased
  return {
    'dist.prices': !scenario
      ? { state: 'unconfigured', badge: 'нет сценария' }
      : n === 0
        ? { state: 'default', badge: `по умолчанию: σ = 12 % · β = 0,7`, detail: `${m} изделий без распределения` }
        : { state: 'manual', badge: `задано ${n} из ${m}`, detail: n < m ? `${m - n} по умолчанию` : 'все изделия' },
    'dist.durations': counts.operations === 0
      ? { state: 'unconfigured', badge: 'нет операций' }
      : { state: 'default', badge: `${counts.operations} операций`, detail: 'PERT → lognormal + Pareto, хвост по умолчанию' },
    'dist.breakdowns': counts.wcTypes === 0
      ? { state: 'unconfigured', badge: 'нет типов РЦ' }
      : counts.wcTypesWithMtbf > 0
        ? { state: 'manual', badge: `MTBF задан: ${counts.wcTypesWithMtbf} из ${counts.wcTypes}` }
        : { state: 'default', badge: `${counts.wcTypes} типов РЦ · MTBF по умолчанию` },
    'dist.identify': { state: 'planned', badge: 'волна 1 · план-факт' },
  }
}

function internal(input: DeriveInput): Live {
  const { counts, plan } = input
  const r = plan.result
  const fewOperators = r ? r.n_workers < r.n_machines : false
  return {
    'int.capacity': counts.machines === 0 || counts.wcTypes === 0
      ? { state: 'unconfigured', badge: 'нет станков', reason: 'Начните со «Справочников»: типы РЦ и станки.' }
      : {
        state: 'manual', badge: `${counts.machines} станков · ${counts.wcTypes} типов РЦ`,
        detail: `календарь ${plan.params.useCalendar ? 'вкл' : 'выкл'}${r ? ` · фонд ${num(r.calendar.work_fond_hours, 0)} ч` : ''}`,
      },
    'int.labor': counts.workers === 0
      ? { state: 'unconfigured', badge: 'нет рабочих' }
      : { state: 'manual', badge: `${counts.workers} рабочих`, detail: fewOperators ? '▲ операторов меньше станков' : undefined,
        reason: fewOperators && r ? `параллельно не больше ${r.n_workers} из ${r.n_machines} станков` : undefined },
    'int.routes': counts.routings === 0 || counts.operations === 0
      ? { state: 'unconfigured', badge: 'нет техкарт' }
      : { state: 'manual', badge: `${counts.routings} техкарт · ${counts.operations} операций` },
    'int.mrp': counts.purchased === 0
      ? { state: 'default', badge: 'нет покупных позиций' }
      : r
        ? { state: 'estimated', badge: `рассчитан при построении плана`, updatedAt: iso(plan.builtAt) }
        : { state: 'default', badge: `${counts.purchased} покупных позиций`, detail: 'считается при построении плана' },
    'int.finance': input.fin
      ? { state: 'calibrated', badge: `C₀ ${money(input.fin.c0)} · лимит ${money(input.fin.credit_limit)}`,
        detail: `ставка линии ${num((input.fin.key_rate + input.fin.spread) * 100, 1)} % · DPO ${input.fin.dpo_weeks} нед · [К] данных предприятия нет`,
        updatedAt: input.fin.updated_at?.replace(' ', 'T') }
      : { state: 'default', badge: 'fin_params не загружены', detail: 'GET /api/fin_params' },
  }
}

function decisions(input: DeriveInput): Live {
  const { scenario, opt, plan, counts, context } = input
  const r = opt.result
  const soft = isSoft(r)
  const otherScenario = Boolean(r && context.scenarioId && r.scenario_id !== context.scenarioId)
  const portfolio: NodeLive = !scenario
    ? { state: 'unconfigured', badge: 'нет сценария' }
    : opt.running
      ? { state: 'default', badge: 'считаем портфель…' }
      : !r
        ? { state: 'default', badge: 'портфель не рассчитан' }
        : soft
          ? { state: 'error', badge: 'нет решения', reason: r?.warnings?.[0] ?? 'бэкенд вернул мягкую ошибку' }
          : otherScenario
            ? { state: 'stale', badge: `портфель «${r.scenario_name}»`, reason: 'портфель считался под другой сценарий', updatedAt: iso(opt.ranAt) }
            : { state: 'estimated', badge: `${r.objective} · ${r.robust.items.length} изделий`, detail: `E = ${money(r.robust.metrics.expected)}`, updatedAt: iso(opt.ranAt) }

  const p = plan.result
  const k = p?.kpi
  const portfolioAfterPlan = Boolean(plan.params.runId && opt.ranAt && plan.builtAt && opt.ranAt > plan.builtAt)
  const schedule: NodeLive = plan.running
    ? { state: 'default', badge: 'строим план…' }
    : !p || !k
      ? { state: 'default', badge: 'план не построен' }
      : p.error_soft
        ? { state: 'error', badge: 'план не построен', reason: p.warnings?.[0] }
        : portfolioAfterPlan
          ? { state: 'stale', badge: `${p.rule} · E[Cmax] ${num(k.makespan_mean, 0)} ч`, reason: 'портфель пересчитан после построения плана', updatedAt: iso(plan.builtAt) }
          : { state: 'estimated', badge: `${p.rule} · E[Cmax] ${num(k.makespan_mean, 0)} ч`,
            detail: p.improver?.adopted ? `ГА +${num(p.improver.validation?.improvement_pct ?? p.improver.improvement_pct, 1)} %` : `${p.n_orders} заказов · ${p.n_jobs} операций`,
            updatedAt: iso(plan.builtAt) }
  return {
    'dec.portfolio': portfolio,
    'dec.schedule': schedule,
    'dec.lots': counts.products === 0 ? { state: 'unconfigured', badge: 'нет изделий' } : { state: 'default', badge: 'партии из НСИ изделий' },
    'dec.invest': { state: 'default', badge: 'по запросу в «Аналитике»' },
    'dec.cash': cashLive(input, 'decision'),
  }
}

function criteria(input: DeriveInput, passports: Record<string, ParameterPassport>): Live {
  const r = input.opt.result
  const p = input.plan.result
  const alpha = passports['scenario.alpha']
  const alphaText = `α = ${num(Number(alpha.value), 2)}`
  const ready = r && !isSoft(r)
  return {
    'crit.profit': ready
      ? { state: 'estimated', badge: `CVaR ${money(r.robust.metrics.cvar)}`, detail: `${alphaText} · цена робастности ${money(r.price_of_robustness)}`, updatedAt: iso(input.opt.ranAt) }
      : { state: alpha.provenance === 'manual' ? 'manual' : 'default', badge: `${alphaText} · не рассчитан` },
    'crit.schedule': p && !p.error_soft
      ? { state: 'estimated', badge: `CVaR Cmax ${num(p.kpi.makespan_cvar, 0)} ч · OTD ${pct(p.kpi.otd, 0)}`, updatedAt: iso(input.plan.builtAt) }
      : { state: 'default', badge: 'план не построен' },
    'crit.cash': cashLive(input, 'criterion'),
    'crit.ci': ready && r.oos
      ? { state: 'estimated', badge: `вне выборки: Δ CVaR ${pct(r.oos.gap_cvar, 1)}` }
      : { state: 'planned', badge: 'волна 1 · ДИ, CRN, holdout' },
  }
}

/** Денежный слой: решение (транши) и критерий (CFaR, P(разрыв)) по последнему POST /api/optimize/cash. */
function cashLive(input: DeriveInput, kind: 'decision' | 'criterion'): NodeLive {
  const { cash, fin } = input
  const r = cash.result
  if (cash.running) return { state: 'default', badge: 'считаем кассу…' }
  if (!r) return { state: fin ? 'default' : 'default', badge: 'касса не рассчитана', detail: 'шаг «Результат» мастера плана или «Оптимизация»' }
  if (r.status !== 'optimal') return { state: 'error', badge: `LP: ${r.status}`, reason: r.reason ?? 'ограничение ликвидности неразрешимо — снизьте L_min' }
  const w = r.waterfall?.lp_recourse ?? r.waterfall?.rule
  const at = iso(cash.ranAt)
  if (kind === 'decision') {
    const peak = w ? `пик долга ${money(w.debt_peak)} (${pct(w.debt_peak_share, 0)} лимита)` : `CVaR ${money(r.cvar)}`
    return { state: 'estimated', badge: `${r.financing_stage === 'recourse' ? 'рекурс' : 'график заранее'} · ${r.portfolio.length} изделий`, detail: peak, updatedAt: at }
  }
  return w
    ? { state: 'estimated', badge: `CFaR ${money(w.cfar)} · P(разрыв) ${pct(w.p_breach, 1)}`,
      detail: `DSCR p05 ${num(w.dscr_min_p05, 1)}${r.price_of_liquidity ? ` · цена ликвидности ${money(r.price_of_liquidity.value)}` : ''}`, updatedAt: at }
    : { state: 'estimated', badge: `CFaR ${money(r.cfar)}`, updatedAt: at }
}

function loops(input: DeriveInput): Live {
  const f = input.forecast
  const bt = f?.products.find((p) => p.backtest)?.backtest
  const worse = bt ? bt.skill < 0 : false
  return {
    ...agents(input),
    'ag.games': { state: 'planned', badge: 'волна 3 · цена анархии, Штакельберг' },
    'mon.forecast': bt
      ? { state: worse ? 'stale' : 'estimated', badge: `MAPE ${pct(bt.mape, 1)} (наив ${pct(bt.mape_naive, 1)})`, detail: `покрытие ${pct(bt.coverage80, 0)}`,
        reason: worse ? 'прогноз хуже наивного — упростите модель или переоцените' : undefined }
      : { state: 'default', badge: 'прогноз не запрошен' },
    'mon.quality': input.macro?.holdout
      ? { state: 'estimated', badge: `CRPS генератора: π ${num(input.macro.holdout.variables.cpi_yoy_pp.mean_CRPS, 2)} · ставка ${num(input.macro.holdout.variables.key_pp.mean_CRPS, 2)} · курс ${num(input.macro.holdout.variables.usd_rub.mean_CRPS, 2)}`,
        detail: `покрытие 80 %: ${Object.entries(input.macro.holdout.variables).map(([, v]) => num(v.coverage80, 2)).join(' · ')} · MASE по изделиям — после план-факта` }
      : { state: 'default', badge: 'CRPS генератора не загружен', detail: 'MASE по изделиям — после план-факта (R20)' },
    'mon.planfact': input.kpi?.plan_id
      ? { state: 'estimated', badge: `план-факт: ${input.kpi.plan_id.slice(0, 8)}`, updatedAt: input.kpi.created_at }
      : { state: 'default', badge: 'нет KPI плана' },
    'mon.early': { state: 'planned', badge: 'волна 2' },
    'llm.explain': { state: 'default', badge: `${METRIC_LIST.length} формул с подстановкой` },
    'llm.mentat': { state: 'planned', badge: 'волна 2 · MENTAT' },
  }
}

/**
 * Блок [6] (UX-V2 §4.9): `default` — политика не опубликована (гейт §7.4 не пройден, чемпион —
 * правило) или статус ещё не получен; `estimated` — опубликована (и тогда бейдж ходов последнего
 * прогона RL «N ходов · ΔCVaR»). Полномочия — `manual`, если отличаются от умолчаний.
 */
function agents(input: DeriveInput): Live {
  const { rl, guardrails } = input
  const mv = input.plan.result?.moves
  const live = Boolean(rl && rl.available && rl.onnxruntime && rl.l0.ok)
  let agent: NodeLive
  if (mv && mv.moves.length > 0) {
    const gain = mv.totals.profit.cvar_after - mv.totals.profit.cvar_before
    agent = { state: 'estimated', badge: `${mv.moves.length} ходов · ${gain >= 0 ? '+' : ''}${money(gain)} CVaR`,
      detail: `ДИ ${mv.totals.ci95[0] > 0 ? 'выше нуля' : 'задевает ноль'} · ${num(mv.n_scenarios ?? 0, 0)} сценариев`, updatedAt: iso(input.plan.builtAt) }
  } else if (live && rl) {
    agent = { state: 'estimated', badge: `политика L0 ${rl.l0.sha256.slice(0, 8)}`, detail: rl.l2.ok ? 'L2 опубликована — ходы в «Плане»' : 'L2 не опубликована — только порядок операций' }
  } else if (rl) {
    agent = { state: 'default', badge: 'гейт не пройден · чемпион — правило',
      detail: rl.onnxruntime ? 'onnxruntime есть, политика не опубликована' : 'сервер без onnxruntime',
      reason: 'ни одна политика L0/L2 не выиграла у лучшего правила с ДИ на отложенных сценариях (V5)' }
  } else {
    agent = { state: 'default', badge: 'статус политики не получен', detail: 'GET /api/rl/status' }
  }
  const allowed = guardrails ? Object.values(guardrails.allowed).filter(Boolean).length : null
  const guard: NodeLive = guardrails
    ? { state: guardrails.frozen.length || guardrails.rejected_masks.length ? 'manual' : 'default',
      badge: `${allowed} видов разрешено · ≤ ${guardrails.limits.max_moves} ходов`,
      detail: `заморожено ${guardrails.frozen.length} · масок отклонения ${guardrails.rejected_masks.length}` }
    : { state: 'default', badge: 'умолчания полномочий' }
  return { 'ag.rl': agent, 'ag.guardrails': guard }
}

/** Состояния всех подблоков. */
export function deriveSubblocks(input: DeriveInput, passports: Record<string, ParameterPassport>): Live {
  return {
    ...external(input, passports),
    ...distributions(input),
    ...internal(input),
    ...decisions(input),
    ...criteria(input, passports),
    ...loops(input),
  }
}
