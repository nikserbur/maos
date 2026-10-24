/**
 * Направляемый поток создания плана (UX-V2 §4.1): маршрут `#/plan/new/<step>`, слева вертикальный
 * степпер (6 шагов, глифы как на карте), справа содержимое шага, внизу «← Условия · Распределения →»
 * (кнопки названы шагами). Результат — не шаг мастера: «Запустить» ведёт на адрес прогона
 * `#/plan/run/<id>`. «Запустить» — единственная primary мастера (внутри LaunchStep).
 * Текущий шаг — из адреса (источник истины), хранилище догоняет его; черновик переживает F5.
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
import { useWizardData } from './useWizardData'
import { WIZARD_STEPS, stepState, useWizard, wizardActions, type WizardStep } from './wizardStore'
import './wizard.css'

export const STEP_META: Readonly<Record<WizardStep, { title: string; block?: keyof typeof BLOCK_META; hint: string }>> = {
  program: { title: 'Программа', hint: 'Что и к какому сроку производить' },
  conditions: { title: 'Условия', block: 'external', hint: 'Сценарий, генератор, режимы' },
  distributions: { title: 'Распределения', block: 'distributions', hint: 'Хвосты длительностей, поломки, цены' },
  constraints: { title: 'Ограничения', block: 'internal', hint: 'Мощности, календарь, труд, материалы, деньги' },
  objective: { title: 'Цель и риск', block: 'criteria', hint: 'Склонность к риску и метод поиска порядка' },
  launch: { title: 'Запуск', hint: 'Что уйдёт в расчёт, прогресс' },
}

/** Шаги, которые не бывают «не завершены»: запуск — действие, а не ввод. */
const NOT_INPUT: ReadonlySet<WizardStep> = new Set(['launch'])

export function PlanWizard({ routeStep }: { routeStep: string | null }) {
  const w = useWizard()
  const plan = usePlanStore()
  const cash = useCashStore()
  const passport = usePassport()
  const data = useWizardData()
  const { navigate } = useHashRoute()
  const fromRoute = routeStep && (WIZARD_STEPS as readonly string[]).includes(routeStep) ? (routeStep as WizardStep) : null
  const step: WizardStep = fromRoute ?? w.step

  // Маршрут → хранилище (подсветка степпера сразу по адресу, без кадра со старым шагом).
  useEffect(() => {
    if (fromRoute && fromRoute !== w.step) wizardActions.setStep(fromRoute)
  }, [fromRoute, w.step])
  // Источник истины — маршрут: шаги меняются только через navigate (иначе эффекты зацикливаются).
  const go = (s: WizardStep) => { wizardActions.setStep(s); navigate('plan', `new/${s}`) }

  const readiness = {
    programOk: w.source === 'portfolio' ? Boolean(w.runId) : data.program.length > 0,
    scenarioOk: Boolean(data.scenario),
    finOk: passport.finStatus !== 'error',
    running: plan.running || cash.running,
  }
  const steps: StepDef<WizardStep>[] = WIZARD_STEPS.map((id, i) => ({
    id, n: i + 1, title: STEP_META[id].title, hint: STEP_META[id].hint,
    blockColor: STEP_META[id].block ? BLOCK_META[STEP_META[id].block!].colorVar : undefined,
    state: stepState(w, id, readiness),
  }))
  const idx = WIZARD_STEPS.indexOf(step)
  const incomplete = steps.filter((s) => !NOT_INPUT.has(s.id) && (s.state === 'empty' || s.state === 'warn')).map((s) => s.title)
  const Body = { program: ProgramStep, conditions: ConditionsStep, distributions: DistributionsStep, constraints: ConstraintsStep, objective: ObjectiveStep, launch: LaunchStep }[step]
  const meta = STEP_META[step]
  const prev = idx > 0 ? WIZARD_STEPS[idx - 1] : null
  const next = idx < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[idx + 1] : null

  return (
    <div className="wz">
      <Stepper steps={steps} current={step} onSelect={go} />
      <div className="wz-main">
        <header className="wz-head">
          <span className="wz-head__eyebrow text-caps">Шаг {idx + 1} из {WIZARD_STEPS.length}</span>
          <h2 className="wz-head__title">{meta.title}</h2>
          <span className="wz-head__hint">{meta.hint}</span>
          {meta.block && <a className="pf-link wz-head__block" href={`#/map/${meta.block}`}>[{BLOCK_META[meta.block].n}] {BLOCK_META[meta.block].title} ↗</a>}
        </header>
        {data.error && <p className="pl-note pl-note--danger"><span className="glyph-x" aria-hidden="true" />Данные мастера: {data.error}. Шаги покажут то, что есть.</p>}
        <div key={step} className="wz-step-enter"><Body data={data} /></div>
        <footer className="wz-foot">
          {prev ? <button type="button" className="btn" onClick={() => go(prev)}>← {STEP_META[prev].title}</button> : <span />}
          <span className="wz-foot__hint">{incomplete.length > 0 ? <><span className="glyph-setup" aria-hidden="true" />не завершено: {incomplete.join(', ')}</> : 'все шаги готовы'}</span>
          {next && <button type="button" className="btn" onClick={() => go(next)}>{STEP_META[next].title} →</button>}
        </footer>
      </div>
    </div>
  )
}
