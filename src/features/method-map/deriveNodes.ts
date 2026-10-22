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
  const { scenario, counts, forecast } = input
  const macro = ['scenario.key_rate', 'scenario.fx', 'scenario.inflation', 'scenario.demand', 'scenario.volatility',
    'scenario.market_corr', 'scenario.months', 'scenario.energy', 'scenario.logistics', 'scenario.sanctions', 'scenario.tax_change']
    .map((id) => passports[id])
  const anyManual = macro.some((p) => p.provenance === 'manual')
  const outOfRange = macro.filter((p) => p.outOfRange)
  const rate = passports['scenario.key_rate'].value
  const fx = passports['scenario.fx'].value
  const infl = passports['scenario.inflation'].value
  const fits = forecast?.products.filter((p) => p.fit?.data_driven).length ?? 0
  return {
    'ext.macro': scenario
      ? {
        state: anyManual ? 'manual' : 'default',
        badge: scenario.name,
        detail: `ставка ${num(Number(rate), 2)} % · курс ×${num(Number(fx), 2)} · инфл. ${num(Number(infl), 2)} %/мес`,
        reason: outOfRange.length ? `вне разумного диапазона: ${outOfRange.map((p) => p.label).join(', ')}` : undefined,
      }
      : { state: 'unconfigured', badge: counts.scenarios ? 'сценарий не выбран' : 'нет сценариев', reason: 'Создайте сценарий из шаблона.' },
    'ext.prices': counts.products === 0
      ? { state: 'unconfigured', badge: 'нет изделий' }
      : forecast
        ? { state: fits > 0 ? 'estimated' : 'default', badge: `оценено по истории: ${fits} из ${forecast.products.length}` }
        : { state: 'default', badge: `${counts.sellable} товарных · ${counts.purchased} покупных`, detail: 'прогноз не запрошен' },
    'ext.generator': { state: 'planned', badge: 'волна 2 · ряды ЦБ РФ' },
    'ext.regimes': { state: 'planned', badge: 'волна 2' },
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
    'int.finance': { state: 'planned', badge: 'волна 1 · слой F' },
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
    'dec.cash': { state: 'planned', badge: 'волна 1 · слой F' },
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
    'crit.cash': { state: 'planned', badge: 'волна 1 · CFaR' },
    'crit.ci': ready && r.oos
      ? { state: 'estimated', badge: `вне выборки: Δ CVaR ${pct(r.oos.gap_cvar, 1)}` }
      : { state: 'planned', badge: 'волна 1 · ДИ, CRN, holdout' },
  }
}

function loops(input: DeriveInput): Live {
  const f = input.forecast
  const bt = f?.products.find((p) => p.backtest)?.backtest
  const worse = bt ? bt.skill < 0 : false
  return {
    'ag.rl': { state: 'planned', badge: 'волна 3 · политика не обучена' },
    'ag.guardrails': { state: 'planned', badge: 'волна 3' },
    'ag.games': { state: 'planned', badge: 'волна 3' },
    'mon.forecast': bt
      ? { state: worse ? 'stale' : 'estimated', badge: `MAPE ${pct(bt.mape, 1)} (наив ${pct(bt.mape_naive, 1)})`, detail: `покрытие ${pct(bt.coverage80, 0)}`,
        reason: worse ? 'прогноз хуже наивного — упростите модель или переоцените' : undefined }
      : { state: 'default', badge: 'прогноз не запрошен' },
    'mon.quality': { state: 'planned', badge: 'волна 1 · CRPS/MASE' },
    'mon.planfact': input.kpi?.plan_id
      ? { state: 'estimated', badge: `план-факт: ${input.kpi.plan_id.slice(0, 8)}`, updatedAt: input.kpi.created_at }
      : { state: 'default', badge: 'нет KPI плана' },
    'mon.early': { state: 'planned', badge: 'волна 2' },
    'llm.explain': { state: 'default', badge: `${METRIC_LIST.length} формул с подстановкой` },
    'llm.mentat': { state: 'planned', badge: 'волна 2 · MENTAT' },
  }
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
