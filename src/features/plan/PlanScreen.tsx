/**
 * Экран «План» (UX-V2 §4.1, композиция X1 §5.1): шапка в одну строку (eyebrow «Решения ·
 * Стадия 1», номер плана, правило, дата), последний результат с оглавлением, история прогонов —
 * свёрнутая секция ПОСЛЕ результата (строка открывает прогон). «Новый план» → направляемый
 * поток `#/plan/new/<step>` (PlanWizard). Результат переживает F5: planStore.hydrate() из кэша.
 * Расчёт, пины и результат живут в planStore (их читает карта методологии), касса — в cashStore.
 */
import { useEffect } from 'react'
import { hours, num, pct } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { useHashRoute } from '../../shell/router'
import { setDecisionContext } from '../../shell/context'
import { BlockChips } from '../../ui/BlockChip'
import { getDiagram } from '../../diagrams'
import { runCash, useCashStore } from '../finance/cashStore'
import { PlanResult } from './PlanResult'
import { RunsTable } from './RunsTable'
import { PlanWizard } from './wizard/PlanWizard'
import { runSchedule } from './wizard/runSchedule'
import { effectiveFields, useWizard } from './wizard/wizardStore'
import { cachedPlanIds, planActions, usePlanStore } from './planStore'
import { Chip, InlineError } from './ui'
import './plan.css'
import './plan-screen.css'

/** Схема двухуровневой модели в пустом состоянии — та же, что в «i» и «Методике». */
const EMPTY_DIAGRAM = getDiagram('two-stages')

const fmtBuilt = (ms: number) => new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function PlanScreen() {
  const { anchor, navigate } = useHashRoute()
  const plan = usePlanStore()
  const cash = useCashStore()
  const w = useWizard()
  const wizardOn = anchor === 'new' || anchor?.startsWith('new/')
  const routeStep = anchor?.startsWith('new/') ? anchor.slice(4) : null

  // Результат переживает перезагрузку: поднимаем последний прогон из кэша, если в памяти пусто.
  useEffect(() => { planActions.hydrate() }, [])
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
  const cached = cachedPlanIds()
  const openRun = (id: string) => { if (!planActions.openCached(id)) planActions.setError('Полный результат этого прогона не сохранён на этой машине.') }

  return (
    <div className="plan">
      <header className="plan__head">
        <div className="plan__head-main">
          <p className="plan__eyebrow text-caps">Решения · Стадия 1 — как произвести</p>
          <h1 className="plan__title">
            {wizardOn ? 'Новый план' : 'План'}
            {!wizardOn && r && (
              <span className="plan__meta num">
                {r.plan_id ? `#${r.plan_id.slice(0, 6)}` : ''} · {r.rule}{r.improver?.adopted ? ' + ГА' : ''}
                {plan.builtAt && <> · {fmtBuilt(plan.builtAt)}</>}
                {plan.restored && <Chip tone="idle" title="Поднят из кэша этой машины после перезагрузки">из кэша</Chip>}
              </span>
            )}
          </h1>
        </div>
        <div className="plan__head-actions">
          <BlockChips blocks={['internal', 'decisions', 'criteria']} />
          {wizardOn
            ? <button type="button" className="btn" onClick={() => navigate('plan')}>← К прогонам</button>
            : <button type="button" className="btn" onClick={() => navigate('plan', `new/${w.step === 'result' && !r ? 'program' : w.step}`)}><Icon name="plus" size={14} /> Новый план</button>}
        </div>
      </header>

      {wizardOn ? (
        <PlanWizard routeStep={routeStep} />
      ) : (
        <>
          {plan.error && !plan.running && <InlineError title="Последний расчёт не удался" message={plan.error} onRetry={() => navigate('plan', 'new/launch')} retryLabel="К запуску" onDismiss={() => planActions.setError(null)} />}
          {r ? (
            <PlanResult result={r} pins={plan.pins} onPin={planActions.addPin} onClearPins={planActions.clearPins} onRerun={rerun} running={plan.running}
              startDate={plan.startDate} cash={{ result: cash.result, running: cash.running, error: cash.error, onRun: cashRun }} />
          ) : (
            <div className="pl-empty">
              <div>
                <p className="pl-empty__title">План ещё не построен</p>
                <p className="pl-empty__text">
                  Программа разворачивается в граф операций по техкартам; симуляция ставит операции на станки и рабочих,
                  оптимизируется <b>порядок</b> операций под целевую функцию при <b>тяжелохвостных</b> длительностях (Монте-Карло) —
                  видны риск срыва срока, узкие места, простои и касса.
                </p>
                <ol className="pl-empty__steps">
                  {['Программа', 'Условия', 'Распределения', 'Ограничения', 'Цель и риск', 'Запуск', 'Результат с кассой'].map((t, i) => (
                    <li key={t}><span className="pl-empty__mark">{i + 1}</span>{t}</li>
                  ))}
                </ol>
                <button type="button" className="btn btn--primary" onClick={() => navigate('plan', 'new/program')}>Начать: программа →</button>
              </div>
              <div className="pl-empty__art" aria-hidden="true">{EMPTY_DIAGRAM && <EMPTY_DIAGRAM.Component compact />}</div>
            </div>
          )}

          <details className="pl-more pl-history" open={!r}>
            <summary className="pl-more__sum">
              <span className="pl-more__caret" aria-hidden="true">▸</span>
              Прогоны
              {r && <span className="pl-more__hint">E[Cmax] {hours(r.kpi.makespan_mean, 0)} · OTD {pct(r.kpi.otd, 0)} · {num(r.n_orders, 0)} заказов · отметьте два для сравнения, клик — открыть</span>}
            </summary>
            <div className="pl-card pl-card--scroll">
              <RunsTable currentId={r?.plan_id ?? null} onOpen={(row) => openRun(row.id)} canOpen={(id) => cached.has(id)} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}
