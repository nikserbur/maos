/**
 * Вкладка «Условия» (владелец: «параметры ужасные и неверные; непонятно, базовый ли это»): сначала
 * карточка пресета — какой это сценарий, что повторяет и что даёт генератор; затем поля условий двумя
 * группами («Цены» — три карточки, «Курс и спрос» — две, растянутые на ширину ряда; на 1024 — по две,
 * нечётная — во всю ширину). Значение — в понятных единицах (% г/г, % от исторического, сдвиг к
 * прогнозу и справочнику), одна строка эффекта из чисел генератора, происхождение глифом и источником
 * («○ генератор · ЦБ РФ, сент. 2026», «■ экспертная оценка пресета», «■ вручную · вернуть»). «Вернуть»
 * делает поле пустым (NULL в БД) — умолчание дальше следует за данными. Режимы генератора для знатоков —
 * в свёрнутых «Расширенных настройках».
 */
import { useState } from 'react'
import type { MacroRegimes, MacroSummary, PriceScenario } from '../../lib/api'
import { ParamField } from '../../ui/ParamField'
import { showUndo } from '../../ui/kit'
import { usePassport } from '../passport/passportStore'
import { CONDITION_GROUPS, CONDITION_SPECS, type ConditionContext, type ConditionSpec } from './conditionFields'
import { BETA_DEFAULT, betaSpread } from './distModel'
import { PresetCard } from './PresetCard'
import { sampleStats } from './presetStats'
import { GeneratorAdvanced } from './RegimeMenuPanel'
import { fromMacroMode, regimeMenuReducer, serializeMode, type RegimeMenuAction, type RegimeMenuState } from './regimeMenu'
import { CONDITION_KEYS, defaultsFor, effectiveScenario, resetPatch, type EffectiveScenario } from './scenarioDefaults'
import { getPreset, presetOf, presetPatch, scenarioMacroMode, type PresetValueKey, type ScenarioPreset } from './scenarioPresets'
import { useMacroSample } from './useMacroSample'
import './scenarios-v2.css'

export { monthShort } from './monthText'

interface Props {
  sc: PriceScenario
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
}

/** ρ между изделиями в Портфеле ≈ β·β (одинаковые β в «Распределениях»), иначе — нет одного числа. */
function rhoFromBeta(sc: PriceScenario): number | null {
  const rows = (sc.distributions ?? []).map((d) => ({ beta: Number(d.beta ?? BETA_DEFAULT) })).filter((r) => Number.isFinite(r.beta))
  const s = betaSpread(rows)
  return s.uniform ? s.rho : null
}

export function ConditionsTab({ sc, regimes, macro, onPatch }: Props) {
  const passport = usePassport()
  const lastObs = regimes?.last_obs ?? macro?.last_obs ?? null
  const eff = effectiveScenario(sc, { lastObs })
  const state = fromMacroMode(sc.macro_mode)
  const preset = presetOf(state)
  const [advOpen, setAdvOpen] = useState(() => preset === null)
  const { sample } = useMacroSample(scenarioMacroMode(sc, eff.months), eff.months)
  const st = sample ? sampleStats(sample) : null
  const ctx: ConditionContext = {
    lastObs, months: eff.months, rhoFromBeta: rhoFromBeta(sc), corrStatus: passport.byCode['r1.30']?.status,
    generator: st ? { cpiEnd: st.cpi.end, fxEnd: st.fx.end } : null,
  }
  const toPreset = (id: string) => {
    const p = getPreset(id)
    if (!p) return
    const prev: Partial<PriceScenario> = Object.fromEntries([['macro_mode', sc.macro_mode || 'base'], ...CONDITION_KEYS.map((k) => [k, sc[k] ?? ''])])
    onPatch(sc, presetPatch(p, eff.months, true))
    showUndo({ message: `Пресет «${p.short}» применён`, onUndo: () => onPatch(sc, prev) })
  }
  const act = (a: RegimeMenuAction) => {
    const next = regimeMenuReducer(state, a)
    if (next === state) return
    const ser = serializeMode(next, eff.months)
    if (ser !== (sc.macro_mode || 'base')) onPatch(sc, { macro_mode: ser })
  }

  return (
    <div className="sc2-tab sc2-cond">
      <PresetCard sc={sc} state={state} months={eff.months} regimes={regimes} macro={macro} onPatch={onPatch} />

      <div className="sc2-fields" role="group" aria-label="Условия сценария">
        {CONDITION_GROUPS.map((g) => {
          const specs = CONDITION_SPECS.filter((s) => s.group === g.id)
          return (
            <section key={g.id} className={`sc2-fgroup sc2-fgroup--${specs.length}`} aria-labelledby={`sc2-fg-${g.id}`}>
              <h3 className="sc2-cap" id={`sc2-fg-${g.id}`}>{g.title} <span className="sc2-cap__affects">→ {g.affects}</span></h3>
              <div className="sc2-fgroup__grid">
                {specs.map((spec) => (
                  <ConditionCard key={spec.key} spec={spec} sc={sc} eff={eff} ctx={ctx} preset={preset} state={state} onPatch={onPatch} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <section className={`sc2-regime${advOpen ? ' is-open' : ''}`} aria-label="Расширенные настройки генератора">
        <button type="button" className="sc2-fold" aria-expanded={advOpen} onClick={() => setAdvOpen((v) => !v)}>
          <svg className="sc2-fold__chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Расширенные настройки генератора
          <span className="sc2-fold__hint">свой период истории, кризисный режим, крайний путь, от чего отсчитывать ставку и инфляцию</span>
        </button>
        {advOpen && <GeneratorAdvanced state={state} horizon={eff.months} regimes={regimes} macro={macro} onAction={act} onPreset={toPreset} />}
      </section>
    </div>
  )
}

interface CardProps {
  spec: ConditionSpec
  sc: PriceScenario
  eff: EffectiveScenario
  ctx: ConditionContext
  preset: ScenarioPreset | null
  state: RegimeMenuState
  onPatch: Props['onPatch']
}

/** Значение поля, его происхождение и к чему вернёт «вернуть»: умолчание из данных · значение пресета · вручную. */
function cardValue({ spec, eff, ctx, preset, state }: Pick<CardProps, 'spec' | 'eff' | 'ctx' | 'preset' | 'state'>) {
  const isDefault = eff.isDefault[spec.key]
  // Сдвиг курса пресета «Слабый рубль» живёт в режиме генератора (ref.fx); поле сценария его перекрывает.
  const fxPreset = spec.key === 'fx' && state.refFx !== 1 ? state.refFx : undefined
  if (fxPreset !== undefined && isDefault) return { stored: fxPreset, isDefault: false, fromPreset: true, fallback: fxPreset }
  const presetValue = preset?.values[spec.key as PresetValueKey]
  const fromPreset = !isDefault && presetValue !== undefined && Math.abs(presetValue - eff[spec.key]) < 1e-9
  return { stored: eff[spec.key], isDefault, fromPreset, fallback: fxPreset ?? defaultsFor(ctx)[spec.key] }
}

/** Поле условия: умолчание — источник данных; значение пресета — «экспертная оценка пресета»; иначе — «вручную · вернуть». */
function ConditionCard({ spec, sc, eff, ctx, preset, state, onPatch }: CardProps) {
  const { stored, isDefault, fromPreset, fallback } = cardValue({ spec, eff, ctx, preset, state })
  const origin = spec.origin(ctx)
  const prov = isDefault
    ? { status: origin.status, source: origin.source }
    : { provenance: 'manual' as const, source: fromPreset && preset ? `${preset.group === 'stress' ? 'стресс-тест' : 'экспертная оценка'} пресета «${preset.short}»` : undefined }
  const set = (v: number) => onPatch(sc, { [spec.key]: String(spec.toStored(v)) })
  const revert = () => onPatch(sc, resetPatch([spec.key], ctx))
  const cum = Math.pow(1 + eff.inflation, eff.months) - 1
  return (
    <ParamField label={spec.label} value={spec.toShown(stored)} unit={spec.unit} {...prov}
      changed={!isDefault && !fromPreset} onRevert={revert} revertTo={spec.toShown(fallback)}
      range={spec.range} step={spec.step} min={spec.min} max={spec.max} onChange={set} slider collapsedSlider size="md"
      effect={spec.effect(stored, ctx, isDefault)} info={spec.info} hint={spec.hint(ctx)}
      infoValues={spec.key === 'inflation' ? { cum, pi: eff.inflation, months: eff.months } : undefined} />
  )
}
