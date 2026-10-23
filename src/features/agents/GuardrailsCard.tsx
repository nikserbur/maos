/**
 * «Полномочия агента» (UX-V2 §4.10): единый α (паспорт scenario.alpha), критерий агента, разрешённые
 * виды ходов — каждый с жёсткой маской (ограничение, которое агент не может нарушить: маскирование
 * действий) и состоянием («в плане», «нет данных НСИ»), лимиты пакета, персональные маски —
 * заморозки и отклонения с причиной. Хранится в проекте (prefs `agent_guardrails`), запасной —
 * localStorage с пометкой «локально».
 */
import type { AgentGuardrails } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { AlphaSlider } from '../../ui/AlphaSlider'
import { ParamField } from '../../ui/ParamField'
import { Chip, Segmented, Switch } from '../../ui/kit'
import { useScenarioAlpha } from '../scenarios/useScenarioAlpha'
import { useOptStore } from '../optimization/optStore'
import { OBJECTIVE_LABEL, clearFrozen, guardrailRows, removeRejectedMask, setLimit, setObjective, toggleKind } from './guardrails'
import { saveGuardrails, useGuardrails, type GuardrailsSource } from './guardrailsStore'
import { READINESS_LABEL, moveLabel } from '../plan/moves/moveKinds'

const SOURCE: Readonly<Record<GuardrailsSource, { text: string; tone: 'good' | 'warn' | 'idle' }>> = {
  project: { text: 'в проекте', tone: 'good' },
  local: { text: 'локально · проект недоступен', tone: 'warn' },
  default: { text: 'умолчания', tone: 'idle' },
}

const OBJECTIVES: ReadonlyArray<{ id: AgentGuardrails['objective']; label: string }> = (Object.keys(OBJECTIVE_LABEL) as Array<AgentGuardrails['objective']>)
  .map((id) => ({ id, label: OBJECTIVE_LABEL[id] }))

interface Props {
  /** Что разрешает НСИ (из `moves.guardrails.allowed` последнего прогона RL); без него — по готовности ходов. */
  nsiAllowed?: Readonly<Record<string, boolean>>
}

export function GuardrailsCard({ nsiAllowed }: Props) {
  const g = useGuardrails()
  const a = useScenarioAlpha()
  const opt = useOptStore()
  const v = g.value
  const rows = guardrailRows(v, nsiAllowed)
  const save = (next: AgentGuardrails) => { if (next !== v) void saveGuardrails(next) }
  const src = SOURCE[g.source]
  const nScn = Number(opt.form.samples) || undefined

  return (
    <section className="ag-guard dk-card" aria-labelledby="ag-guard-t">
      <header className="dk-card__head">
        <h3 className="dk-card__title" id="ag-guard-t">Полномочия агента</h3>
        <span className="ag-guard__src">
          <Chip size="sm" tone={src.tone}>{g.saving ? 'сохраняем…' : src.text}</Chip>
          <span className="dk-card__meta">владелец — проект; переопределение на прогон помечается</span>
        </span>
      </header>

      <div className="ag-guard__top">
        <AlphaSlider alpha={a.alpha} onChange={a.setAlpha} scenarioName={a.scenarioName} nScenarios={nScn} save={a.save} disabled={!a.scenarioId} />
        <div className="ag-guard__obj">
          <p className="text-caps ag-guard__lbl">Критерий агента = цель пользователя</p>
          <Segmented label="Критерий агента" value={v.objective} onChange={(o) => save(setObjective(v, o))} options={OBJECTIVES} />
          <p className="pl-note">Агент оптимизирует тот же CVaR, что «Портфель» и «Касса», на тех же сценариях (CRN).</p>
        </div>
      </div>

      <div className="ag-guard__kinds" role="list" aria-label="Разрешённые виды ходов">
        <p className="ag-guard__kh text-caps"><span>Разрешённые ходы</span><span>маска — жёсткое ограничение</span><span>состояние</span></p>
        {rows.map((r) => (
          <div key={r.meta.kind} role="listitem" className={`ag-kind${r.on ? ' is-on' : ''}${r.locked ? ' is-locked' : ''}`}>
            {r.locked
              ? <span className="ag-kind__name"><span className="glyph-idle" aria-hidden="true" /> {r.meta.label}</span>
              : <Switch checked={r.on} onChange={(on) => save(toggleKind(v, r.meta.kind, on))} hint={r.meta.what}>{r.meta.label}</Switch>}
            <span className="ag-kind__mask">{r.meta.mask}{r.meta.note && <em> · {r.meta.note}</em>}</span>
            <span className="ag-kind__state">
              <Chip size="sm" tone={r.state === 'разрешено' ? 'good' : r.state === 'выключено' ? 'idle' : 'setup'}>{r.state}</Chip>
              <span className="ag-kind__lvl mono" title={READINESS_LABEL[r.meta.readiness]}>{r.meta.level}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="ag-guard__limits">
        <ParamField label="Ходов в пакете ≤" value={v.limits.max_moves} unit="ходов" provenance="default" range={[1, 50]} step={1} min={1} max={50}
          onChange={(x) => save(setLimit(v, 'max_moves', Math.round(x)))} />
        <ParamField label="Затронуто заказов ≤" value={Math.round(v.limits.max_orders_share * 100)} unit="%" provenance="default" range={[5, 100]} step={5} min={5} max={100}
          onChange={(x) => save(setLimit(v, 'max_orders_share', x / 100))} />
        <ParamField label="Сдвиг запуска ≤" value={v.limits.max_shift_days} unit="дн" provenance="default" range={[0, 60]} step={1} min={0} max={60}
          onChange={(x) => save(setLimit(v, 'max_shift_days', Math.round(x)))} />
        <ParamField label="Аутсорсинг ≤ себестоимости" value={Math.round(v.limits.max_outsource_share * 100)} unit="%" provenance="default" range={[0, 50]} step={1} min={0} max={50}
          onChange={(x) => save(setLimit(v, 'max_outsource_share', x / 100))} />
      </div>
      <p className="pl-note">
        Лимиты пакета — мягкие (PID-лагранжиан на стенде); «цена ограничения» появится, когда бэкенд её отдаст. Сейчас: ходов ≤ {num(v.limits.max_moves, 0)},
        заказов ≤ {pct(v.limits.max_orders_share, 0)}, сдвиг ≤ {num(v.limits.max_shift_days, 0)} дн, аутсорсинг ≤ {pct(v.limits.max_outsource_share, 0)}.
      </p>

      <div className="ag-guard__masks">
        <div>
          <p className="text-caps ag-guard__lbl">Заморожено · {v.frozen.length}</p>
          {v.frozen.length === 0
            ? <p className="pl-note">Нет заморозок. Заморозить операцию — клавиша f на дифе Ганта или кнопка в панели ходов.</p>
            : (
              <>
                <ul className="ag-guard__list">
                  {v.frozen.slice(0, 8).map((f, i) => (
                    <li key={i} className="mono" title={f.op_id}>■ {f.op_id ? `оп. ${f.op_id.slice(0, 8)}` : ''}{f.order_idx !== undefined ? ` заказ #${f.order_idx}` : ''}{f.machine_id ? ` станок ${f.machine_id}` : ''}</li>
                  ))}
                </ul>
                <button type="button" className="btn btn--sm" onClick={() => save(clearFrozen(v))}>Снять все</button>
              </>
            )}
        </div>
        <div>
          <p className="text-caps ag-guard__lbl">Отклонено с причиной · {v.rejected_masks.length}</p>
          {v.rejected_masks.length === 0
            ? <p className="pl-note">Отклонённые ходы становятся масками «не предлагать снова».</p>
            : (
              <ul className="ag-guard__list">
                {v.rejected_masks.map((m, i) => (
                  <li key={i}>
                    <span>не предлагать «{moveLabel(m.kind)}» {m.targets.order_idx?.length ? `для заказа #${m.targets.order_idx.join(', #')}` : ''} — {m.reason}</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => save(removeRejectedMask(v, i))}>снять</button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </section>
  )
}
