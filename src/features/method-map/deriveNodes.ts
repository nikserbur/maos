/**
 * Состояния подблоков основного потока [1]…[5] (UX-V2 §3.4) — честно, из того, что фронтенд знает:
 * нет данных → `unconfigured`, значения кода/НСИ → `default`, введено пользователем → `manual`,
 * рассчитано по сценариям → `estimated`, вход изменился или расчёт не завершён → `stale`,
 * расчёт не выполнен → `error`, не реализовано → `planned`. Петли [6]…[8] — deriveLoops.ts.
 * Подписи — те же, что на экранах (X2 P-129): имена целей и правил из explain/labels, числа и
 * склонения — из explain/format, вероятности — частотами, CVaR — рядом со средним.
 */
import { NBSP, countText, freqText, hours, money, num, pct, signed } from '../../explain/format'
import { financingLabel, objectiveLabel, ruleLabel } from '../../explain/labels'
import { isSoft } from '../optimization/optTypes'
import type { DeriveInput } from './deriveInput'
import { loopSubblocks } from './deriveLoops'
import { cashCriterionWaiting, lpLimitSeconds, lpSolved, lpStatusLive } from './lpStatus'
import { W, cvarText, iso, type Live } from './mapText'
import type { NodeLive, ParameterPassport } from './types'

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
        detail: `ставка ${num(Number(rate), 1)}${NBSP}%${macro ? ' (Банк России)' : ''} · курс ×${num(Number(fx), 2)} · инфляция ${num(Number(infl), 2)}${NBSP}%/мес`,
        reason: outOfRange.length ? `вне разумного диапазона: ${outOfRange.map((p) => p.label).join(', ')}` : undefined,
      }
      : { state: 'unconfigured', badge: counts.scenarios ? 'сценарий не выбран' : 'нет сценариев', reason: 'Создайте сценарий из шаблона.' },
    'ext.prices': counts.products === 0
      ? { state: 'unconfigured', badge: 'нет изделий' }
      : forecast
        ? { state: fits > 0 ? 'estimated' : 'default', badge: `оценено по истории: ${num(fits, 0)} из ${num(forecast.products.length, 0)}`,
          detail: synthetic ? 'история синтетическая — демонстрация, не факт' : undefined,
          reason: synthetic ? 'история цен синтетическая: обучение и проверка на ней запрещены (R7)' : undefined }
        : { state: 'default', badge: `${num(counts.sellable, 0)} товарных · ${num(counts.purchased, 0)} покупных`, detail: synthetic ? 'история синтетическая' : 'прогноз не запрошен' },
    'ext.generator': macro
      ? { state: 'estimated', badge: `${countText(macro.regimes, W.regime)} · блок ${num(macro.block_months, 0)}${NBSP}мес · ряды Банка России ${macro.data.first}–${macro.data.last}`,
        detail: `CRPS ${num(macro.selection.choice.joint_standardized_CRPS_13months, 3)} против ${num(macro.selection.choice.naive_persistence_joint_CRPS, 3)} у персистентности`,
        reason: cov && cov.key_pp.coverage80 < 0.6 ? `покрытие 80 %-интервала ставки ${pct(cov.key_pp.coverage80, 0)} — недопокрытие, используйте квантильный стресс` : undefined,
        updatedAt: macro.trained_at }
      : { state: 'default', badge: 'сводка генератора не загружена', detail: 'сервер не вернул сводку генератора' },
    'ext.regimes': !scenario
      ? { state: 'unconfigured', badge: 'нет сценария' }
      : modeLabel === 'base'
        ? { state: 'default', badge: 'базовый — прогноз', detail: macro ? `${countText(macro.regimes, W.regime)} генератора, без навязывания` : undefined }
        : { state: 'manual', badge: modeLabel, detail: 'стресс, а не прогноз' },
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
        ? { state: 'default', badge: 'по умолчанию: σ = 12 % · β = 0,7', detail: `${countText(m, W.product)} без распределения` }
        : { state: 'manual', badge: `задано ${num(n, 0)} из ${num(m, 0)}`, detail: n < m ? `${num(m - n, 0)} по умолчанию` : 'все изделия' },
    'dist.durations': counts.operations === 0
      ? { state: 'unconfigured', badge: 'нет операций' }
      : { state: 'default', badge: countText(counts.operations, W.operation), detail: 'PERT → логнормальное + Парето, хвост по умолчанию' },
    'dist.breakdowns': counts.wcTypes === 0
      ? { state: 'unconfigured', badge: 'нет типов РЦ' }
      : counts.wcTypesWithMtbf > 0
        ? { state: 'manual', badge: `MTBF задан: ${num(counts.wcTypesWithMtbf, 0)} из ${num(counts.wcTypes, 0)}` }
        : { state: 'default', badge: `${countText(counts.wcTypes, W.wcType)} · MTBF по умолчанию` },
    'dist.identify': { state: 'planned', badge: 'в плане · волна 1' },
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
        state: 'manual', badge: `${countText(counts.machines, W.machine)} · ${countText(counts.wcTypes, W.wcType)}`,
        detail: `календарь ${plan.params.useCalendar ? 'включён' : 'выключен'}${r ? ` · фонд ${hours(r.calendar.work_fond_hours, 0)}` : ''}`,
      },
    'int.labor': counts.workers === 0
      ? { state: 'unconfigured', badge: 'нет рабочих' }
      : { state: 'manual', badge: countText(counts.workers, W.worker), detail: fewOperators ? 'операторов меньше станков' : undefined,
        reason: fewOperators && r ? `параллельно работают не больше ${num(r.n_workers, 0)} из ${countText(r.n_machines, W.machine)}` : undefined },
    'int.routes': counts.routings === 0 || counts.operations === 0
      ? { state: 'unconfigured', badge: 'нет техкарт' }
      : { state: 'manual', badge: `${countText(counts.routings, W.routing)} · ${countText(counts.operations, W.operation)}` },
    'int.mrp': counts.purchased === 0
      ? { state: 'default', badge: 'нет покупных позиций' }
      : r
        ? { state: 'estimated', badge: 'рассчитан при построении плана', updatedAt: iso(plan.builtAt) }
        : { state: 'default', badge: countText(counts.purchased, W.position), detail: 'считается при построении плана' },
    'int.finance': input.fin
      ? { state: 'calibrated', badge: `C₀ ${money(input.fin.c0)} · лимит ${money(input.fin.credit_limit)}`,
        detail: `ставка линии ${pct(input.fin.key_rate + input.fin.spread, 1)} · отсрочка поставщикам ${num(input.fin.dpo_weeks, 0)}${NBSP}нед · калибровка: данных предприятия нет`,
        updatedAt: input.fin.updated_at?.replace(' ', 'T') }
      : { state: 'default', badge: 'финансовые параметры не загружены', detail: 'сервер не вернул параметры кассы' },
  }
}

function portfolioLive(input: DeriveInput): NodeLive {
  const { scenario, opt, context } = input
  const r = opt.result
  if (!scenario) return { state: 'unconfigured', badge: 'нет сценария' }
  if (opt.running) return { state: 'default', badge: 'считаем портфель…' }
  if (!r) return { state: 'default', badge: 'портфель не рассчитан' }
  if (isSoft(r)) return { state: 'error', badge: 'нет решения', reason: r.warnings?.[0] ?? 'расчёт портфеля не выполнен' }
  if (context.scenarioId && r.scenario_id !== context.scenarioId) {
    return { state: 'stale', badge: `портфель «${r.scenario_name}»`, reason: 'портфель считался под другой сценарий', updatedAt: iso(opt.ranAt) }
  }
  return { state: 'estimated', badge: `${objectiveLabel(r.objective)} · ${countText(r.robust.items.length, W.product)}`,
    detail: `E ${signed(r.robust.metrics.expected, '₽')}`, updatedAt: iso(opt.ranAt) }
}

function scheduleLive(input: DeriveInput): NodeLive {
  const { opt, plan } = input
  const p = plan.result
  const k = p?.kpi
  if (plan.running) return { state: 'default', badge: 'строим план…' }
  if (!p || !k) return { state: 'default', badge: 'план не построен' }
  if (p.error_soft) return { state: 'error', badge: 'план не построен', reason: p.warnings?.[0] ?? 'расчёт плана не выполнен' }
  const badge = `${ruleLabel(p.rule)} · E[Cmax] ${hours(k.makespan_mean, 0)}`
  const portfolioAfterPlan = Boolean(plan.params.runId && opt.ranAt && plan.builtAt && opt.ranAt > plan.builtAt)
  if (portfolioAfterPlan) return { state: 'stale', badge, reason: 'портфель пересчитан после построения плана', updatedAt: iso(plan.builtAt) }
  const gain = p.improver?.validation?.improvement_pct ?? p.improver?.improvement_pct
  return { state: 'estimated', badge,
    detail: p.improver?.adopted && gain !== undefined ? `ГА улучшил на ${num(gain, 1)}${NBSP}%` : `${countText(p.n_orders, W.order)} · ${countText(p.n_jobs, W.operation)}`,
    updatedAt: iso(plan.builtAt) }
}

function decisions(input: DeriveInput): Live {
  return {
    'dec.portfolio': portfolioLive(input),
    'dec.schedule': scheduleLive(input),
    'dec.lots': input.counts.products === 0 ? { state: 'unconfigured', badge: 'нет изделий' } : { state: 'default', badge: 'партии из НСИ изделий' },
    'dec.invest': { state: 'default', badge: 'по запросу в «Аналитике»' },
    'dec.cash': cashLive(input, 'decision'),
  }
}

function criteria(input: DeriveInput, passports: Record<string, ParameterPassport>): Live {
  const r = input.opt.result
  const p = input.plan.result
  const alphaRaw = Number(passports['scenario.alpha'].value)
  const alpha = Number.isFinite(alphaRaw) ? alphaRaw : 0.1
  const alphaText = `α ${pct(alpha, 0)}`
  const ready = r && !isSoft(r)
  return {
    'crit.profit': ready
      ? { state: 'estimated', badge: `${cvarText(alpha, r.robust.metrics.cvar)} · E ${signed(r.robust.metrics.expected, '₽')}`,
        detail: `${alphaText} · цена робастности ${money(r.price_of_robustness)}`, updatedAt: iso(input.opt.ranAt) }
      : { state: passports['scenario.alpha'].provenance === 'manual' ? 'manual' : 'default', badge: `${alphaText} · не рассчитан` },
    'crit.schedule': p && !p.error_soft
      ? { state: 'estimated', badge: `CVaR Cmax ${hours(p.kpi.makespan_cvar, 0)} · OTD ${pct(p.kpi.otd, 0)}`, updatedAt: iso(input.plan.builtAt) }
      : { state: 'default', badge: 'план не построен' },
    'crit.cash': cashLive(input, 'criterion'),
    'crit.ci': ready && r.oos
      ? { state: 'estimated', badge: `вне выборки: Δ CVaR ${pct(r.oos.gap_cvar, 1)}`, detail: `на свежих сценариях · N ${num(r.samples, 0)}` }
      : { state: 'default', badge: 'ДИ появятся после расчёта портфеля' },
  }
}

/** Денежный слой: решение (транши) и критерий (CFaR, P(разрыв)) по последнему POST /api/optimize/cash. */
function cashLive(input: DeriveInput, kind: 'decision' | 'criterion'): NodeLive {
  const { cash } = input
  const r = cash.result
  if (cash.running) return { state: 'default', badge: 'считаем кассу…' }
  if (!r) return { state: 'default', badge: 'касса не рассчитана', detail: 'расчёт — в результате плана или в «Портфеле»' }
  const at = iso(cash.ranAt)
  // Одна причина — один блок: не решённая касса [4] не даёт второй ошибки в критерии [5].
  if (!lpSolved(r.status)) return kind === 'decision' ? lpStatusLive(r.status, r.reason, lpLimitSeconds(r.solve_ms), at) : cashCriterionWaiting()
  const w = r.waterfall?.lp_recourse ?? r.waterfall?.rule
  if (kind === 'decision') {
    const peak = w ? `пик долга ${money(w.debt_peak)} (${pct(w.debt_peak_share, 0)} лимита)` : `CVaR ${money(r.cvar)}`
    return { state: 'estimated', badge: `${financingLabel(r.financing_stage)} · ${countText(r.portfolio.length, W.product)}`, detail: peak, updatedAt: at }
  }
  return w
    ? { state: 'estimated', badge: `CFaR ${money(w.cfar)} · P(разрыв) ${pct(w.p_breach, 0)} — ${freqText(w.p_breach)} ${W.scenario[2]}`,
      detail: `DSCR p05 ${num(w.dscr_min_p05, 1)}${r.price_of_liquidity ? ` · цена ликвидности ${money(r.price_of_liquidity.value)}` : ''}`, updatedAt: at }
    : { state: 'estimated', badge: `CFaR ${money(r.cfar)}`, updatedAt: at }
}

/** Состояния всех подблоков. */
export function deriveSubblocks(input: DeriveInput, passports: Record<string, ParameterPassport>): Live {
  return {
    ...external(input, passports),
    ...distributions(input),
    ...internal(input),
    ...decisions(input),
    ...criteria(input, passports),
    ...loopSubblocks(input),
  }
}
