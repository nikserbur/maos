/**
 * Вкладка «Условия» (X2 «важное — первым, без внутренностей движка»): сначала режим генератора —
 * переключатель «Прогноз · Режим · Квантиль · Эпизод» со сводкой; затем правимые поля одной сеткой
 * с подписями групп во всю ширину; значения генератора (ставка, опора, чувствительность сырья) —
 * одной строкой только для чтения. Поле показывает «изменено · вернуть» против умолчаний движка
 * (scenarioDefaults.ts) и бейдж: умолчание — статус паспорта, иначе «■ вручную».
 */
import { useState } from 'react'
import type { MacroRegimes, MacroSummary, PriceScenario } from '../../lib/api'
import { NBSP, num, pct, signed } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { Segmented } from '../../ui/kit'
import { usePassport } from '../passport/passportStore'
import { RegimeControls, RegimeSample } from './RegimeMenuPanel'
import { KIND_OPTIONS, fromMacroMode, passportValueLabel, regimeMenuReducer, regimeSummary, serializeMode, type RegimeMenuAction } from './regimeMenu'
import { SCENARIO_DEFAULTS as D, effectiveScenario, fieldBadge, type NumericKey } from './scenarioDefaults'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
}

const PT_FX_RAW_DEFAULT = 0.3
const MONTHS_RU = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'] as const

/** «2026-09» → «сент. 2026». */
export function monthShort(ym: string | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym ?? '')
  if (!m) return ''
  const i = Number(m[2]) - 1
  return i >= 0 && i < 12 ? `${MONTHS_RU[i]} ${m[1]}` : ''
}

export function ConditionsTab({ sc, regimes, macro, onPatch }: Props) {
  const passport = usePassport()
  const eff = effectiveScenario(sc)
  const cum = Math.pow(1 + eff.inflation, eff.months) - 1
  const set = (k: NumericKey, v: number) => onPatch(sc, { [k]: String(v) })
  const revert = (k: NumericKey) => () => onPatch(sc, { [k]: String(D[k]) })
  const field = (k: NumericKey, status?: string) => ({ ...fieldBadge(k, eff[k], status), changed: !eff.isDefault[k], onRevert: revert(k) })
  const common = { slider: true, collapsedSlider: true, size: 'md' as const }

  return (
    <div className="sc2-tab sc2-cond">
      <RegimeSection sc={sc} months={eff.months} regimes={regimes} macro={macro} onPatch={onPatch} generatorStatus={passport.byCode['macro.generator']?.status ?? 'О'} />

      <section className="sc2-fields" aria-label="Параметры условий">
        <h3 className="sc2-cap text-caps">Цены сбыта <span className="sc2-cap__affects">→ веер цен, прибыль портфеля, выручка кассы</span></h3>
        <ParamField {...common} {...field('inflation')} label="Инфляция" value={eff.inflation * 100} unit="%/мес" range={[0, 2]} step={0.1} min={0} max={10}
          onChange={(v) => set('inflation', v / 100)} info="forecast.inflation" infoValues={{ cum, pi: eff.inflation, months: eff.months }}
          effect={<>за {num(eff.months, 0)} мес: <b className="num">{signed(cum, '%')}</b></>}
          hint={eff.inflation > 0.02 ? 'Это месячная, а не годовая величина.' : 'С генератором цены ещё индексируются на инфляцию его путей.'} />
        <ParamField {...common} {...field('volatility', 'UI')} label="Волатильность цен" value={eff.volatility * 100} unit="%/мес" range={[0, 20]} step={0.5} min={0} max={25}
          onChange={(v) => set('volatility', v / 100)}
          effect={<>за горизонт ≈ <b className="num">{pct(eff.volatility * Math.sqrt(eff.months), 0)}</b></>}
          hint="Месячное стандартное отклонение цен; за горизонт растёт как корень из числа месяцев." />
        <ParamField {...common} {...field('market_corr', passport.byCode['r1.30']?.status)} label="Корреляция цен ρ" value={eff.market_corr} range={[0, 1]} step={0.05} min={0} max={0.98}
          onChange={(v) => set('market_corr', v)} info="opt.hhi"
          effect={eff.market_corr >= 0.7 ? 'цены ходят вместе — диверсификация слабее' : 'диверсификация снижает риск'}
          hint="С генератором общий фактор цен — первая компонента макро-шоков; связь изделия с ним — β из «Распределений»." />

        <h3 className="sc2-cap text-caps">Себестоимость и спрос <span className="sc2-cap__affects">→ закупочные цены сырья, потолок продаж</span></h3>
        <ParamField {...common} {...field('fx')} label="Курс валют" value={eff.fx} unit="×" range={[0.5, 2]} step={0.05} min={0.5} max={2} onChange={(v) => set('fx', v)}
          hint="Множитель уровня цен в прогнозе; в портфеле и кассе курс идёт путями генератора." />
        <ParamField {...common} {...field('demand')} label="Спрос" value={eff.demand} unit="×" range={[0.5, 2]} step={0.05} min={0.3} max={2} onChange={(v) => set('demand', v)}
          hint="Множитель потолка продаж изделия; спрос сам по себе не случайный." />
      </section>

      <GeneratorLine macro={macro} />
    </div>
  )
}

/** Значения генератора — только чтение, одной строкой: ставка ЦБ → ставка линии · опора · сырьё к курсу. */
function GeneratorLine({ macro }: { macro: MacroSummary | null }) {
  const passport = usePassport()
  const fin = passport.fin
  const keyRate = macro?.last_obs.key_pp ?? (fin ? fin.key_rate * 100 : null)
  const lineRate = keyRate !== null && fin ? keyRate + fin.spread * 100 : null
  const ptFx = Number(passport.byCode['macro.pt_fx_raw']?.value)
  const when = monthShort(macro?.last_obs.month)
  return (
    <p className="sc2-ro">
      <span className="sc2-ro__k text-caps">Из генератора</span>
      {keyRate !== null && <span>Ставка ЦБ <b className="num">{num(keyRate, Number.isInteger(keyRate) ? 0 : 1)}{NBSP}%/год</b>{when ? ` (${when})` : ''}</span>}
      {lineRate !== null && <span>→ кредитная линия ≈ <b className="num">{num(lineRate, 1)}{NBSP}%</b></span>}
      <span>· опора — {passportValueLabel(passport.byCode['macro.ref_key']?.value)}</span>
      <span>· сырьё к курсу <b className="num">{num(Number.isFinite(ptFx) && ptFx > 0 ? ptFx : PT_FX_RAW_DEFAULT, 2)}</b></span>
      <InfoTip id="cash.int_cost" note="Ставка по сценариям идёт путём генератора по месяцам, не константой. Опора меняется в «Режиме генератора → пути и опоры»." />
    </p>
  )
}

interface RegimesProps extends Props {
  months: number
  generatorStatus: string
}

/** Режим генератора первым: переключатель + сводка; параметры стресса; пути и опоры — по раскрытию. */
function RegimeSection({ sc, months, regimes, macro, onPatch, generatorStatus }: RegimesProps) {
  const [open, setOpen] = useState(false)
  const state = fromMacroMode(sc.macro_mode)
  const names = regimes?.regimes.map((r) => r.label) ?? []
  const shares = regimes?.regimes.map((r) => ({ label: r.label, share: r.share_of_history })) ?? []
  const act = (a: RegimeMenuAction) => {
    const next = regimeMenuReducer(state, a)
    if (next === state) return
    const ser = serializeMode(next, months)
    if (ser !== (sc.macro_mode || 'base')) onPatch(sc, { macro_mode: ser })
  }
  return (
    <section className={`sc2-regime${open ? ' is-open' : ''}`} aria-label="Режим генератора">
      <div className="sc2-regime__head">
        <h3 className="sc2-cap text-caps">Режим генератора</h3>
        <Segmented label="Режим генератора" size="sm" value={state.kind} onChange={(kind) => act({ type: 'kind', kind })}
          options={KIND_OPTIONS.map((o) => ({ id: o.id, label: o.label, title: o.title }))} />
        <span className="sc2-regime__sum num">{regimeSummary(state, shares, null, names)}</span>
        <ProvenanceBadge status={generatorStatus} />
      </div>
      {state.kind !== 'base' && <RegimeControls part="stress" state={state} horizon={months} regimes={regimes} onAction={act} />}
      <button type="button" className="sc2-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg className="sc2-fold__chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Пути генератора и опоры
      </button>
      {open && (
        <>
          <RegimeControls part="refs" state={state} horizon={months} regimes={regimes} onAction={act} />
          <RegimeSample state={state} months={months} regimes={regimes} macro={macro} />
        </>
      )}
    </section>
  )
}
