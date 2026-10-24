/**
 * Экран «План» (X2 «один адрес — одна вещь»): `#/plan` — история прогонов с быстрым путём к последнему,
 * `#/plan/new/<шаг>` — мастер нового плана (6 шагов), `#/plan/run/<id>[/<раздел>]` — результат прогона
 * (единственное место, где он рисуется). Результат и мастер переживают F5: адрес + кэш этой машины +
 * черновик мастера. Расчёт, пины и результат живут в planStore (их читает карта), касса — в cashStore.
 */
import { useEffect } from 'react'
import { anchorParts, replaceRoute, useHashRoute } from '../../shell/router'
import { setDecisionContext } from '../../shell/context'
import { ScreenHeader } from '../../ui/kit'
import { PlanHistory } from './PlanHistory'
import { RunView } from './RunView'
import { PlanWizard } from './wizard/PlanWizard'
import { getPlanState, planActions, usePlanStore } from './planStore'
import './plan.css'
import './plan-screen.css'

export function PlanScreen() {
  const { anchor, navigate } = useHashRoute()
  const plan = usePlanStore()
  const parts = anchorParts(anchor)
  const mode = parts[0] === 'new' ? 'wizard' : parts[0] === 'run' && parts[1] ? 'run' : 'history'

  // Полоса методологии и родословная читают последний результат — поднимаем его из кэша один раз.
  useEffect(() => { planActions.hydrate() }, [])
  useEffect(() => { if (plan.activePlan) setDecisionContext({ planId: plan.activePlan }) }, [plan.activePlan])

  // Прежний адрес шага «Результат» мастера → адрес прогона (одна вещь — один адрес).
  useEffect(() => {
    if (mode !== 'wizard' || parts[1] !== 'result') return
    const key = getPlanState().resultKey
    replaceRoute('plan', key ? `run/${key}` : null)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [mode, parts[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  if (mode === 'wizard') {
    return (
      <div className="plan">
        <ScreenHeader compact eyebrow="Решения · Стадия 1" title="Новый план"
          actions={<button type="button" className="btn" onClick={() => navigate('plan')}>← К прогонам</button>} />
        <PlanWizard routeStep={parts[1] && parts[1] !== 'result' ? parts[1] : null} />
      </div>
    )
  }
  return (
    <div className="plan">
      {mode === 'run' ? <RunView runKey={parts[1]} section={parts[2] ?? null} /> : <PlanHistory />}
    </div>
  )
}
