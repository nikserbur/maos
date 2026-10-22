/**
 * Экран «План» (UX-V2 §4.1): `#/plan` — история прогонов + последний результат с оглавлением;
 * «Новый план» → направляемый поток `#/plan/new/<step>` (PlanWizard). Расчёт, пины и результат
 * живут в planStore (их читает карта методологии), касса — в cashStore. Гант, нагрузка, MRP,
 * конструктор эвристики вынесены в свои файлы без изменения поведения.
 */
import { useEffect } from 'react'
import { hours, num, pct } from '../../explain/format'
import { useHashRoute } from '../../shell/router'
import { setDecisionContext } from '../../shell/context'
import { BlockChips } from '../../ui/BlockChip'
import { runCash, useCashStore } from '../finance/cashStore'
import { PlanResult } from './PlanResult'
import { RunsTable } from './RunsTable'
import { PlanWizard } from './wizard/PlanWizard'
import { runSchedule } from './wizard/runSchedule'
import { effectiveFields, useWizard } from './wizard/wizardStore'
import { planActions, usePlanStore } from './planStore'
import { Chip, InlineError } from './ui'
import './plan.css'
import './plan-screen.css'

export function PlanScreen() {
  const { anchor, navigate } = useHashRoute()
  const plan = usePlanStore()
  const cash = useCashStore()
  const w = useWizard()
  const wizardOn = anchor === 'new' || anchor?.startsWith('new/')
  const routeStep = anchor?.startsWith('new/') ? anchor.slice(4) : null

  useEffect(() => { if (plan.activePlan) setDecisionContext({ planId: plan.activePlan }) }, [plan.activePlan])

  const r = plan.result
  const f = effectiveFields(w)
  // Пересчёт с правками: из портфеля — тем же run_id; из реестра/вручную программа живёт в мастере → ведём туда.
  const rerun = async () => {
    if (w.source === 'portfolio' && w.runId) await runSchedule(w, [])
    else navigate('plan', 'new/result')
  }
  const cashRun = () => {
    if (!w.scenarioId) { navigate('plan', 'new/conditions'); return }
    void runCash({ scenario_id: w.scenarioId, alpha: f.alpha, beta: f.beta, l_min: f.lMin, financing_stage: f.financing, pol_curve: true, schedule_ref_id: r?.plan_id || undefined })
  }

  return (
    <div className="plan">
      <div className="plan__head">
        <div>
          <h1 className="plan__title">
            Производственный план (Стадия 1 — как произвести)
            <span className="plan__blocks"><BlockChips blocks={['internal', 'decisions', 'criteria']} /></span>
          </h1>
          <p className="plan__subtitle">
            Программа разворачивается в граф операций по техкартам и цепочке; симуляция ставит операции на станки нужного типа и рабочих.
            Оптимизируется <strong>порядок</strong> операций под целевую функцию; длительности — <strong>тяжелохвостные</strong> (Монте-Карло),
            поэтому виден риск срыва срока, узкие места, простои и касса.
          </p>
        </div>
        <div className="plan__head-actions">
          {wizardOn
            ? <button type="button" className="btn" onClick={() => navigate('plan')}>← К прогонам</button>
            : <button type="button" className="btn btn--primary" onClick={() => navigate('plan', `new/${w.step === 'result' && !r ? 'program' : w.step}`)}>＋ Новый план</button>}
        </div>
      </div>

      {wizardOn ? (
        <PlanWizard routeStep={routeStep} />
      ) : (
        <>
          <section className="plan__panel" aria-label="История прогонов">
            <p className="plan__section-title" style={{ marginTop: 0 }}>История прогонов · отметьте два для сравнения</p>
            <RunsTable currentId={r?.plan_id ?? null} />
          </section>
          {plan.error && !plan.running && <InlineError title="Последний расчёт не удался" message={plan.error} onRetry={() => navigate('plan', 'new/launch')} retryLabel="К запуску" />}
          {r ? (
            <>
              <p className="plan__section-title" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                Последний результат
                <Chip>{r.rule}</Chip>
                <Chip>E[Cmax] {hours(r.kpi.makespan_mean, 0)}</Chip>
                <Chip tone={r.kpi.otd >= 0.99 ? 'good' : 'warn'}>OTD {pct(r.kpi.otd, 0)}</Chip>
                <Chip>{num(r.n_orders, 0)} заказов · {num(r.n_jobs, 0)} операций</Chip>
                {plan.builtAt && <span className="pl-note">построен {new Date(plan.builtAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                <a className="pf-link" href="#/plan/new/result">открыть в мастере →</a>
              </p>
              <PlanResult result={r} pins={plan.pins} onPin={planActions.addPin} onClearPins={planActions.clearPins} onRerun={rerun} running={plan.running}
                cash={{ result: cash.result, running: cash.running, error: cash.error, onRun: cashRun }} />
            </>
          ) : (
            <div className="pl-empty">
              <p className="pl-empty__title">План ещё не построен</p>
              <p className="pl-empty__text">
                Путь: <b>Программа</b> (портфель Стадии 2 или реестр заказов) → <b>Условия</b> (сценарий и генератор) → <b>Распределения</b> →
                <b> Ограничения</b> (мощности, календарь, деньги) → <b>Цель и риск</b> → <b>Запуск</b> → <b>Результат</b> с кассой.
              </p>
              <button type="button" className="btn btn--primary" onClick={() => navigate('plan', 'new/program')}>Начать: программа →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
