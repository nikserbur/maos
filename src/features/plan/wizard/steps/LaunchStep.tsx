/**
 * Шаг 6 «Запуск» (UX-V2 §4.2, §4.6): сводка-дифф «Наследовано · Изменено · Не задано» с переходами,
 * оценка времени по N и числу операций, кнопка; прогресс по фазам (фронтовая оценка до появления
 * `GET /api/runs/:id/progress`); ошибки — явно, с повтором.
 */
import { useMemo } from 'react'
import { money, pct } from '../../../../explain/format'
import { toIsoDate } from '../dates'
import { DiffList } from '../../../../ui/DiffList'
import { RunProgress, SCHEDULE_PHASES, estimateScheduleSeconds } from '../../../../ui/RunProgress'
import { navigateTo } from '../../../../shell/router'
import { useRefs } from '../../../method-map/useMethodMapState'
import { usePlanStore } from '../../planStore'
import { RULES } from '../../types'
import { InlineError } from '../../ui'
import { emptyProgramMessage, runSchedule } from '../runSchedule'
import type { WizardData } from '../useWizardData'
import { diffFields, effectiveFields, useWizard, type FieldKey, type WizardFields } from '../wizardStore'

const fmtField = (key: FieldKey, v: WizardFields[FieldKey]): string => {
  if (v === null || v === undefined) return '—'
  switch (key) {
    case 'alpha': case 'beta': return pct(Number(v), 0)
    case 'lMin': return money(Number(v))
    case 'useCalendar': return v ? 'учитывать' : '24×7'
    case 'rule': return RULES.find((r) => r.id === v)?.label ?? String(v)
    case 'cashCriterion': return v === 'profit' ? 'CVaR прибыли' : v === 'cash' ? 'CFaR' : 'оба'
    case 'financing': return v === 'recourse' ? 'рекурс' : 'график заранее'
    default: return String(v)
  }
}

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
  const launch = async () => {
    const r = await runSchedule(w, data.program, toIsoDate(data.start.date))
    if (r) goStep('result')
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
            <p className="wz-card__t">Стадия 1 · {data.program.length} заказов · N = {f.samples} · {f.rule === 'auto' ? '7 правил + ГА' : f.rule === 'custom' ? 'конструктор эвристики' : `правило ${f.rule}`}</p>
            <p className="pl-note">Оценка времени: ≈ {Math.round(eta)} с (по N и ~{ops} операциям; ГА удваивает). Касса считается отдельно на шаге «Результат».</p>
            {blocker && <InlineError tone="warn" title="Планировать нечего" message={blocker} onRetry={() => goStep('program')} retryLabel="К программе" />}
            {plan.error && !plan.running && <InlineError title="Планирование не удалось" message={plan.error} onRetry={launch} />}
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={launch} disabled={plan.running || Boolean(blocker)}>
            {plan.running ? 'Строим план…' : 'Запустить'}
          </button>
        </div>
        <RunProgress phases={SCHEDULE_PHASES} running={plan.running} etaSeconds={eta} title="Строим план" />
      </section>
    </div>
  )
}
