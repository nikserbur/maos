/**
 * Шаг 6 «Запуск» (UX-V2 §4.2, §4.6): сводка-дифф «Наследовано · Изменено · Не задано» с переходами,
 * оценка времени по N и числу операций, единственная primary мастера «Запустить»; прогресс по фазам
 * (фронтовая оценка). Успех — переход на адрес прогона `#/plan/run/<id>`; ошибки — явно, с повтором.
 * Значения — словами общего словаря (labels.ts), без id API.
 */
import { useMemo } from 'react'
import { money, num, pct } from '../../../../explain/format'
import { financingLabel, objectiveLabel, ruleLabel } from '../../../../explain/labels'
import { toIsoDate } from '../dates'
import { DiffList } from '../../../../ui/DiffList'
import { RunProgress, SCHEDULE_PHASES, estimateScheduleSeconds } from '../../../../ui/RunProgress'
import { navigateTo } from '../../../../shell/router'
import { useRefs } from '../../../method-map/useMethodMapState'
import { getPlanState, usePlanStore } from '../../planStore'
import { openRun } from '../../planNav'
import { InlineError } from '../../../../ui/kit'
import { emptyProgramMessage, runSchedule } from '../runSchedule'
import type { WizardData } from '../useWizardData'
import { diffFields, effectiveFields, useWizard, type FieldKey, type WizardFields } from '../wizardStore'

export const fmtField = (key: FieldKey, v: WizardFields[FieldKey]): string => {
  if (v === null || v === undefined) return 'задаёт планировщик'
  switch (key) {
    case 'alpha': case 'beta': return pct(Number(v), 0)
    case 'lMin': return money(Number(v))
    case 'samples': return `${num(Number(v), 0)} прогонов`
    case 'tailWeight': return pct(Number(v), 0)
    case 'wTime': case 'wRisk': case 'wCost': return num(Number(v), 2)
    case 'useCalendar': return v ? 'учитывать' : 'круглосуточно (24×7)'
    case 'rule': return ruleLabel(String(v), 'long')
    case 'objective': return objectiveLabel(String(v), 'long')
    case 'cashCriterion': return v === 'profit' ? 'CVaR прибыли' : v === 'cash' ? 'CVaR кассы' : 'прибыль и касса'
    case 'financing': return financingLabel(String(v), 'long')
    default: return String(v)
  }
}

const methodText = (rule: string): string => (rule === 'auto' ? '7 правил + генетический алгоритм' : rule === 'custom' ? 'своя эвристика' : `правило ${ruleLabel(rule)}`)

export function LaunchStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const plan = usePlanStore()
  const refs = useRefs()
  const f = effectiveFields(w)
  const rows = useMemo(() => diffFields({ base: w.base, overrides: w.overrides, owners: w.owners, format: fmtField }), [w.base, w.overrides, w.owners])
  const blocker = emptyProgramMessage(w, data.program, data.plans.length > 0, data.products.length > 0)
  const ops = Math.max(1, data.program.length) * Math.max(1, Math.round(refs.counts.operations / Math.max(1, refs.counts.routings)))
  const eta = estimateScheduleSeconds(f.samples, ops, f.rule === 'auto')

  const goStep = (step: string) => navigateTo('plan', `new/${step}`)
  // Не блокируем кнопку заранее: объясняем при нажатии (X2 «никогда не выключать primary молча»).
  const launch = async () => {
    if (blocker || plan.running) return
    const r = await runSchedule(w, data.program, toIsoDate(data.start.date), { scenarioName: data.scenario?.name, scenarioId: data.effectiveScenarioId })
    const key = getPlanState().resultKey
    if (r && key) openRun(key)
  }

  return (
    <div className="wz-step">
      <section className="wz-card" aria-label="Сводка параметров прогона">
        <p className="wz-card__t">Что уйдёт в расчёт</p>
        <DiffList rows={rows} onGo={goStep} />
      </section>
      <section className="wz-card" aria-label="Запуск">
        <div className="wz-launch">
          <div>
            <p className="wz-card__t">Стадия 1 · {num(data.program.length, 0)} заказов · N = {num(f.samples, 0)} · {methodText(f.rule)}</p>
            <p className="pl-note">Оценка времени: ≈ {num(eta, 0)} с (по N и ~{num(ops, 0)} операциям). Касса считается отдельно — в разделе «Касса» результата.</p>
            {blocker && <InlineError tone="warn" title="Планировать нечего" message={blocker} onRetry={() => goStep('program')} retryLabel="К программе" />}
            {plan.error && !plan.running && <InlineError title="Планирование не удалось" error={plan.error} onRetry={launch} />}
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={launch} aria-disabled={plan.running || Boolean(blocker)}>
            {plan.running ? 'Строим план…' : 'Запустить'}
          </button>
        </div>
        <RunProgress phases={SCHEDULE_PHASES} running={plan.running} etaSeconds={eta} title="Строим план" />
      </section>
    </div>
  )
}
