/**
 * Факты последнего плана и кассы для показателей и сигналов «Мониторинга»: номер и адрес плана,
 * заказы в срок, самый загруженный участок, кассовый разрыв, когда и на каком сценарии построен
 * (метаданные прогона «Плана», иначе — портфель, по которому строили), устарел ли план — те же
 * признаки, что у полосы методологии (узлы «Портфель» и «План» карты, время изменения сценария и НСИ).
 * Только чтение хранилищ.
 */
import { useInputsChanged } from '../../shell/context'
import { useCashStore } from '../finance/cashStore'
import { useMethodMapState, useRefs } from '../method-map/useMethodMapState'
import { useOptStore } from '../optimization/optStore'
import { usePlanStore } from '../plan/planStore'
import { browserStorage, runMetaMap } from '../plan/runMeta'
import type { PlanFacts } from './monitorSignals'
import { planStaleReason } from './planStale'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function usePlanFacts(): PlanFacts {
  const plan = usePlanStore()
  const cash = useCashStore()
  const opt = useOptStore()
  const refs = useRefs()
  const { state } = useMethodMapState()
  const changed = useInputsChanged()
  const kpi = plan.result?.kpi
  const bn = plan.result?.bottleneck ?? refs.kpi?.bottleneck
  const planId = plan.result?.plan_id ?? refs.kpi?.plan_id ?? null
  const planKey = plan.resultKey ?? planId
  const meta = planKey ? runMetaMap(browserStorage()).get(planKey) : undefined
  const fromPortfolio = Boolean(plan.result && plan.params.runId && opt.result?.run_id === plan.params.runId)
  const optSc = fromPortfolio ? opt.result?.scenario_id : undefined
  const w = cash.result?.waterfall?.lp_recourse
  const createdAt = refs.kpi?.created_at ? Date.parse(refs.kpi.created_at) : NaN
  const otd = isNum(kpi?.otd) ? kpi.otd : isNum(refs.kpi?.kpi.otd) ? refs.kpi.kpi.otd : null
  const builtAt = plan.builtAt ?? meta?.builtAt ?? (Number.isFinite(createdAt) ? createdAt : null)
  return {
    planNo: planId && /^\d+$/.test(planId) ? planId : null,
    planKey,
    otd,
    nLate: isNum(kpi?.n_late) ? kpi.n_late : null,
    bottleneck: bn && isNum(bn.utilization) ? { name: bn.wc_name || 'рабочий центр', load: bn.utilization } : null,
    cashGap: w ? { p: w.p_breach, ci: w.p_breach_ci ?? null } : null,
    builtAt,
    scenarioId: meta?.scenarioId || optSc || null,
    scenarioName: meta?.scenarioName || (optSc && opt.result?.scenario_id === optSc ? opt.result.scenario_name : null) || null,
    stale: plan.result ? planStaleReason({ state, builtAt: plan.builtAt, fromPortfolio, portfolioAt: opt.ranAt, changed }) : null,
  }
}
