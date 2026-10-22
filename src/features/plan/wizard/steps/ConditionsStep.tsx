/**
 * Шаг 2 «Внешние условия» [1] (UX-V2 §4.2): сценарий наследуется из портфеля (chip) или выбирается;
 * read-only сводка обученного генератора (режимы, CRPS / персистентность, покрытие 80 %, бейдж
 * синтетики для истории цен), текущий режим/стресс сценария (меню §2.6б правится на экране «Сценарии»),
 * поля с паспортом для величин, влияющих на план и кассу; устаревшие ползунки — свёрнуто.
 */
import { useState } from 'react'
import { num, pct } from '../../../../explain/format'
import { ParamField } from '../../../../ui/ParamField'
import { ProvenanceBadge } from '../../../../ui/ProvenanceBadge'
import { macroModeLabel } from '../../../method-map/derivePassports'
import { useRefs } from '../../../method-map/useMethodMapState'
import { usePassport } from '../../../passport/passportStore'
import { Chip } from '../../ui'
import type { WizardData } from '../useWizardData'
import { useWizard, wizardActions } from '../wizardStore'

export function ConditionsStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const refs = useRefs()
  const passport = usePassport()
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const sc = data.scenario
  const macro = refs.macro
  const inherited = w.source === 'portfolio' && Boolean(data.run)
  const owner = sc ? `из сценария «${sc.name}»` : undefined
  const infl = sc ? Number(sc.inflation) || 0 : 0
  const months = sc ? Number(sc.months) || 6 : 6
  const cum = Math.pow(1 + infl, months) - 1
  const synthetic = passport.byCode['r1.59']?.status === 'синтетика'
  const cov = macro?.holdout?.variables
  const modeLabel = macroModeLabel(sc?.macro_mode)
  const stress = modeLabel !== 'base'
  const keyRate = macro ? macro.last_obs.key_pp : passport.fin ? passport.fin.key_rate * 100 : null
  const spread = passport.fin ? passport.fin.spread * 100 : null

  return (
    <div className="wz-step">
      <div className="wz-card wz-card--accent">
        <div className="wz-card__head">
          <p className="wz-card__t">
            {inherited ? <>Наследуется из портфеля → сценарий <b>«{sc?.name ?? '…'}»</b></> : <>Сценарий внешних условий</>}
          </p>
          {inherited && !switching
            ? <button type="button" className="btn btn--sm" onClick={() => setSwitching(true)}>Сменить сценарий…</button>
            : (
              <select className="plan__select" value={data.effectiveScenarioId} onChange={(e) => { wizardActions.setScenarioId(e.target.value); setSwitching(false) }}>
                {data.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
        </div>
        {switching && <p className="pl-note" style={{ color: 'var(--ochre)' }}>▲ Портфель считался под сценарий «{data.run?.scenario_name}»: при смене сценария программа останется, но условия Стадии 2 и Стадии 1 разойдутся — пересчитайте портфель.</p>}
        {sc && (
          <p className="pl-note">
            Сценарий в Стадии 1 влияет на: сроки поставок (MRP), ставку кредитной линии и цены сценариев кассы (слой F); на порядок операций — через хвосты длительностей, не через цены.
            {' '}Критерий и α прогона — тоже из сценария: <b>{sc.objective || 'cvar'}</b>, α = <b className="num">{pct(Number(sc.alpha) || 0.1, 0)}</b> (шаг «Цель и риск»).
          </p>
        )}
      </div>

      <section className="wz-card" aria-label="Обученный макро-генератор">
        <div className="wz-card__head">
          <p className="wz-card__t">Обученный генератор внешних условий · VAR → SVD → HMM → блоки</p>
          <span className="wz-badges">
            <ProvenanceBadge status={passport.byCode['macro.generator']?.status ?? (macro ? 'О' : undefined)} long />
            {synthetic && <ProvenanceBadge status="синтетика" title="История цен изделий (ts_data) синтетическая — демонстрация; ряды ЦБ РФ — настоящие" long />}
          </span>
        </div>
        {macro ? (
          <div className="wz-gen">
            <div className="wz-gen__cell"><span className="text-caps">данные</span><b>{macro.data.source}</b><span className="num">{macro.data.first} … {macro.data.last} · n = {macro.data.n}</span></div>
            <div className="wz-gen__cell"><span className="text-caps">режимы</span><b className="num">{macro.regimes} · блок {macro.block_months} мес</b><span>{data.regimes?.regimes.map((r) => `${r.label} ${pct(r.share_of_history, 0)}`).join(' · ')}</span></div>
            <div className="wz-gen__cell"><span className="text-caps">CRPS (выбор)</span><b className="num">{num(macro.selection.choice.joint_standardized_CRPS_13months, 3)}</b><span className="num">персистентность {num(macro.selection.choice.naive_persistence_joint_CRPS, 3)}</span></div>
            <div className="wz-gen__cell">
              <span className="text-caps">покрытие 80 %</span>
              <b className="num">{cov ? `π ${num(cov.cpi_yoy_pp.coverage80, 2)} · ставка ${num(cov.key_pp.coverage80, 2)} · курс ${num(cov.usd_rub.coverage80, 2)}` : '—'}</b>
              {macro.holdout?.flags.undercoverage80.length ? <Chip tone="warn">недопокрытие: {macro.holdout.flags.undercoverage80.join(', ')}</Chip> : <Chip tone="good">в пределах порога</Chip>}
            </div>
            <div className="wz-gen__cell">
              <span className="text-caps">режим сценария</span>
              <b>{stress ? modeLabel : 'базовый — прогноз'}</b>
              {stress ? <Chip tone="warn">стресс, не прогноз</Chip> : <Chip tone="good">прогноз (§2.6б)</Chip>}
              <a className="pf-link" href={`#/scenarios/conditions`}>меню режимов и стрессов → «Сценарии»</a>
            </div>
          </div>
        ) : <p className="pl-note">Сводка генератора недоступна (GET /api/macro/summary): условия берутся из полей сценария; ставка — из fin_params.</p>}
      </section>

      <div className="wz-fields">
        <ParamField label="Ключевая ставка" value={keyRate} unit="%/год" status={macro ? 'Н' : 'НОРМ'} owner={macro ? `ЦБ РФ, последнее наблюдение ${macro.last_obs.month}` : 'fin_params проекта'}
          readOnly effect={spread !== null && keyRate !== null ? <>ставка линии = ключевая + спред {num(spread, 2)} % = <b className="num">{num(keyRate + spread, 2)} %</b> [слот F]</> : undefined}
          note="Влияет на: ставку кредитной линии и проценты в водопаде кассы; по сценариям — путь генератора, не константа." />
        <ParamField label="Инфляция (прогноз цен)" value={infl * 100} unit="%/мес" provenance={infl > 0 ? 'manual' : 'default'} owner={owner} readOnly
          range={[0, 2]} effect={<>за {months} мес: <b className="num">{cum >= 0 ? '+' : ''}{pct(cum, 0)}</b>{infl > 0.02 ? ' — это месячная, не годовая величина' : ''}</>}
          note="Влияет на: цены сценариев кассы (pass-through [К]); на расписание не влияет." />
        <ParamField label="Волатильность цен" value={(sc ? Number(sc.volatility) || 0.05 : 0.05) * 100} unit="%/мес" provenance="default" owner={owner} readOnly
          note="Влияет на: разброс прибыли и кассы; на порядок операций не влияет." />
        <ParamField label="Корреляция рынка ρ" value={sc ? Number(sc.market_corr) || 0.5 : 0.5} provenance="default" status={passport.byCode['r1.30']?.status} owner={owner} readOnly
          note="Влияет на: диверсификацию портфеля; с генератором фактор заменён первой SVD-компонентой (γ_s = β_s)." />
      </div>

      <details className="wz-legacy" open={legacyOpen} onToggle={(e) => setLegacyOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Устаревшие параметры (не используются в расчёте с волны M)</summary>
        <div className="wz-fields">
          {([['Санкции', 'sanctions', '—'], ['Изменение налогов', 'tax_change', 'п.п.'], ['Цена энергии', 'energy', '×'], ['Логистика', 'logistics', '×'], ['Ключевая ставка (ползунок)', 'key_rate', '%/год']] as const).map(([label, key, unit]) => (
            <ParamField key={key} label={label} value={sc ? Number(sc[key]) || 0 : 0} unit={unit} status="UI" deprecated owner={owner} readOnly size="md"
              note={passport.byCode[key === 'sanctions' || key === 'key_rate' ? 'r1.51' : 'r1.53']?.note || 'Принимается API и возвращается как deprecated_fields; в расчёте не участвует.'} />
          ))}
        </div>
      </details>
    </div>
  )
}
