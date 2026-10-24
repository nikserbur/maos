/**
 * Шаг 5 «Цель и риск» (UX-V2 §4.2; X2 «один экран на шаг»): пресет склонности к риску + одна фраза
 * («Минимизируем срок; хвост риска штрафуем вдвое слабее»), формула F — в «i». α, N прогонов и веса —
 * под «Экспертно (α 10 % · N 500) ▸». Метод поиска порядка: авто (7 правил + генетический алгоритм),
 * одно правило, своя эвристика, RL — только при опубликованной политике (иначе причина словами,
 * подробности — под «Подробнее»). Финансирование кассы — в разделе «Касса» результата.
 */
import { useEffect, useState } from 'react'
import { num, pct } from '../../../../explain/format'
import { objectiveLabel } from '../../../../explain/labels'
import { InfoTip } from '../../../../ui/InfoTip'
import { ParamField } from '../../../../ui/ParamField'
import { PromptDialog } from '../../../../ui/PromptDialog'
import { usePassport } from '../../../passport/passportStore'
import { rlAvailable, rlReason, useRlStatus } from '../../../agents/rlStatusStore'
import { useGuardrails } from '../../../agents/guardrailsStore'
import { HeurSummary, HeuristicModal } from '../../HeuristicModal'
import { loadPresets, savePresets, writeCurrentCrits, type HeuristicPresets, type PresetsSource } from '../../heuristicPresets'
import { RULES, type Crit } from '../../types'
import { Chip, Segmented } from '../../../../ui/kit'
import type { WizardData } from '../useWizardData'
import { objectiveSentence } from '../objectiveText'
import { effectiveFields, isChanged, useWizard, wizardActions, type RiskPreset } from '../wizardStore'

const PRESET_LABEL: Record<RiskPreset, string> = { time: 'Срок', money: 'Деньги', balance: 'Баланс', expert: 'Экспертно' }

export function ObjectiveStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const passport = usePassport()
  const f = effectiveFields(w)
  const [heurOpen, setHeurOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [presets, setPresets] = useState<HeuristicPresets>({})
  const [presetsSrc, setPresetsSrc] = useState<PresetsSource>('local')
  useEffect(() => { loadPresets().then((r) => { setPresets(r.presets); setPresetsSrc(r.source) }) }, [])
  useEffect(() => { writeCurrentCrits(w.crits) }, [w.crits])
  const sc = data.scenario
  const rlState = useRlStatus()
  const rlOn = rlAvailable(rlState.status)
  const guard = useGuardrails()
  const owner = (k: 'alpha' | 'objective' | 'samples') => (isChanged(w, k) ? 'этот прогон' : w.owners[k] ?? 'норматив')
  const setCrits = (next: Crit[] | ((p: Crit[]) => Crit[])) => wizardActions.setCrits(typeof next === 'function' ? next([...w.crits]) : next)
  const saveHeur = async (name: string) => {
    const next = { ...presets, [name]: w.crits }
    setPresets(next); setNameOpen(false)
    setPresetsSrc(await savePresets(next))
  }
  const deleteHeur = async (name: string) => {
    const { [name]: _x, ...rest } = presets
    setPresets(rest); setPresetsSrc(await savePresets(rest))
  }
  const formulaValues = { preset: PRESET_LABEL[w.preset], w_t: f.wTime, w_r: f.wRisk, w_c: f.wCost, alpha: f.alpha }
  const isRule = f.rule !== 'auto' && f.rule !== 'custom' && f.rule !== 'rl'

  return (
    <div className="wz-step">
      <div className="wz-card wz-card--accent">
        <div className="wz-card__t">Склонность к риску <InfoTip id="plan.objective_weights" values={formulaValues} /></div>
        <Segmented label="Пресет склонности к риску" size="lg" value={w.preset} onChange={(id: RiskPreset) => wizardActions.applyPreset(id)}
          options={[{ id: 'time', label: 'Срок' }, { id: 'money', label: 'Деньги' }, { id: 'balance', label: 'Баланс' }, { id: 'expert', label: 'Экспертно' }]} />
        <p className="wz-sentence">{objectiveSentence(f)}.</p>
        <details className="wz-expert" open={w.preset === 'expert' || undefined}>
          <summary>Экспертно (α {pct(f.alpha, 0)} · N {num(f.samples, 0)}) ▸</summary>
          <div className="wz-fields wz-fields--one">
            <ParamField label="α хвоста · один на портфель, план и кассу" value={f.alpha * 100} unit="%" status={passport.byCode['r1.19']?.status ?? 'К'}
              provenance={isChanged(w, 'alpha') ? 'manual' : 'calibrated'} owner={owner('alpha')} changed={isChanged(w, 'alpha')} onRevert={() => wizardActions.revert('alpha')}
              range={[1, 50]} step={1} onChange={(v) => wizardActions.setOverride('alpha', v / 100)} info="plan.makespan_cvar"
              hint={<>Живёт в сценарии «{sc?.name ?? '—'}»; здесь — только переопределение на этот прогон.{isChanged(w, 'alpha') && <> Портфель считался при α = {pct(w.base.alpha, 0)}.</>}</>} />
            <ParamField label="Прогонов хвоста (Монте-Карло)" value={f.samples} unit="прогонов" status={passport.byCode['r1.20']?.status ?? 'НОРМ'}
              provenance={isChanged(w, 'samples') ? 'manual' : 'normative'} owner={owner('samples')} changed={isChanged(w, 'samples')} onRevert={() => wizardActions.revert('samples')}
              range={[100, 5000]} step={100} onChange={(v) => wizardActions.setOverride('samples', Math.round(v))} info="plan.makespan" />
            <ParamField label="Вес срока" value={f.wTime} status="НОРМ" provenance={isChanged(w, 'wTime') ? 'manual' : 'normative'} owner={isChanged(w, 'wTime') ? 'этот прогон' : 'пресет'}
              changed={isChanged(w, 'wTime')} onRevert={() => wizardActions.revert('wTime')} range={[0, 3]} step={0.5} onChange={(v) => { wizardActions.applyPreset('expert'); wizardActions.setOverride('wTime', v) }} info="plan.rule_score" />
            <ParamField label="Вес хвоста риска" value={f.wRisk} status="НОРМ" provenance={isChanged(w, 'wRisk') ? 'manual' : 'normative'} owner={isChanged(w, 'wRisk') ? 'этот прогон' : 'пресет'}
              changed={isChanged(w, 'wRisk')} onRevert={() => wizardActions.revert('wRisk')} range={[0, 3]} step={0.5} onChange={(v) => { wizardActions.applyPreset('expert'); wizardActions.setOverride('wRisk', v) }} info="plan.rule_score" />
            <ParamField label="Вес переналадок" value={f.wCost} status="НОРМ" provenance={isChanged(w, 'wCost') ? 'manual' : 'normative'} owner={isChanged(w, 'wCost') ? 'этот прогон' : 'пресет'}
              changed={isChanged(w, 'wCost')} onRevert={() => wizardActions.revert('wCost')} range={[0, 3]} step={0.5} onChange={(v) => { wizardActions.applyPreset('expert'); wizardActions.setOverride('wCost', v) }} info="plan.rule_score" />
            <ParamField label="Критерий портфеля" value={objectiveLabel(f.objective, 'long')} provenance={isChanged(w, 'objective') ? 'manual' : 'default'} owner={owner('objective')} readOnly
              hint="Критерий Стадии 2 задаётся в сценарии; для расписания цель — фраза выше." />
          </div>
        </details>
      </div>

      <section className="wz-card" aria-label="Метод поиска порядка">
        <div className="wz-card__t">Метод поиска порядка операций</div>
        <div className="wz-methods" role="radiogroup" aria-label="Метод">
          {[
            { id: 'auto', title: 'Авто', sub: '7 правил + генетический алгоритм, проверка вне выборки', on: f.rule === 'auto' },
            { id: 'rule', title: 'Правило', sub: 'одно диспетчерское правило', on: isRule },
            { id: 'custom', title: 'Своя эвристика', sub: 'взвешенные критерии; пресеты — в проекте', on: f.rule === 'custom' },
            { id: 'rl', title: 'RL', sub: rlOn ? 'опубликованная политика агента' : 'недоступно — см. ниже', on: f.rule === 'rl', disabled: !rlOn },
          ].map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.on} aria-disabled={m.disabled || undefined}
                    className={`wz-method${m.on ? ' is-on' : ''}${m.disabled ? ' is-planned' : ''}`}
                    onClick={() => { if (!m.disabled) wizardActions.setOverride('rule', m.id === 'rule' ? 'EDD' : m.id) }}
                    aria-describedby={m.disabled ? 'wz-rl-why' : undefined}>
              <span className="wz-method__t">{m.title}</span>
              <span className="wz-method__s">{m.sub}</span>
            </button>
          ))}
        </div>
        {!rlOn && (
          <div className="pl-note" id="wz-rl-why">
            RL недоступно: политика не опубликована — она включается только после проверки на отложенных сценариях. <a className="pf-link" href="#/agents">Почему — «Агенты» →</a>
            <details className="wz-more"><summary>Подробнее</summary><span className="mono">{rlReason(rlState)}</span></details>
          </div>
        )}
        {f.rule === 'rl' && (
          <p className="pl-note">
            Агент ставит порядок операций; если опубликован планировщик — результат покажет структурные ходы «до → после».
            Разрешено видов ходов: {num(guard.value ? Object.values(guard.value.allowed).filter(Boolean).length : 0, 0)} · <a className="pf-link" href="#/agents">изменить →</a>
          </p>
        )}
        {isRule && (
          <label className="wz-inline">Правило:
            <select className="plan__select" value={f.rule} onChange={(e) => wizardActions.setOverride('rule', e.target.value)}>
              {RULES.filter((r) => r.id !== 'auto' && r.id !== 'custom').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        )}
        {f.rule === 'custom' && (
          <div className="wz-row">
            <HeurSummary crits={[...w.crits]} />
            <button type="button" className="btn btn--sm" onClick={() => setHeurOpen(true)}>Настроить эвристику</button>
            <Chip tone={presetsSrc === 'project' ? undefined : 'warn'}>{presetsSrc === 'project' ? 'пресеты в проекте' : 'пресеты на этой машине'}</Chip>
          </div>
        )}
      </section>

      {heurOpen && (
        <HeuristicModal crits={[...w.crits]} setCrits={setCrits} saved={Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, [...v]]))}
          onSave={() => setNameOpen(true)} onDelete={deleteHeur} onLoad={(c) => wizardActions.setCrits(c)} onClose={() => setHeurOpen(false)} />
      )}
      {nameOpen && (
        <PromptDialog title="Сохранить эвристику в проект" label="Название пресета" placeholder="Например: длинные вперёд + входы" submitLabel="Сохранить"
          hint={presetsSrc === 'project' ? 'Пресеты хранятся в настройках проекта.' : 'Нет связи с проектом — пресет сохранится на этой машине и перенесётся при следующей удачной записи.'}
          onSubmit={(name) => saveHeur(name)} onCancel={() => setNameOpen(false)} />
      )}
    </div>
  )
}
