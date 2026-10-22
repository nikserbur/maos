/**
 * Шаг 7 «Результат» (UX-V2 §4.2): PlanResult с оглавлением; пины → «Пересчитать с правками»
 * (новый прогон, старый остаётся в истории); касса — POST /api/optimize/cash с профилем отгрузок
 * из этого расписания (schedule_ref_id), β / L_min / финансирование — из полей мастера;
 * «Сравнить с…» — история прогонов с выбором двух.
 */
import { navigateTo } from '../../../../shell/router'
import { RunProgress, CASH_PHASES } from '../../../../ui/RunProgress'
import { runCash, useCashStore } from '../../../finance/cashStore'
import { PlanResult } from '../../PlanResult'
import { RunsTable } from '../../RunsTable'
import { planActions, usePlanStore } from '../../planStore'
import { InlineError } from '../../ui'
import { runSchedule } from '../runSchedule'
import type { WizardData } from '../useWizardData'
import { effectiveFields, useWizard } from '../wizardStore'

export function ResultStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const plan = usePlanStore()
  const cash = useCashStore()
  const f = effectiveFields(w)
  const r = plan.result

  const rerun = async () => { await runSchedule(w, data.program) }
  const cashRun = () => {
    if (!data.effectiveScenarioId) return
    void runCash({
      scenario_id: data.effectiveScenarioId, objective: f.objective, alpha: f.alpha,
      beta: f.beta, l_min: f.lMin, financing_stage: f.financing, pol_curve: true,
      schedule_ref_id: r?.plan_id || undefined, horizon_hours: data.run?.horizon_hours,
    })
  }

  if (!r) {
    return (
      <div className="wz-step">
        <InlineError tone="warn" title="Результата ещё нет" message={plan.error ?? 'Запустите расчёт на шаге «Запуск».'} onRetry={() => navigateTo('plan', 'new/launch')} retryLabel="К запуску" />
      </div>
    )
  }
  return (
    <div className="wz-step wz-step--result">
      {plan.running && <RunProgress phases={[{ id: 'rerun', title: 'Пересчёт с правками', weight: 1 }]} running etaSeconds={20} title="Пересчитываем план" />}
      {cash.running && <RunProgress phases={CASH_PHASES} running etaSeconds={15} title="Считаем кассу (HiGHS)" />}
      {plan.error && !plan.running && <InlineError title="Пересчёт не удался" message={plan.error} onRetry={rerun} />}
      <PlanResult
        result={r} pins={plan.pins} onPin={planActions.addPin} onClearPins={planActions.clearPins} onRerun={rerun} running={plan.running}
        cash={{ result: cash.result, running: cash.running, error: cash.error, onRun: cashRun }}
      />
      <section className="wz-card" aria-label="Сравнить с…">
        <p className="wz-card__t">Сравнить с… · история прогонов (отметьте два)</p>
        <RunsTable currentId={r.plan_id ?? null} />
      </section>
    </div>
  )
}
