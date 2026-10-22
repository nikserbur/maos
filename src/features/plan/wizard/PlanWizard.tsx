/**
 * Направляемый поток создания плана (UX-V2 §4.1): маршрут `#/plan/new/<step>`, слева вертикальный
 * степпер (7 шагов, глифы как на карте), справа содержимое шага, внизу «Назад · Далее · Запустить».
 * Все шаги доступны после первого; «Запустить» подсвечивает незавершённые. Один источник данных —
 * useWizardData; состояние — wizardStore (переживает смену экрана).
 */
import { useEffect } from 'react'
import { useHashRoute } from '../../../shell/router'
import { Stepper, type StepDef } from '../../../ui/Stepper'
import { BLOCK_META } from '../../method-map/blocks'
import { useCashStore } from '../../finance/cashStore'
import { usePassport } from '../../passport/passportStore'
import { usePlanStore } from '../planStore'
import { ConditionsStep } from './steps/ConditionsStep'
import { ConstraintsStep } from './steps/ConstraintsStep'
import { DistributionsStep } from './steps/DistributionsStep'
import { LaunchStep } from './steps/LaunchStep'
import { ObjectiveStep } from './steps/ObjectiveStep'
import { ProgramStep } from './steps/ProgramStep'
import { ResultStep } from './steps/ResultStep'
import { useWizardData } from './useWizardData'
import { WIZARD_STEPS, stepState, useWizard, wizardActions, type WizardStep } from './wizardStore'
import './wizard.css'

const STEP_META: Readonly<Record<WizardStep, { title: string; block?: keyof typeof BLOCK_META; hint: string }>> = {
  program: { title: 'Программа', hint: 'Что и к какому сроку производить' },
  conditions: { title: 'Условия', block: 'external', hint: 'Сценарий, генератор, режимы' },
  distributions: { title: 'Распределения', block: 'distributions', hint: 'Хвосты длительностей, поломки, цены' },
  constraints: { title: 'Ограничения', block: 'internal', hint: 'Мощности, календарь, труд, MRP, деньги' },
  objective: { title: 'Цель и риск', block: 'criteria', hint: 'Пресеты, веса, α, метод поиска' },
  launch: { title: 'Запуск', hint: 'Сводка-дифф и прогресс' },
  result: { title: 'Результат', block: 'decisions', hint: 'KPI, Гант, касса, сравнение' },
}

export function PlanWizard({ routeStep }: { routeStep: string | null }) {
  const w = useWizard()
  const plan = usePlanStore()
  const cash = useCashStore()
  const passport = usePassport()
  const data = useWizardData()
  const { navigate } = useHashRoute()

  // Маршрут ↔ шаг: `#/plan/new/<step>`; неизвестный шаг → текущий из хранилища.
  useEffect(() => {
    if (routeStep && (WIZARD_STEPS as readonly string[]).includes(routeStep) && routeStep !== w.step) wizardActions.setStep(routeStep as WizardStep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStep])
  // Источник истины — маршрут: шаги меняются только через navigate (иначе эффекты зацикливаются).
  const go = (step: WizardStep) => { wizardActions.setStep(step); navigate('plan', `new/${step}`) }

  const readiness = {
    programOk: w.source === 'portfolio' ? Boolean(w.runId) : data.program.length > 0,
    scenarioOk: Boolean(data.scenario),
    finOk: passport.finStatus !== 'error',
    running: plan.running || cash.running,
    hasResult: Boolean(plan.result),
  }
  const steps: StepDef<WizardStep>[] = WIZARD_STEPS.map((id, i) => ({
    id, n: i + 1, title: STEP_META[id].title, hint: STEP_META[id].hint,
    block: STEP_META[id].block ? `[${BLOCK_META[STEP_META[id].block!].n}]` : undefined,
    blockColor: STEP_META[id].block ? BLOCK_META[STEP_META[id].block!].colorVar : undefined,
    state: stepState(w, id, readiness),
    disabled: id === 'result' && !readiness.hasResult,
  }))
  const idx = WIZARD_STEPS.indexOf(w.step)
  const incomplete = steps.filter((s) => s.state === 'empty' || s.state === 'warn').map((s) => s.title)
  const Body = { program: ProgramStep, conditions: ConditionsStep, distributions: DistributionsStep, constraints: ConstraintsStep, objective: ObjectiveStep, launch: LaunchStep, result: ResultStep }[w.step]
  const meta = STEP_META[w.step]

  return (
    <div className="wz">
      <Stepper steps={steps} current={w.step} onSelect={go} />
      <div className="wz-main">
        <header className="wz-head">
          <p className="wz-head__eyebrow text-caps">Шаг {idx + 1} из {WIZARD_STEPS.length}{meta.block && <> · блок [{BLOCK_META[meta.block].n}] <a className="pf-link" href={`#/map/${meta.block}`}>{BLOCK_META[meta.block].title} ↗</a></>}</p>
          <h2 className="wz-head__title">{meta.title}</h2>
          <p className="wz-head__hint">{meta.hint}</p>
        </header>
        {data.error && <p className="pl-note" style={{ color: 'var(--intent-danger)' }}>{data.error}</p>}
        <Body data={data} />
        <footer className="wz-foot">
          <button type="button" className="btn" onClick={() => go(WIZARD_STEPS[Math.max(0, idx - 1)])} disabled={idx === 0}>← Назад</button>
          <span className="wz-foot__hint">{incomplete.length > 0 ? <>не завершено: {incomplete.join(', ')}</> : 'все шаги готовы'}</span>
          {w.step === 'launch' || w.step === 'result'
            ? <button type="button" className="btn" onClick={() => go('program')}>К программе</button>
            : <button type="button" className="btn btn--primary" onClick={() => go(WIZARD_STEPS[idx + 1])}>Далее →</button>}
          {w.step !== 'launch' && w.step !== 'result' && (
            <button type="button" className={`btn${incomplete.length ? '' : ' btn--primary'}`} onClick={() => go('launch')} title={incomplete.length ? `Не завершено: ${incomplete.join(', ')}` : undefined}>Запустить…</button>
          )}
        </footer>
      </div>
    </div>
  )
}
