/**
 * Вкладка «Условия» [1] (UX-V2 §5.1): поля сгруппированы по тому, НА ЧТО влияют — «Цены сбыта»
 * (инфляция, волатильность, корреляция), «Себестоимость» (курс; энергия/логистика → устарели),
 * «Деньги» (ключевая ставка генератора; кредит = ключевая + спред [F]), «Спрос», «Режимы» (меню §2.6б
 * с полосой режимов и паспортом генератора). Каждое поле — ParamField с бейджем и накопленным эффектом.
 */
import type { MacroRegimes, MacroSummary, PriceScenario } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { ParamField } from '../../ui/ParamField'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { usePassport } from '../passport/passportStore'
import { RegimeMenu } from './RegimeMenuPanel'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
}

const n = (v: string | undefined, d: number) => { const x = Number(v); return v === undefined || v === '' || !Number.isFinite(x) ? d : x }

export function ConditionsTab({ sc, regimes, macro, onPatch }: Props) {
  const passport = usePassport()
  const months = n(sc.months, 6)
  const infl = n(sc.inflation, 0)
  const vol = n(sc.volatility, 0.05)
  const corr = n(sc.market_corr, 0.5)
  const fx = n(sc.fx, 1)
  const demand = n(sc.demand, 1)
  const cum = Math.pow(1 + infl, months) - 1
  const fin = passport.fin
  const keyRate = macro?.last_obs.key_pp ?? (fin ? fin.key_rate * 100 : null)
  const set = (k: keyof PriceScenario, v: number) => onPatch(sc, { [k]: String(v) })
  const prov = (v: number, d: number): 'manual' | 'default' => (v !== d ? 'manual' : 'default')

  return (
    <div className="sc2-tab">
      <section className="sc2-group" aria-label="Цены сбыта">
        <p className="sc2-group__t text-caps">Цены сбыта <span className="sc2-muted">— влияют на: веер цен, прибыль портфеля, выручку кассы</span></p>
        <div className="sc2-fields">
          <ParamField label="Инфляция" value={infl * 100} unit="%/мес" provenance={prov(infl, 0)} owner="этот сценарий" range={[0, 2]} step={0.1} min={0} max={10} slider
            onChange={(v) => set('inflation', v / 100)} info="forecast.inflation" infoValues={{ cum, pi: infl, months }}
            effect={<>за {months} мес: <b className="num">+{pct(cum, 0)}</b></>}
            note={infl > 0.02 ? 'Подсказка: это месячная, а не годовая величина (8,5 %/мес за 13 мес = +188 %).' : 'С генератором цены дополнительно индексируются на накопленную инфляцию его путей (pass-through b^π = 1 [К]).'} size="lg" />
          <ParamField label="Волатильность цен" value={vol * 100} unit="%/мес" provenance={prov(vol, 0.05)} status={vol === 0.05 ? 'UI' : undefined} owner="этот сценарий" range={[0, 20]} step={0.5} min={0} max={25} slider
            onChange={(v) => set('volatility', v / 100)} effect={<>σ за горизонт ≈ <b className="num">{pct(vol * Math.sqrt(months), 0)}</b> (√t)</>} />
          <ParamField label="Корреляция рынка ρ" value={corr} provenance={prov(corr, 0.5)} status={passport.byCode['r1.30']?.status} owner="этот сценарий" range={[0, 1]} step={0.05} min={0} max={0.98} slider
            onChange={(v) => set('market_corr', v)} info="opt.hhi"
            effect={corr >= 0.7 ? 'цены ходят вместе — диверсификация слабее' : 'цены независимее — диверсификация снижает риск'}
            note="С обученным генератором общий фактор заменяется первой SVD-компонентой макро-инноваций (γ_s = β_s из распределений)." />
          <ParamField label="Горизонт" value={months} unit="мес" provenance={prov(months, 6)} owner="этот сценарий" range={[1, 36]} step={1} min={1} max={36} onChange={(v) => set('months', Math.round(v))}
            effect={<>{num(months * 720, 0)} ч · портфель и касса считаются на этот горизонт</>} />
        </div>
      </section>

      <section className="sc2-group" aria-label="Себестоимость">
        <p className="sc2-group__t text-caps">Себестоимость <span className="sc2-muted">— влияют на: закупочные цены сырья, конверсию</span></p>
        <div className="sc2-fields">
          <ParamField label="Курс (множитель прогноза цен)" value={fx} unit="×" provenance={prov(fx, 1)} owner="этот сценарий" range={[0.5, 2]} step={0.05} min={0.5} max={2} slider onChange={(v) => set('fx', v)}
            note="Множитель уровня цен в /api/forecast; в портфеле и кассе курс берётся из путей генератора: Δln p = b^FX·Δln S (b^FX = 0,10 изделия / 0,30 сырьё [К])." />
          <ParamField label="Курсовая эластичность сырья b^FX" value={Number(passport.byCode['macro.pt_fx_raw']?.value) || 0.3} status={passport.byCode['macro.pt_fx_raw']?.status ?? 'К'} owner={passport.byCode['macro.pt_fx_raw']?.source || 'паспорт macro.pt_fx_raw'} readOnly
            note="Доля импортной составляющей — калибровка; оценка [О] появится по истории цен предприятия (HAC-регрессия §2.4)." />
        </div>
      </section>

      <section className="sc2-group" aria-label="Деньги">
        <p className="sc2-group__t text-caps">Деньги <span className="sc2-muted">— влияют на: ставку кредитной линии, проценты, DSCR (слой F)</span></p>
        <div className="sc2-fields">
          <ParamField label="Ключевая ставка" value={keyRate} unit="%/год" status={macro ? 'Н' : 'НОРМ'} owner={macro ? `ЦБ РФ, последнее наблюдение ${macro.last_obs.month}` : 'fin_params'} readOnly
            effect={fin ? <>ставка линии = ключевая + спред {num(fin.spread * 100, 2)} % = <b className="num">{keyRate !== null ? num(keyRate + fin.spread * 100, 2) : '—'} %</b></> : undefined}
            note="По сценариям и неделям ставка идёт путём генератора (ступень по месяцам), не константой; ползунок «ключевая ставка» устарел." info="cash.int_cost" />
          <ParamField label="Опора ставки i_ref" value={String(passport.byCode['macro.ref_key']?.value ?? 'плоская')} status={passport.byCode['macro.ref_key']?.status ?? 'НОРМ'} owner="паспорт macro.ref_key" readOnly
            note="Меняется в меню режимов ниже (плоская / пользовательская)." />
        </div>
      </section>

      <section className="sc2-group" aria-label="Спрос">
        <p className="sc2-group__t text-caps">Спрос <span className="sc2-muted">— влияет на: потолок продаж demand_max портфеля</span></p>
        <div className="sc2-fields">
          <ParamField label="Спрос (множитель)" value={demand} unit="×" provenance={prov(demand, 1)} owner="этот сценарий" range={[0.5, 2]} step={0.05} min={0.3} max={2} slider onChange={(v) => set('demand', v)}
            note="Стохастический спрос E[min(q, D)] (Р6) не реализован — потолок детерминирован (R12)." />
        </div>
      </section>

      <section className="sc2-group" aria-label="Режимы">
        <p className="sc2-group__t text-caps">
          Режимы <span className="sc2-muted">— обученный генератор VAR → SVD → HMM → блоки вместо ползунков</span>
          <span className="sc2-badges">
            <ProvenanceBadge status={passport.byCode['macro.generator']?.status ?? 'О'} long />
            {macro && <span className="sc2-muted">cbr.ru {macro.data.first}…{macro.data.last} · n = {macro.data.n} · CRPS {num(macro.selection.choice.joint_standardized_CRPS_13months, 3)} vs персистентность {num(macro.selection.choice.naive_persistence_joint_CRPS, 3)}</span>}
          </span>
        </p>
        <RegimeMenu value={sc.macro_mode} months={months} regimes={regimes} macro={macro} onChange={(json) => onPatch(sc, { macro_mode: json })} />
      </section>

      <details className="sc2-legacy">
        <summary>Устаревшие параметры (не используются в расчёте) — санкции, налоги, энергия, логистика, ключевая ставка</summary>
        <div className="sc2-fields">
          {([['Санкции', 'sanctions', '—', 0, 1, 0.05], ['Изменение налогов', 'tax_change', 'п.п.', -10, 15, 0.5], ['Цена энергии', 'energy', '×', 0.5, 3, 0.05], ['Логистика', 'logistics', '×', 0.5, 3, 0.05], ['Ключевая ставка (ползунок)', 'key_rate', '%/год', 0, 30, 0.25]] as const).map(([label, key, unit, lo, hi, step]) => (
            <ParamField key={key} label={label} value={n(sc[key], key === 'energy' || key === 'logistics' ? 1 : key === 'key_rate' ? 8 : 0)} unit={unit} status="UI" deprecated owner="этот сценарий" min={lo} max={hi} step={step} slider
              onChange={(v) => set(key, v)} note={passport.byCode[key === 'sanctions' || key === 'key_rate' ? 'r1.51' : 'r1.53']?.note || 'Принимается API и возвращается как deprecated_fields; бэктест и веер от него не зависят (R6).'} />
          ))}
        </div>
      </details>
    </div>
  )
}
