/**
 * Шаг 5 «Цель и риск» [5] + [4]/[6] (UX-V2 §4.2, §4.4 п. 2): пресеты «Срок / Деньги / Баланс», «Экспертно»
 * раскрывает w_time / w_risk / w_cost, α (из сценария, переопределение — с бейджем), N прогонов,
 * формулу F живьём («i» plan.objective_weights). Метод поиска порядка: Авто (7 правил + ГА), правило,
 * RL (блок [6] — в плане, пока нет ONNX), конструктор эвристики (пресеты — в проекте через prefs).
 * Критерий кассы: CVaR прибыли / CFaR / оба + «касса ≥ L_min».
 */
import { useEffect, useState } from 'react'
import { pct } from '../../../../explain/format'
import { InfoTip } from '../../../../ui/InfoTip'
import { ParamField } from '../../../../ui/ParamField'
import { PromptDialog } from '../../../../ui/PromptDialog'
import { usePassport } from '../../../passport/passportStore'
import { HeurSummary, HeuristicModal } from '../../HeuristicModal'
import { loadPresets, savePresets, writeCurrentCrits, type HeuristicPresets, type PresetsSource } from '../../heuristicPresets'
import { RULES, type Crit } from '../../types'
import { Chip, Segmented } from '../../ui'
import type { WizardData } from '../useWizardData'
import { effectiveFields, isChanged, useWizard, wizardActions, type CashCriterion, type RiskPreset } from '../wizardStore'

const PRESET_HINT: Record<RiskPreset, string> = {
  time: 'w_time 1 · w_risk 0,5 — минимальная длина расписания с умеренным штрафом хвоста',
  money: 'w_cost 1 — переналадки и стоимость работ важнее; касса — в критерии',
  balance: 'w_time 1 · w_risk 1 · w_cost 0,5 — срок и хвост поровну, стоимость наполовину',
  expert: 'веса, α и N — по отдельности',
}

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
  const owner = (k: 'alpha' | 'objective') => (isChanged(w, k) ? 'этот прогон' : w.owners[k] ?? 'умолчание')
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
  const num3 = (v: number) => String(Math.round(v * 1000) / 1000)

  return (
    <div className="wz-step">
      <div className="wz-card wz-card--accent">
        <p className="wz-card__t">Склонность к риску <InfoTip id="plan.objective_weights" values={{ preset: w.preset, w_t: f.wTime, w_r: f.wRisk, w_c: f.wCost, alpha: f.alpha }} /></p>
        <Segmented label="Пресет склонности к риску" size="lg" value={w.preset} onChange={(id: RiskPreset) => wizardActions.applyPreset(id)}
          options={[{ id: 'time', label: 'Срок' }, { id: 'money', label: 'Деньги' }, { id: 'balance', label: 'Баланс' }, { id: 'expert', label: 'Экспертно' }]} />
        <p className="pl-note">{PRESET_HINT[w.preset]}</p>
        <p className="wz-formula mono">
          F = <b>{num3(f.wTime)}</b>·E[Cmax] + <b>{num3(f.wRisk)}</b>·(CVaR<sub>{pct(f.alpha, 0)}</sub> − E[Cmax]) + <b>{num3(f.wCost)}</b>·T<sub>нал</sub> + 0,5·E[T] + 0,001·T<sub>дет</sub>
        </p>
      </div>

      <div className="wz-fields">
        <ParamField label="α хвоста · один на портфель, план, кассу" value={f.alpha * 100} unit="%" status={passport.byCode['r1.19']?.status ?? 'К'} provenance={isChanged(w, 'alpha') ? 'manual' : 'calibrated'}
          owner={owner('alpha')} changed={isChanged(w, 'alpha')} onRevert={() => wizardActions.revert('alpha')} range={[1, 50]} step={1}
          onChange={(v) => wizardActions.setOverride('alpha', v / 100)} info="plan.makespan_cvar"
          note={<>Живёт в сценарии «{sc?.name ?? '—'}»; здесь — только переопределение на прогон с пометкой (решение владельца, UX-V2 §8). {isChanged(w, 'alpha') && <Chip tone="warn">портфель считался при α = {pct(w.base.alpha, 0)}</Chip>}</>} />
        <ParamField label="Критерий портфеля и кассы" value={f.objective} provenance={isChanged(w, 'objective') ? 'manual' : 'default'} owner={owner('objective')} readOnly
          note="Критерий Стадии 2 задаётся в сценарии; для расписания цель — F выше. На прогон кассы переопределение не требуется." />
        <ParamField label="Прогонов хвоста (Стадия 1)" value={f.samples} unit="прогонов" status={passport.byCode['r1.20']?.status ?? 'НОРМ'} provenance={isChanged(w, 'samples') ? 'manual' : 'normative'}
          owner={isChanged(w, 'samples') ? 'этот прогон' : 'умолчание r1.20'} changed={isChanged(w, 'samples')} onRevert={() => wizardActions.revert('samples')}
          range={[100, 5000]} step={100} onChange={(v) => wizardActions.setOverride('samples', Math.round(v))} info="plan.makespan" />
        {w.preset === 'expert' && (
          <>
            <ParamField label="Вес срока w_time" value={f.wTime} status="НОРМ" provenance={isChanged(w, 'wTime') ? 'manual' : 'normative'} owner={isChanged(w, 'wTime') ? 'этот прогон' : 'r1.18'}
              changed={isChanged(w, 'wTime')} onRevert={() => wizardActions.revert('wTime')} range={[0, 3]} step={0.5} slider onChange={(v) => wizardActions.setOverride('wTime', v)} info="plan.rule_score" />
            <ParamField label="Вес риска w_risk" value={f.wRisk} status="НОРМ" provenance={isChanged(w, 'wRisk') ? 'manual' : 'normative'} owner={isChanged(w, 'wRisk') ? 'этот прогон' : 'r1.18'}
              changed={isChanged(w, 'wRisk')} onRevert={() => wizardActions.revert('wRisk')} range={[0, 3]} step={0.5} slider onChange={(v) => wizardActions.setOverride('wRisk', v)} info="plan.rule_score" />
            <ParamField label="Вес стоимости w_cost" value={f.wCost} status="НОРМ" provenance={isChanged(w, 'wCost') ? 'manual' : 'normative'} owner={isChanged(w, 'wCost') ? 'этот прогон' : 'r1.18'}
              changed={isChanged(w, 'wCost')} onRevert={() => wizardActions.revert('wCost')} range={[0, 3]} step={0.5} slider onChange={(v) => wizardActions.setOverride('wCost', v)} info="plan.rule_score" />
          </>
        )}
      </div>

      <section className="wz-card" aria-label="Метод поиска порядка">
        <p className="wz-card__t">Метод поиска порядка операций · блок [4]</p>
        <div className="wz-methods" role="radiogroup" aria-label="Метод">
          {[
            { id: 'auto', title: 'Авто', sub: '7 правил + ГА с проверкой вне выборки', on: f.rule === 'auto' },
            { id: 'rule', title: 'Правило', sub: 'одно диспетчерское правило', on: f.rule !== 'auto' && f.rule !== 'custom' && f.rule !== 'rl' },
            { id: 'custom', title: 'Конструктор эвристики', sub: 'взвешенные критерии; пресеты — в проекте', on: f.rule === 'custom' },
            { id: 'rl', title: 'RL', sub: 'блок [6] · политика не обучена (волна 3)', on: false, disabled: true },
          ].map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.on} disabled={m.disabled} className={`wz-method${m.on ? ' is-on' : ''}${m.disabled ? ' is-planned' : ''}`}
                    onClick={() => wizardActions.setOverride('rule', m.id === 'rule' ? 'EDD' : m.id)} title={m.disabled ? 'Появится после обучения на симуляторе (волна A); на карте — узел [6]' : undefined}>
              <span className="wz-method__t">{m.title}</span>
              <span className="wz-method__s">{m.sub}</span>
            </button>
          ))}
        </div>
        {f.rule !== 'auto' && f.rule !== 'custom' && (
          <label className="wz-inline">Правило:
            <select className="plan__select" value={f.rule} onChange={(e) => wizardActions.setOverride('rule', e.target.value)}>
              {RULES.filter((r) => r.id !== 'auto' && r.id !== 'custom').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        )}
        {f.rule === 'custom' && (
          <div className="wz-row">
            <HeurSummary crits={[...w.crits]} />
            <button className="btn btn--primary" style={{ height: 28 }} onClick={() => setHeurOpen(true)}>Настроить эвристику</button>
            <Chip tone={presetsSrc === 'project' ? 'good' : 'warn'}>{presetsSrc === 'project' ? 'пресеты в проекте' : 'пресеты локально'}</Chip>
          </div>
        )}
      </section>

      <section className="wz-card" aria-label="Критерий кассы">
        <p className="wz-card__t">Критерий кассы · слой F</p>
        <Segmented label="Критерий кассы" value={f.cashCriterion} onChange={(id: CashCriterion) => wizardActions.setOverride('cashCriterion', id)}
          options={[{ id: 'profit', label: 'CVaR прибыли' }, { id: 'cash', label: 'CVaR кассы (CFaR)' }, { id: 'both', label: 'оба' }]} />
        <p className="pl-note">Ограничение «касса ≥ L_min в каждую неделю худших β сценариев» входит в CVaR-LP всегда (L_min — шаг «Ограничения»); «цена ликвидности» показывается после расчёта кассы.</p>
        <div className="wz-inline">Финансирование:
          <Segmented label="Финансирование" value={f.financing} onChange={(id: 'recourse' | 'first') => wizardActions.setOverride('financing', id)}
            options={[{ id: 'recourse', label: 'рекурс d_i,t' }, { id: 'first', label: 'график заранее d_t' }]} />
        </div>
      </section>

      {heurOpen && (
        <HeuristicModal crits={[...w.crits]} setCrits={setCrits} saved={Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, [...v]]))}
          onSave={() => setNameOpen(true)} onDelete={deleteHeur} onLoad={(c) => wizardActions.setCrits(c)} onClose={() => setHeurOpen(false)} />
      )}
      {nameOpen && (
        <PromptDialog title="Сохранить эвристику в проект" label="Название пресета" placeholder="Например: длинные вперёд + входы" submitLabel="Сохранить"
          hint={presetsSrc === 'project' ? 'Пресеты хранятся в проекте (KV-настройки, prefs.heuristic_presets).' : 'Нет связи с проектом — пресет сохранится локально и перенесётся при следующей удачной записи.'}
          onSubmit={(name) => saveHeur(name)} onCancel={() => setNameOpen(false)} />
      )}
    </div>
  )
}
