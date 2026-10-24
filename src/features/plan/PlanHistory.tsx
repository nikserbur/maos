/**
 * История прогонов `#/plan` (X2 «быстрый путь, без противоречий»): если прогонов нет — первый запуск
 * со схемой двухуровневой модели и одним действием; иначе — одна строка «Последний прогон №28 · CR ·
 * 24.10 17:38 — Открыть · Повторить» и таблица прогонов. Объяснения — в «i» и «Методике».
 */
import { dateTimeShort } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { getDiagram } from '../../diagrams'
import { EmptyState, InlineError, ScreenHeader } from '../../ui/kit'
import { Icon } from '../../shell/icons'
import { navigateTo } from '../../shell/router'
import { openRun, repeatRun, startNewPlan } from './planNav'
import { cachedPlanIds, planActions, usePlanStore } from './planStore'
import { useRunIndex } from './runIndex'
import { browserStorage, runMetaMap } from './runMeta'
import { RunsTable, ruleText, runNo } from './RunsTable'
import './plan-screen.css'

/** Схема двухуровневой модели — та же, что в «i» и «Методике» (если зарегистрирована). */
const HAS_DIAGRAM = Boolean(getDiagram('two-stages'))

export function PlanHistory() {
  const idx = useRunIndex()
  const plan = usePlanStore()
  const rows = idx.rows
  const last = rows?.[0]
  const meta = last ? runMetaMap(browserStorage()).get(last.id) : undefined
  const firstUse = rows !== null && rows.length === 0
  const cached = cachedPlanIds()

  return (
    <>
      <ScreenHeader
        eyebrow="Решения · Стадия 1 — как произвести"
        title="План"
        actions={!firstUse && (
          <button type="button" className="btn btn--primary" onClick={() => startNewPlan()}><Icon name="plus" size={14} /> Новый план</button>
        )}
      />
      {plan.error && !plan.running && (
        <InlineError title="Последний расчёт не удался" error={plan.error} message="Проверьте программу и повторите запуск."
          onRetry={() => navigateTo('plan', 'new/launch')} retryLabel="К запуску" onDismiss={() => planActions.setError(null)} />
      )}
      {plan.running && (
        <p className="pl-fast" role="status">
          <span className="glyph-info" aria-hidden="true" /> Строится новый план —{' '}
          <button type="button" className="pf-link" onClick={() => navigateTo('plan', 'new/launch')}>к прогрессу</button>
        </p>
      )}

      {firstUse && (
        <EmptyState kind="first-use" title="План ещё не построен" diagram={HAS_DIAGRAM ? 'two-stages' : undefined}
          action={<button type="button" className="btn btn--primary" onClick={() => startNewPlan()}>Начать: программа →</button>}>
          Шесть шагов: программа → условия → распределения → ограничения → цель и риск → запуск. Результат — срок с хвостом риска, узкое место и касса.
        </EmptyState>
      )}

      {last && (
        <p className="pl-fast">
          <span className="pl-fast__k text-caps">Последний прогон</span>
          <span className="pl-fast__name num">
            {[`План ${runNo(last)}`, meta ? ruleText(meta) : '', dateTimeShort(last.createdAt)].filter(Boolean).join(' · ')}
          </span>
          <InfoTip id="plan.makespan" values={{ mean: last.kpi?.kpi?.makespan_mean, det: last.kpi?.kpi?.makespan }}
            note="Строка открывает прогон: полный результат — для прогонов этой машины, для остальных — KPI. «Повторить» открывает шаг «Запуск» с теми же параметрами." />
          <span className="pl-fast__sep" aria-hidden="true">—</span>
          <button type="button" className="pf-link" onClick={() => openRun(last.id)}>Открыть</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="pf-link" onClick={() => repeatRun(last.id)}>Повторить</button>
        </p>
      )}

      {(rows === null || rows.length > 0 || idx.error) && (
        <RunsTable currentId={plan.resultKey} canOpen={(id) => cached.has(id)} />
      )}
    </>
  )
}
