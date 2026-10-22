/**
 * Вкладка «Условия» [1] (UX-V2 §5.1, X1 §3.1): поля сгруппированы по тому, НА ЧТО влияют —
 * «Цены сбыта» (инфляция, волатильность, корреляция, горизонт), «Себестоимость» (курс,
 * чувствительность сырья), «Деньги» (ключевая ставка, опора), «Спрос», «Режимы генератора».
 * Поля — `ParamField` md в сетке 4 колонок: одно крупное число, ползунок по фокусу/наведению,
 * длинные пояснения — в «i» (`hint`), предупреждение «вне диапазона» остаётся на месте.
 * «Режимы генератора» свёрнуты в строку-сводку; меню режимов монтируется при раскрытии.
 */
import { useState, type ReactNode } from 'react'
import type { MacroRegimes, MacroSummary, PriceScenario } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { ParamField } from '../../ui/ParamField'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { Chip } from '../../ui/kit'
import { usePassport } from '../passport/passportStore'
import { RegimeMenu } from './RegimeMenuPanel'
import { fromMacroMode, regimeLabel, regimeSummary } from './regimeMenu'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
}

const HOURS_PER_MONTH = 720
const DEFAULTS = { months: 6, inflation: 0, volatility: 0.05, corr: 0.5, fx: 1, demand: 1, ptFxRaw: 0.3 } as const
/** Устаревшие ползунки (не в расчёте): подпись, поле, единица, умолчание, диапазон, шаг. */
const LEGACY = [
  ['Санкции', 'sanctions', '—', 0, 0, 1, 0.05], ['Изменение налогов', 'tax_change', 'п.п.', 0, -10, 15, 0.5],
  ['Цена энергии', 'energy', '×', 1, 0.5, 3, 0.05], ['Логистика', 'logistics', '×', 1, 0.5, 3, 0.05],
  ['Ключевая ставка (ползунок)', 'key_rate', '%/год', 8, 0, 30, 0.25],
] as const

const n = (v: string | undefined, d: number) => { const x = Number(v); return v === undefined || v === '' || !Number.isFinite(x) ? d : x }

export function ConditionsTab({ sc, regimes, macro, onPatch }: Props) {
  const passport = usePassport()
  const months = n(sc.months, DEFAULTS.months)
  const infl = n(sc.inflation, DEFAULTS.inflation)
  const vol = n(sc.volatility, DEFAULTS.volatility)
  const corr = n(sc.market_corr, DEFAULTS.corr)
  const fx = n(sc.fx, DEFAULTS.fx)
  const demand = n(sc.demand, DEFAULTS.demand)
  const cum = Math.pow(1 + infl, months) - 1
  const fin = passport.fin
  const keyRate = macro?.last_obs.key_pp ?? (fin ? fin.key_rate * 100 : null)
  const lineRate = keyRate !== null && fin ? keyRate + fin.spread * 100 : null
  const set = (k: keyof PriceScenario, v: number) => onPatch(sc, { [k]: String(v) })
  const prov = (v: number, d: number): 'manual' | 'default' => (v !== d ? 'manual' : 'default')
  const common = { owner: 'этот сценарий', slider: true, collapsedSlider: true, size: 'md' as const }

  return (
    <div className="sc2-tab">
      <Group title="Цены сбыта" affects="веер цен, прибыль портфеля, выручка кассы">
        <ParamField {...common} label="Инфляция" value={infl * 100} unit="%/мес" provenance={prov(infl, DEFAULTS.inflation)} range={[0, 2]} step={0.1} min={0} max={10}
          onChange={(v) => set('inflation', v / 100)} info="forecast.inflation" infoValues={{ cum, pi: infl, months }}
          effect={<>за {months} мес: <b className="num">+{pct(cum, 0)}</b></>}
          hint={infl > 0.02
            ? 'Это месячная, а не годовая величина: 8,5 %/мес за 13 мес даёт +188 %.'
            : 'С обученным генератором цены дополнительно индексируются на накопленную инфляцию его путей (pass-through b^π = 1, калибровка).'} />
        <ParamField {...common} label="Волатильность цен" value={vol * 100} unit="%/мес" provenance={prov(vol, DEFAULTS.volatility)} status={vol === DEFAULTS.volatility ? 'UI' : undefined}
          range={[0, 20]} step={0.5} min={0} max={25} onChange={(v) => set('volatility', v / 100)}
          effect={<>σ за горизонт ≈ <b className="num">{pct(vol * Math.sqrt(months), 0)}</b> (√t)</>}
          hint="Месячное стандартное отклонение цен; за горизонт растёт как корень из числа месяцев." />
        <ParamField {...common} label="Корреляция цен ρ" value={corr} provenance={prov(corr, DEFAULTS.corr)} status={passport.byCode['r1.30']?.status} range={[0, 1]} step={0.05} min={0} max={0.98}
          onChange={(v) => set('market_corr', v)} info="opt.hhi"
          effect={corr >= 0.7 ? 'цены ходят вместе — диверсификация слабее' : 'цены независимее — диверсификация снижает риск'}
          hint="С обученным генератором общий фактор заменяется первой SVD-компонентой макро-инноваций (γ_s = β_s из распределений)." />
        <ParamField {...common} slider={false} label="Горизонт" value={months} unit="мес" provenance={prov(months, DEFAULTS.months)} range={[1, 36]} step={1} min={1} max={36}
          onChange={(v) => set('months', Math.round(v))} effect={<><b className="num">{num(months * HOURS_PER_MONTH, 0)}</b> ч</>}
          hint="Портфель и касса считаются на этот горизонт; месяц = 720 ч." />
      </Group>

      <Group title="Себестоимость" affects="закупочные цены сырья, конверсия">
        <ParamField {...common} label="Курс валют" value={fx} unit="×" provenance={prov(fx, DEFAULTS.fx)} range={[0.5, 2]} step={0.05} min={0.5} max={2} onChange={(v) => set('fx', v)}
          hint="Множитель уровня цен в прогнозе; в портфеле и кассе курс берётся из путей генератора: Δln p = b^FX·Δln S (b^FX = 0,10 для изделий, 0,30 для сырья — калибровка)." />
        <ParamField size="md" label="Чувствительность сырья к курсу" value={Number(passport.byCode['macro.pt_fx_raw']?.value) || DEFAULTS.ptFxRaw}
          status={passport.byCode['macro.pt_fx_raw']?.status ?? 'К'} owner={passport.byCode['macro.pt_fx_raw']?.source || 'паспорт macro.pt_fx_raw'} readOnly
          hint="Курсовая эластичность сырья b^FX — доля импортной составляющей (калибровка). Оценка по данным появится по истории цен предприятия (HAC-регрессия, §2.4)." />
      </Group>

      <Group title="Деньги" affects="ставка кредитной линии, проценты, DSCR (слой F)">
        <ParamField size="md" label="Ключевая ставка" value={keyRate} unit="%/год" status={macro ? 'Н' : 'НОРМ'} owner={macro ? `ЦБ РФ, ${macro.last_obs.month}` : 'fin_params'} readOnly info="cash.int_cost"
          effect={lineRate !== null ? <>ставка линии ≈ <b className="num">{num(lineRate, 1)} %</b></> : undefined}
          hint={<>Ставка линии = ключевая + спред{fin ? ` ${num(fin.spread * 100, 2)} %` : ''}. По сценариям и неделям ставка идёт путём генератора (ступень по месяцам), не константой; ползунок «ключевая ставка» устарел.</>} />
        <ParamField size="md" label="Опора ставки" value={String(passport.byCode['macro.ref_key']?.value ?? 'плоская')} status={passport.byCode['macro.ref_key']?.status ?? 'НОРМ'} owner="паспорт macro.ref_key" readOnly
          hint="Уровень i_ref, вокруг которого генератор строит путь ставки; меняется в «Режимах генератора» (плоская / пользовательская)." />
      </Group>

      <Group title="Спрос" affects="потолок продаж портфеля">
        <ParamField {...common} label="Спрос" value={demand} unit="×" provenance={prov(demand, DEFAULTS.demand)} range={[0.5, 2]} step={0.05} min={0.3} max={2} onChange={(v) => set('demand', v)}
          hint="Множитель потолка demand_max. Стохастический спрос E[min(q, D)] (Р6) не реализован — потолок детерминирован (R12)." />
      </Group>

      <RegimesSection sc={sc} months={months} regimes={regimes} macro={macro} onPatch={onPatch} generatorStatus={passport.byCode['macro.generator']?.status ?? 'О'} />

      <details className="sc2-legacy">
        <summary>Устаревшие параметры (не используются в расчёте) — санкции, налоги, энергия, логистика, ключевая ставка</summary>
        <div className="sc2-fields">
          {LEGACY.map(([label, key, unit, dflt, lo, hi, step]) => (
            <ParamField key={key} {...common} label={label} value={n(sc[key], dflt)} unit={unit} status="UI" deprecated min={lo} max={hi} step={step}
              onChange={(v) => set(key, v)}
              hint={passport.byCode[key === 'sanctions' || key === 'key_rate' ? 'r1.51' : 'r1.53']?.note || 'Принимается API и возвращается как deprecated_fields; бэктест и веер от него не зависят (R6).'} />
          ))}
        </div>
      </details>
    </div>
  )
}

/** Группа полей «на что влияет»: caps-заголовок, стрелка к эффектам, сетка 4 колонок. */
function Group({ title, affects, children }: { title: string; affects: string; children: ReactNode }) {
  return (
    <section className="sc2-group" aria-label={title}>
      <h3 className="sc2-group__t text-caps">{title} <span className="sc2-group__affects">→ {affects}</span></h3>
      <div className="sc2-fields">{children}</div>
    </section>
  )
}

interface RegimesProps extends Props {
  months: number
  generatorStatus: string
}

/** «Режимы генератора»: свёрнуто в строку-сводку (режим · доли · CRPS), раскрывается в меню режимов. */
function RegimesSection({ sc, months, regimes, macro, onPatch, generatorStatus }: RegimesProps) {
  const [open, setOpen] = useState(false)
  const state = fromMacroMode(sc.macro_mode)
  const names = regimes?.regimes.map((r) => r.label) ?? []
  const shares = regimes?.regimes.map((r) => ({ label: r.label, share: r.share_of_history })) ?? []
  const crps = macro?.selection.choice.joint_standardized_CRPS_13months ?? null
  const label = regimeLabel(state, names)
  return (
    <section className={`sc2-group sc2-regimes${open ? ' is-open' : ''}`} aria-label="Режимы генератора">
      <button type="button" className="sc2-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg className="sc2-fold__chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="text-caps">Режимы генератора</span>
        <span className="sc2-fold__sum num">{regimeSummary(state, shares, crps, names)}</span>
        <Chip tone={label.isForecast ? 'good' : 'warn'} size="sm">{label.isForecast ? 'прогноз' : 'стресс'}</Chip>
        <ProvenanceBadge status={generatorStatus} />
      </button>
      {open && (
        <>
          <p className="sc2-muted sc2-regimes__meta">
            Обученный генератор VAR → SVD → HMM: блоки вместо ползунков.
            {macro && <> Данные cbr.ru {macro.data.first}…{macro.data.last} · n = {macro.data.n} · CRPS {num(macro.selection.choice.joint_standardized_CRPS_13months, 3)} против персистентности {num(macro.selection.choice.naive_persistence_joint_CRPS, 3)}.</>}
          </p>
          <RegimeMenu value={sc.macro_mode} months={months} regimes={regimes} macro={macro} onChange={(json) => onPatch(sc, { macro_mode: json })} />
        </>
      )}
    </section>
  )
}
