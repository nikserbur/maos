/**
 * Результат прогона по его адресу `#/plan/run/<key>[/<раздел>]` (X2 «один адрес — одна шапка»):
 * компактная шапка «План №28 · CR + ГА · 24.10 17:38» + происхождение (сценарий, ▲ устарело),
 * тело — PlanResult из памяти или кэша этой машины, иначе — KPI прогона с сервера. Скопированный
 * адрес воспроизводит прогон и раздел. Пересчёт с правками и касса — с параметрами этого прогона.
 */
import { useEffect, useMemo, useState } from 'react'
import { runLabel } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import { setCrumbTitle } from '../../shell/crumbs'
import { isStale, useInputsChanged } from '../../shell/context'
import { navigateTo } from '../../shell/router'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { runCash, useCashStore } from '../finance/cashStore'
import { Chip, InlineError, ScreenHeader } from '../../ui/kit'
import { KpiOnlyRun } from './KpiOnlyRun'
import { PlanResult } from './PlanResult'
import { openRun, sectionBySlug, startNewPlan, writeSection } from './planNav'
import { getPlanState, planActions, usePlanStore } from './planStore'
import { findRun, useRunIndex } from './runIndex'
import { browserStorage, runMetaMap, type RunMeta } from './runMeta'
import { ruleText } from './RunsTable'
import { runSchedule } from './wizard/runSchedule'
import { effectiveFields, getWizardState, useWizard, type WizardState } from './wizard/wizardStore'

/** Состояние мастера, с которым строился прогон: параметры паспорта поверх текущей базы. */
function wizardFor(meta: RunMeta | undefined, w: WizardState): WizardState {
  if (!meta) return w
  const p = meta.params
  return { ...w, source: p.source, runId: p.runId, planId: p.planId, scenarioId: p.scenarioId, manualOrders: p.manualOrders, overrides: p.overrides, preset: p.preset, crits: p.crits, startDate: p.startDate }
}

function Provenance({ meta, stale }: { meta: RunMeta | undefined; stale: boolean }) {
  return (
    <>
      {meta?.scenarioId && (
        <a className="pf-link" href={`#/scenarios/${encodeURIComponent(meta.scenarioId)}`} title="Сценарий внешних условий этого прогона">
          сценарий {meta.scenarioName ? `«${meta.scenarioName}»` : ''} ↗
        </a>
      )}
      {meta?.source === 'portfolio' && <a className="pf-link" href="#/optimization" title="Портфель Стадии 2 — источник программы">портфель ↗</a>}
      {stale && <Chip size="sm" title="Сценарий или справочники изменились после построения плана — пересчитайте"><span className="glyph-setup" aria-hidden="true" />устарело</Chip>}
    </>
  )
}

export function RunView({ runKey, section }: { runKey: string; section: string | null }) {
  const plan = usePlanStore()
  const cash = useCashStore()
  const idx = useRunIndex()
  const changed = useInputsChanged()
  const w = useWizard()
  const opened = Boolean(plan.result) && plan.resultKey === runKey
  const [tried, setTried] = useState<string | null>(null)

  // Адрес → результат: в памяти, иначе кэш этой машины, иначе KPI с сервера.
  useEffect(() => {
    if (!opened) planActions.openCached(runKey)
    setTried(runKey)
  }, [runKey, opened])

  const row = findRun(idx.rows, runKey)
  const meta = useMemo(() => runMetaMap(browserStorage()).get(runKey), [runKey, plan.builtAt])
  const r = opened ? plan.result : null
  const rule = r ? `${ruleLabel(r.rule)}${r.improver?.adopted ? ' + ГА' : ''}` : meta ? ruleText(meta) : ''
  const label = runLabel({ seq: row?.seq, rule, createdAt: row?.createdAt || (opened ? plan.builtAt : meta?.builtAt) })
  const sec = sectionBySlug(section)

  useEffect(() => {
    setCrumbTitle('plan', `run/${runKey}`, label)
    if (sec && sec.slug !== 'kpi') setCrumbTitle('plan', `run/${runKey}/${sec.slug}`, sec.label)
  }, [runKey, label, sec])

  const stale = opened && (isStale(plan.builtAt, changed.nsi) || isStale(plan.builtAt, changed.scenario))
  const runW = wizardFor(meta, w)
  const f = effectiveFields(runW)

  // Пересчёт с правками Ганта: та же программа (из ответа прогона), те же параметры; новый прогон — свой адрес.
  const rerun = async () => {
    if (!r) return
    const program = r.program.map((p) => ({ product_id: p.product_id, qty: p.qty, due_hours: p.due_hours, priority: 5 }))
    // Без паспорта прогона — его же программа как ручная (паспорт нового прогона сохранит её для «Повторить»).
    const base = meta ? runW : { ...getWizardState(), source: 'manual' as const, manualOrders: program }
    const res = await runSchedule(base, program, plan.startDate ?? undefined, { scenarioName: meta?.scenarioName, scenarioId: meta?.scenarioId })
    const key = getPlanState().resultKey
    if (res && key) openRun(key)
  }
  const cashRun = (financing: 'recourse' | 'first') => {
    const scenarioId = meta?.scenarioId || w.scenarioId
    if (!scenarioId) { navigateTo('plan', 'new/conditions'); return }
    void runCash({
      scenario_id: scenarioId, alpha: f.alpha, beta: f.beta, l_min: f.lMin, financing_stage: financing, pol_curve: true,
      schedule_ref_id: r?.plan_id || undefined, horizon_hours: r?.portfolio_horizon_hours || undefined,
    })
  }

  return (
    <>
      <ScreenHeader compact eyebrow="Стадия 1 · результат" title={label}
        provenance={<Provenance meta={meta} stale={stale} />}
        actions={<>
          <button type="button" className="btn" onClick={() => startNewPlan(runKey)}>Новый план</button>
          <a className="btn btn--primary" href="#/monitoring" title="Следующий шаг конвейера: сверка прогноза с фактом">Мониторинг →</a>
        </>} />
      {r ? (
        <>
          {plan.error && !plan.running && <InlineError title="Пересчёт с правками не удался" error={plan.error} onRetry={rerun} onDismiss={() => planActions.setError(null)} />}
          <ErrorBoundary variant="inline" label="результат плана">
            <PlanResult result={r} pins={plan.pins} onPin={planActions.addPin} onClearPins={planActions.clearPins} onRerun={rerun} running={plan.running}
              startDate={plan.startDate} section={sec?.slug ?? null} onSection={(slug) => writeSection(runKey, slug)}
              cash={{ result: cash.result, running: cash.running, error: cash.error, refId: cash.params?.schedule_ref_id ?? null, onRun: cashRun, financing: f.financing }} />
          </ErrorBoundary>
        </>
      ) : tried === runKey ? (
        <KpiOnlyRun row={row} loading={idx.loading || idx.rows === null} runKey={runKey} />
      ) : null}
    </>
  )
}
