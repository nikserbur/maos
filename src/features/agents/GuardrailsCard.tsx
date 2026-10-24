/**
 * «Полномочия агента» (UX-V2 §4.10): строка «что действует сейчас» (α сценария и фильтр видов ходов в
 * панели «Ходы»; критерий и лимиты сохраняются в проекте и вступят в силу, когда сервер начнёт их
 * принимать) · α только для чтения (значение, происхождение, «изменить в Сценарии →» — с этого экрана
 * сценарий не пишется) · единая таблица видов ходов с переключателями · критерий и лимиты пакета в одном
 * раскрытии · персональные маски (заморозки, отклонения с причиной). Хранится в проекте
 * (prefs `agent_guardrails`), запасной — localStorage с пометкой «локально»; каждое изменение — с «Отменить».
 */
import { useState } from 'react'
import type { AgentGuardrails } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { alphaWords } from '../../ui/AlphaSlider'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { Chip, Section, Segmented, showUndo } from '../../ui/kit'
import { useScenarioAlpha } from '../scenarios/useScenarioAlpha'
import { useOptStore } from '../optimization/optStore'
import { moveLabel } from '../plan/moves/moveKinds'
import { OBJECTIVE_LABEL, clearFrozen, guardrailRows, removeRejectedMask, setLimit, setObjective, toggleKind } from './guardrails'
import { saveGuardrails, useGuardrails, type GuardrailsState } from './guardrailsStore'
import { MoveKindsTable } from './MoveKindsTable'

const OBJECTIVES: ReadonlyArray<{ id: AgentGuardrails['objective']; label: string }> = (Object.keys(OBJECTIVE_LABEL) as Array<AgentGuardrails['objective']>)
  .map((id) => ({ id, label: OBJECTIVE_LABEL[id] }))

interface Props {
  /** Что разрешает НСИ (из `moves.guardrails.allowed` последнего прогона RL); без него — по готовности ходов. */
  nsiAllowed?: Readonly<Record<string, boolean>>
}

function SourceMark({ g }: { g: GuardrailsState }) {
  if (g.saving) return <span className="ag-muted">сохраняем…</span>
  if (g.source === 'local') return <Chip size="sm" tone="warn">локально · проект недоступен</Chip>
  return <span className="ag-muted">{g.source === 'project' ? 'сохранено в проекте' : 'значения по умолчанию'}</span>
}

/** Сохранить с «Отменить»: возврат к прежнему значению одним нажатием (8 с). */
function saveWithUndo(prev: AgentGuardrails, next: AgentGuardrails, message: string): void {
  if (next === prev) return
  void saveGuardrails(next)
  showUndo({ message, onUndo: () => void saveGuardrails(prev) })
}

export function GuardrailsCard({ nsiAllowed }: Props) {
  const g = useGuardrails()
  const v = g.value
  const rows = guardrailRows(v, nsiAllowed)
  const [confirmClear, setConfirmClear] = useState(false)
  const lim = v.limits
  const summary = `Критерий и лимиты пакета · ${OBJECTIVE_LABEL[v.objective]} · ${num(lim.max_moves, 0)} ходов · ${pct(lim.max_orders_share, 0)} заказов · ${num(lim.max_shift_days, 0)} дн · ${pct(lim.max_outsource_share, 0)}`

  return (
    <Section id="ag-guard" title="Полномочия агента" tools={<SourceMark g={g} />}>
      <p className="ag-statusline">
        <b>Действует сейчас:</b> α сценария и фильтр видов ходов в панели «Ходы». Критерий и лимиты сохраняются в проекте и вступят в силу, когда сервер начнёт принимать полномочия.
      </p>

      <AlphaReadOnly />

      <MoveKindsTable rows={rows}
        onToggle={(r, on) => saveWithUndo(v, toggleKind(v, r.meta.kind, on), `Ход «${r.meta.label}» ${on ? 'разрешён' : 'запрещён'}`)} />

      <details className="ag-details ag-limits">
        <summary>{summary}</summary>
        <div className="ag-limits__body">
          <div className="ag-limits__obj">
            <p className="ag-label">Критерий агента = цель пользователя</p>
            <Segmented label="Критерий агента" size="sm" fit value={v.objective} options={OBJECTIVES}
              onChange={(o) => saveWithUndo(v, setObjective(v, o), `Критерий агента: ${OBJECTIVE_LABEL[o]}`)} />
          </div>
          <div className="ag-limits__grid">
            <ParamField label="Ходов в пакете ≤" value={lim.max_moves} unit="ходов" provenance="default" range={[1, 50]} step={1} min={1} max={50}
              onChange={(x) => saveWithUndo(v, setLimit(v, 'max_moves', Math.round(x)), 'Лимит ходов пакета изменён')} />
            <ParamField label="Затронуто заказов ≤" value={Math.round(lim.max_orders_share * 100)} unit="%" provenance="default" range={[5, 100]} step={5} min={5} max={100}
              onChange={(x) => saveWithUndo(v, setLimit(v, 'max_orders_share', x / 100), 'Лимит доли заказов изменён')} />
            <ParamField label="Сдвиг запуска ≤" value={lim.max_shift_days} unit="дн" provenance="default" range={[0, 60]} step={1} min={0} max={60}
              onChange={(x) => saveWithUndo(v, setLimit(v, 'max_shift_days', Math.round(x)), 'Лимит сдвига запуска изменён')} />
            <ParamField label="Отдать на сторону ≤ себестоимости" value={Math.round(lim.max_outsource_share * 100)} unit="%" provenance="default" range={[0, 50]} step={1} min={0} max={50}
              onChange={(x) => saveWithUndo(v, setLimit(v, 'max_outsource_share', x / 100), 'Лимит работ на стороне изменён')} />
          </div>
        </div>
      </details>

      <div className="ag-masks">
        <div>
          <p className="ag-label">Заморожено · {num(v.frozen.length, 0)}</p>
          {v.frozen.length === 0
            ? <p className="ag-note">Нет заморозок. Заморозить операцию — клавиша f на дифе Ганта или кнопка в панели «Ходы».</p>
            : (
              <>
                <ul className="ag-masks__list">
                  {v.frozen.slice(0, 8).map((f, i) => (
                    <li key={i} title={f.op_id}><LockIcon />{f.op_id ? `операция ${f.op_id.slice(0, 8)}` : ''}{f.order_idx !== undefined ? ` заказ №${f.order_idx}` : ''}{f.machine_id ? ` станок ${f.machine_id}` : ''}</li>
                  ))}
                </ul>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => setConfirmClear(true)}>Снять все заморозки…</button>
              </>
            )}
        </div>
        <div>
          <p className="ag-label">Отклонено с причиной · {num(v.rejected_masks.length, 0)}</p>
          {v.rejected_masks.length === 0
            ? <p className="ag-note">Отклонённые ходы становятся масками «не предлагать снова».</p>
            : (
              <ul className="ag-masks__list">
                {v.rejected_masks.map((m, i) => (
                  <li key={i}>
                    <span>не предлагать «{moveLabel(m.kind)}» {m.targets.order_idx?.length ? `для заказа №${m.targets.order_idx.join(', №')}` : ''} — {m.reason}</span>
                    <button type="button" className="btn btn--ghost btn--sm"
                      onClick={() => saveWithUndo(v, removeRejectedMask(v, i), `Маска «${moveLabel(m.kind)}» снята`)}>снять</button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
      {confirmClear && (
        <ConfirmDialog title="Снять все заморозки?" objectName={`Заморожено: ${num(v.frozen.length, 0)}`} danger confirmLabel="Снять все"
          consequence="Агент снова сможет предлагать ходы для этих операций, заказов и станков; отклонённые маски останутся."
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => { setConfirmClear(false); saveWithUndo(v, clearFrozen(v), 'Заморозки сняты') }} />
      )}
    </Section>
  )
}

/** α — только чтение: значение, происхождение, ссылка на сценарий (запись α — только в «Сценариях»). */
function AlphaReadOnly() {
  const a = useScenarioAlpha()
  const opt = useOptStore()
  const nScn = Number(opt.form.samples) || undefined
  return (
    <div className="ag-alpha">
      <span className="ag-label">α хвоста — один на все экраны <InfoTip id="opt.cvar" values={{ alpha: a.alpha }} /></span>
      <span className="ag-alpha__v num">{pct(a.alpha, 0)}</span>
      <span className="ag-muted">
        {!a.scenarioId
          ? <span className="glyph-idle">сценарий не выбран — по умолчанию</span>
          : a.fromScenario ? `из сценария «${a.scenarioName ?? a.scenarioId}»` : <span className="glyph-idle">в сценарии «{a.scenarioName ?? a.scenarioId}» не задано — по умолчанию</span>}
        {' · '}{alphaWords(a.alpha, nScn)}
      </span>
      {a.scenarioId && <a className="ag-link" href={`#/scenarios/${encodeURIComponent(a.scenarioId)}/conditions`}>изменить в Сценарии →</a>}
    </div>
  )
}

/** Замок заморозки (в наборе иконок оболочки его нет). */
function LockIcon() {
  return (
    <svg className="ag-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}
