/**
 * Шаг 2 «Внешние условия» [1] (UX-V2 §4.2, X1 §5 п. 15): сценарий наследуется из портфеля или
 * выбирается; дальше — только сводка «наследуется из сценария …» + DiffList унаследованных полей
 * (генератор, режим, ключевая ставка, инфляция, волатильность, корреляция) с владельцами и
 * бейджами происхождения; редактирование — ссылкой в «Сценарии». Устаревшие ползунки — свёрнуто.
 * Только слова общего словаря (labels.ts): переменные, критерий — без id API.
 */
import { useState } from 'react'
import { num, pct } from '../../../../explain/format'
import { macroVarLabel, objectiveLabel } from '../../../../explain/labels'
import { DiffList, type DiffRow } from '../../../../ui/DiffList'
import { ParamField } from '../../../../ui/ParamField'
import { ProvenanceBadge } from '../../../../ui/ProvenanceBadge'
import { StateLegend } from '../../../../ui/StateLegend'
import { macroModeLabel } from '../../../method-map/derivePassports'
import { useRefs } from '../../../method-map/useMethodMapState'
import { usePassport } from '../../../passport/passportStore'
import { Chip } from '../../../../ui/kit'
import type { WizardData } from '../useWizardData'
import { useWizard, wizardActions } from '../wizardStore'
import { scenarioTitle } from './ProgramStep'
import { fmtMonth } from '../dates'

const DEFAULT_VOLATILITY = 0.05
const DEFAULT_CORR = 0.5
const DEFAULT_MONTHS = 6
/** Выше этого значения инфляция в месяц, скорее всего, введена как годовая. */
const INFLATION_SUSPECT = 0.02

export function ConditionsStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const refs = useRefs()
  const passport = usePassport()
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const sc = data.scenario
  const macro = refs.macro
  const inherited = w.source === 'portfolio' && Boolean(data.run)
  const owner = sc ? `из сценария «${scenarioTitle(sc.name)}»` : undefined
  const infl = sc ? Number(sc.inflation) || 0 : 0
  const months = sc ? Number(sc.months) || DEFAULT_MONTHS : DEFAULT_MONTHS
  const cum = Math.pow(1 + infl, months) - 1
  const synthetic = passport.byCode['r1.59']?.status === 'синтетика'
  const cov = macro?.holdout?.variables
  const modeLabel = macroModeLabel(sc?.macro_mode)
  const stress = modeLabel !== 'base'
  const keyRate = macro ? macro.last_obs.key_pp : passport.fin ? passport.fin.key_rate * 100 : null
  const crps = macro?.selection.choice.joint_standardized_CRPS_13months
  const naive = macro?.selection.choice.naive_persistence_joint_CRPS
  const skill = typeof crps === 'number' && typeof naive === 'number' && naive > 0 ? 1 - crps / naive : null
  const under = macro?.holdout?.flags.undercoverage80 ?? []
  const spread = passport.fin ? passport.fin.spread * 100 : null
  const regimesText = data.regimes?.regimes.map((r) => `${r.label} ${pct(r.share_of_history, 0)}`).join(' · ')

  const rows: DiffRow[] = [
    { key: 'generator', label: 'Генератор внешних условий', origin: macro ? 'inherited' : 'unset', step: 'conditions',
      owner: macro ? `ряды ЦБ РФ · ${fmtMonth(macro.data.first)} … ${fmtMonth(macro.data.last)} · ${num(macro.data.n, 0)} мес` : 'генератор недоступен — условия из полей сценария',
      value: macro ? <>{num(macro.regimes, 0)} режима · блоки по {num(macro.block_months, 0)} мес{skill !== null && <> · точнее наивного прогноза на <b>{pct(skill, 0)}</b></>}</> : '—' },
    { key: 'mode', label: 'Режим сценария', origin: sc ? 'inherited' : 'unset', owner, step: 'conditions',
      value: <>{stress ? modeLabel : 'базовый — прогноз'} {stress ? <Chip tone="warn">стресс, не прогноз</Chip> : <Chip>прогноз</Chip>}{regimesText && <span className="pl-note"> · {regimesText}</span>}</> },
    { key: 'coverage', label: 'Покрытие 80 % на отложенном периоде', origin: cov ? 'inherited' : 'unset', owner: macro ? 'проверка генератора на отложенном периоде' : undefined,
      value: cov ? <>инфляция {pct(cov.cpi_yoy_pp.coverage80, 0)} · ставка {pct(cov.key_pp.coverage80, 0)} · курс {pct(cov.usd_rub.coverage80, 0)} из номинальных 80 % {under.length ? <Chip tone="warn">недопокрытие: {under.map((v) => macroVarLabel(v)).join(', ')}</Chip> : <Chip>в пределах порога</Chip>}</> : '—' },
    { key: 'key_rate', label: 'Ключевая ставка', origin: keyRate !== null ? 'inherited' : 'unset',
      owner: macro ? `ЦБ РФ, последнее наблюдение ${fmtMonth(macro.last_obs.month)}` : 'финансовые параметры проекта',
      value: keyRate !== null ? <>{num(keyRate, 2)} %/год{spread !== null && <> → ставка линии {num(keyRate + spread, 2)} % (спред {num(spread, 2)} %)</>}</> : '—' },
    { key: 'inflation', label: 'Инфляция (прогноз цен)', origin: sc ? 'inherited' : 'unset', owner,
      value: sc ? <>{num(infl * 100, 2)} %/мес · за {num(months, 0)} мес {cum >= 0 ? '+' : ''}{pct(cum, 0)}{infl > INFLATION_SUSPECT && <Chip tone="warn">это месячная, не годовая</Chip>}</> : '—' },
    { key: 'volatility', label: 'Волатильность цен', origin: sc ? 'inherited' : 'unset', owner,
      value: sc ? `${num((Number(sc.volatility) || DEFAULT_VOLATILITY) * 100, 1)} %/мес` : '—' },
    { key: 'market_corr', label: 'Корреляция рынка ρ', origin: sc ? 'inherited' : 'unset', owner,
      value: sc ? num(Number(sc.market_corr) || DEFAULT_CORR, 2) : '—' },
  ]

  return (
    <div className="wz-step">
      <div className="wz-card wz-card--accent">
        <div className="wz-card__head">
          <p className="wz-card__t">
            {inherited ? <>Наследуется из портфеля → сценарий <b>«{sc ? scenarioTitle(sc.name) : '…'}»</b></> : sc ? <>Сценарий <b>«{scenarioTitle(sc.name)}»</b></> : <>Сценарий внешних условий</>}
            <span className="wz-badges">
              <ProvenanceBadge status={passport.byCode['macro.generator']?.status ?? (macro ? 'О' : undefined)} />
              {synthetic && <ProvenanceBadge status="синтетика" title="История цен изделий (ts_data) синтетическая — демонстрация; ряды ЦБ РФ — настоящие" />}
            </span>
          </p>
          <span className="wz-row">
            {inherited && !switching
              ? <button type="button" className="btn btn--sm" onClick={() => setSwitching(true)}>Сменить сценарий…</button>
              : (
                <select className="plan__select" value={data.effectiveScenarioId} onChange={(e) => { wizardActions.setScenarioId(e.target.value); setSwitching(false) }}>
                  {data.scenarios.map((s) => <option key={s.id} value={s.id}>{scenarioTitle(s.name)}</option>)}
                </select>
              )}
            <a className="pf-link" href="#/scenarios/conditions">изменить в «Сценарии» →</a>
          </span>
        </div>
        {switching && <p className="pl-note pl-note--warn"><span className="glyph-setup" aria-hidden="true" />Портфель считался под сценарий «{scenarioTitle(data.run?.scenario_name)}»: при смене сценария условия Стадии 2 и Стадии 1 разойдутся — пересчитайте портфель.</p>}
        <p className="pl-note">
          Сценарий влияет на сроки поставок и хвосты длительностей, на кассу — через ставку и цены.
          {sc && <> Критерий — {objectiveLabel(sc.objective || 'cvar')}, α = <b className="num">{pct(Number(sc.alpha) || 0.1, 0)}</b>.</>}
        </p>
        <StateLegend compact states={['estimated', 'manual', 'normative', 'default', 'stale']} />
      </div>

      <section className="wz-card" aria-label="Унаследованные условия">
        <p className="wz-card__t">Что наследуется в прогон</p>
        <DiffList rows={rows} />
      </section>

      <details className="wz-legacy" open={legacyOpen} onToggle={(e) => setLegacyOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Устаревшие параметры сценария — в расчёте не участвуют</summary>
        <div className="wz-fields">
          {([['Санкции', 'sanctions', '—'], ['Изменение налогов', 'tax_change', 'п.п.'], ['Цена энергии', 'energy', '×'], ['Логистика', 'logistics', '×'], ['Ключевая ставка (ползунок)', 'key_rate', '%/год']] as const).map(([label, key, unit]) => (
            <ParamField key={key} label={label} value={sc ? Number(sc[key]) || 0 : 0} unit={unit} status="UI" deprecated owner={owner} readOnly size="md"
              hint={passport.byCode[key === 'sanctions' || key === 'key_rate' ? 'r1.51' : 'r1.53']?.note || 'Поле хранится в сценарии, но в расчёте не участвует: внешние условия задаёт генератор.'} />
          ))}
        </div>
      </details>
    </div>
  )
}
