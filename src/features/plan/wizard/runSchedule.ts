/**
 * Запуск Стадии 1 из мастера: собирает `ScheduleParams` из эффективных полей (база + переопределения),
 * программы по источнику и пинов; пишет статус в `planStore`, контекст решения — в `DecisionContext`.
 * После успеха: результат — в planStore (его читает карта) по адресу `#/plan/run/<key>`, паспорт
 * прогона (правило, источник, параметры мастера) — в runMeta для истории и «Повторить», индекс
 * прогонов перечитывается (номер №N). Касса не запускается автоматически — отдельное действие.
 */
import { api, type ScheduleParams, type ScheduleResult } from '../../../lib/api'
import { setDecisionContext } from '../../../shell/context'
import { planActions, getPlanState } from '../planStore'
import { refreshRunIndex } from '../runIndex'
import { browserStorage, snapshotOf, writeRunMeta } from '../runMeta'
import type { Crit } from '../types'
import { effectiveFields, type WizardOrder, type WizardState } from './wizardStore'

export function buildScheduleParams(w: WizardState, program: readonly WizardOrder[], pins: ReadonlyMap<number, number>, prev: ScheduleResult | null): ScheduleParams {
  const f = effectiveFields(w)
  const crits: readonly Crit[] = w.crits
  return {
    // Правило «RL» бэкенд ждёт в верхнем регистре (A1 §6); конструктор эвристики идёт как auto + custom_rule.
    rule: f.rule === 'custom' ? 'auto' : f.rule === 'rl' ? 'RL' : f.rule,
    custom_rule: f.rule === 'custom' ? crits.filter((c) => c.weight > 0).map((c) => ({ criterion: c.criterion, weight: c.dir * c.weight })) : undefined,
    samples: f.samples || 500,
    w_time: f.wTime, w_risk: f.wRisk, w_cost: f.wCost, alpha: f.alpha,
    tail_weight: f.tailWeight ?? undefined,
    use_calendar: f.useCalendar,
    run_id: w.source === 'portfolio' && w.runId ? w.runId : undefined,
    program: w.source === 'portfolio' ? undefined : program.map((o) => ({ product_id: o.product_id, qty: o.qty, due_hours: o.due_hours || undefined })),
    pins: pins.size > 0 && prev ? [...pins.entries()].map(([job_idx, start_hours]) => ({
      job_idx, start_hours, machine_id: prev.gantt.find((g) => g.job_idx === job_idx)?.machine_id || undefined,
    })) : undefined,
  }
}

/** Сообщение, если планировать нечего (как в старом экране — пользователь должен понять, что не так). */
export function emptyProgramMessage(w: WizardState, program: readonly WizardOrder[], hasPlans: boolean, hasProducts: boolean): string | null {
  if (w.source === 'portfolio') return w.runId ? null : 'Выберите портфель Стадии 2 на шаге «Программа».'
  if (program.length > 0) return null
  if (!hasProducts) return 'Нет товарных изделий для заказов. Откройте «Справочники → Изделия», создайте изделие и отметьте «Товарная позиция».'
  if (w.source === 'orders' && !hasPlans) return 'Программа пуста: создайте производственный план (кнопка «+ План») и добавьте в него заказы.'
  return 'В программе нет заказов. Добавьте их на шаге «Программа»: изделие, количество, срок.'
}

export interface RunScheduleMeta {
  /** Имя сценария — для подписи «Источник/сценарий» в истории. */
  scenarioName?: string
  scenarioId?: string
}

/** `startDate` — начало горизонта (ISO-дата) для оси дат Ганта; без него остаётся прежнее. */
export async function runSchedule(w: WizardState, program: readonly WizardOrder[], startDate?: string, meta: RunScheduleMeta = {}): Promise<ScheduleResult | null> {
  const ps = getPlanState()
  const params = buildScheduleParams(w, program, ps.pins, ps.result)
  const token = planActions.beginRun()
  planActions.setParam('rule', effectiveFields(w).rule)
  planActions.setParam('samples', String(params.samples))
  planActions.setParam('wRisk', String(params.w_risk))
  planActions.setParam('runId', params.run_id ?? '')
  planActions.setParam('useCalendar', Boolean(params.use_calendar))
  try {
    const r = await api.schedule.run(params)
    if (r.error_soft) {
      planActions.failRun(token, r.warnings?.join(' ') || 'Нет данных для плана')
      return null
    }
    planActions.finishRun(token, r, { startDate })
    const st = getPlanState()
    if (st.resultKey && st.result === r) {
      writeRunMeta(browserStorage(), {
        key: st.resultKey, rule: r.rule, adopted: Boolean(r.improver?.adopted), source: w.source,
        scenarioId: meta.scenarioId ?? w.scenarioId, scenarioName: meta.scenarioName ?? '', builtAt: st.builtAt ?? Date.now(),
        params: snapshotOf({ ...w, startDate: startDate ?? w.startDate, scenarioId: meta.scenarioId ?? w.scenarioId }),
      })
    }
    void refreshRunIndex()
    if (r.plan_id) setDecisionContext({ scheduleRunId: r.plan_id })
    return r
  } catch (e) {
    planActions.failRun(token, e instanceof Error ? e.message : 'Ошибка планирования')
    return null
  }
}
