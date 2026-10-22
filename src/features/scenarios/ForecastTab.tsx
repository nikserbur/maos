/**
 * Вкладка «Прогноз и проверка» [7] (UX-V2 §5.1, §5.3): сначала качество — сводка по изделиям
 * (skill к наивному, покрытие 80 %, прокси CRPS по пинбол-потерям P10/P90) цветными статусами, затем
 * веера (`FanChart` с осями дат и значений, ромбы факта бэктеста), карточка ставки — из генератора
 * (synthetic:false), бейджи «демонстрационные данные» по флагам ответа; «вклад факторов» — под веером.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type ForecastProduct, type ForecastResult, type PriceScenario } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { FanChart, type FanQuality } from '../../ui/FanChart'
import { InfoTip } from '../../ui/InfoTip'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { Chip, InlineError, SkeletonRows } from '../plan/ui'
import { fromMacroMode, toMacroMode } from './regimeMenu'
import './scenarios-v2.css'

interface Props { sc: PriceScenario; refreshKey?: number }

export function qualityOf(p: ForecastProduct): FanQuality {
  const b = p.backtest
  if (!b) return { status: 'none' }
  const skill = 1 - b.skill
  return {
    skill, coverage80: b.coverage80, backtestK: b.k,
    crps: (b.pinball10 + b.pinball90) / 2, crpsLabel: 'прокси CRPS',
    status: b.skill < 1 ? 'ok' : 'warn',
    info: 'forecast.crps', infoValues: { crps: (b.pinball10 + b.pinball90) / 2, crps_naive: null, skill, coverage: b.coverage80 },
  }
}

export function ForecastTab({ sc, refreshKey = 0 }: Props) {
  const [res, setRes] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contribId, setContribId] = useState<string | null>(null)
  const months = Number(sc.months) || 6

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    const mode = toMacroMode(fromMacroMode(sc.macro_mode), months)
    const m = typeof mode === 'string' ? null : mode
    api.forecast({ scenario_id: sc.id, runs: 3000, backtest: 6, macro_stress: m?.stress ?? null, macro_ref: m?.ref })
      .then((r) => { if (alive) setRes(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Ошибка прогноза') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sc.id, sc.macro_mode, months, refreshKey])

  const goods = useMemo(() => res?.products.filter((p) => p.role === 'product') ?? [], [res])
  const raws = useMemo(() => res?.products.filter((p) => p.role === 'raw') ?? [], [res])
  const quality = useMemo(() => [...goods, ...raws].map((p) => ({ p, q: qualityOf(p) })).filter((x) => x.q.status !== 'none'), [goods, raws])
  const worse = quality.filter((x) => x.q.status === 'warn').length
  const covAvg = quality.length ? quality.reduce((a, x) => a + (x.q.coverage80 ?? 0), 0) / quality.length : null
  const skillAvg = quality.length ? quality.reduce((a, x) => a + (x.q.skill ?? 0), 0) / quality.length : null

  if (error) return <InlineError title="Прогноз не рассчитан" message={error} />
  if (!res || loading) return <SkeletonRows rows={5} label="Считаем прогноз" />
  const monthLabel = (o: number) => (o === 0 ? 'сейчас' : o > 0 ? `+${o} мес` : `−${-o} мес`)

  return (
    <div className="sc2-tab">
      <section className="sc2-quality" aria-label="Качество прогноза">
        <div className="sc2-quality__head">
          <p className="sc2-group__t text-caps">Качество прогноза <InfoTip id="forecast.crps" values={{ crps: null, crps_naive: null, skill: skillAvg, coverage: covAvg }} /></p>
          <span className="sc2-badges">
            {res.synthetic && <ProvenanceBadge status="синтетика" long title="История цен ts_data синтетическая (R7): качество демонстрационное" />}
            {res.demo && <Chip tone="warn">демонстрационные данные</Chip>}
            {res.rate && res.rate.synthetic === false && <Chip tone="good">ставка: обученный генератор, ряды ЦБ РФ</Chip>}
            {res.deprecated_fields?.length > 0 && <Chip title={`Поля приняты, но не использованы: ${res.deprecated_fields.join(', ')}`}>устаревшие поля: {res.deprecated_fields.length}</Chip>}
          </span>
        </div>
        <div className="sc2-quality__tiles">
          <div className={`sc2-qtile ${worse === 0 ? 'is-ok' : worse < quality.length / 2 ? 'is-warn' : 'is-bad'}`}>
            <span className="text-caps">skill к наивному</span>
            <b className="num">{skillAvg !== null ? pct(skillAvg, 0) : '—'}</b>
            <span className="sc2-muted">{worse === 0 ? 'все изделия лучше наивного' : `${worse} из ${quality.length} хуже наивного ▲`}</span>
          </div>
          <div className={`sc2-qtile ${covAvg !== null && covAvg >= 0.7 ? 'is-ok' : 'is-warn'}`}>
            <span className="text-caps">покрытие 80 %-интервала</span>
            <b className="num">{covAvg !== null ? pct(covAvg, 0) : '—'}</b>
            <span className="sc2-muted">ориентир 80 %; ниже — веер слишком узок</span>
          </div>
          <div className="sc2-qtile">
            <span className="text-caps">бэктест</span>
            <b className="num">{quality[0]?.q.backtestK ?? 6} мес</b>
            <span className="sc2-muted">скрыто от модели, одна точка отсечения</span>
          </div>
          <div className="sc2-qtile">
            <span className="text-caps">MASE</span>
            <b>—</b>
            <span className="sc2-muted">после план-факта (R20)</span>
          </div>
        </div>
        {worse > 0 && (
          <p className="sc2-muted">▲ Хуже наивного: {quality.filter((x) => x.q.status === 'warn').slice(0, 6).map((x) => x.p.name).join(', ')}{worse > 6 ? ` и ещё ${worse - 6}` : ''} — упростите модель (тип «нормальное», меньше гармоник) или переоцените после импорта факта; на синтетической истории это ожидаемо.</p>
        )}
        <table className="sc2-qtable">
          <thead><tr><th>Изделие</th><th>MAPE</th><th>наивный</th><th>skill</th><th>покрытие</th><th>прокси CRPS</th><th>распределение (AIC)</th><th />
          </tr></thead>
          <tbody>
            {quality.map(({ p, q }) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num">{pct(p.backtest!.mape, 1)}</td>
                <td className="num">{pct(p.backtest!.mape_naive, 1)}</td>
                <td className="num">{pct(q.skill ?? 0, 0)}</td>
                <td className="num">{pct(q.coverage80 ?? 0, 0)}</td>
                <td className="num">{num(q.crps ?? 0, 3)}</td>
                <td className="sc2-muted">{p.fit?.data_driven ? `${p.fit.dist}${p.fit.nu ? ` ν=${num(p.fit.nu, 0)}` : ''} · n=${p.fit.n_obs}` : '—'}</td>
                <td><span className={q.status === 'ok' ? 'glyph-running' : 'glyph-setup'} aria-label={q.status === 'ok' ? 'лучше наивного' : 'хуже наивного'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {res.rate && (
        <section className="sc2-group" aria-label="Ключевая ставка">
          <p className="sc2-group__t text-caps">Внешнее условие — ключевая ставка <span className="sc2-muted">{res.rate.source ?? ''}{res.rate.regimes ? ` · ${res.rate.regimes} режима` : ''}</span></p>
          <div className="sc2-fans">
            <FanChart a={res.rate} fmt={(v) => `${v.toFixed(1)} %`} monthLabel={monthLabel} quality={qualityOf(res.rate)}
              title={res.rate.name} badges={<ProvenanceBadge status={res.rate.synthetic === false ? 'Н' : 'синтетика'} />} />
          </div>
        </section>
      )}

      {[{ title: 'Изделия (цены сбыта)', items: goods }, { title: 'Сырьё (закупочные цены)', items: raws }].map((g) => g.items.length > 0 && (
        <section key={g.title} className="sc2-group" aria-label={g.title}>
          <p className="sc2-group__t text-caps">{g.title}</p>
          <div className="sc2-fans">
            {g.items.map((p) => {
              const last = p.p50.length - 1
              const delta = p.base > 0 ? p.p50[last] / p.base - 1 : 0
              return (
                <div key={p.id} className="sc2-fan">
                  <FanChart a={p} fmt={(v) => money(v)} monthLabel={monthLabel} quality={qualityOf(p)} title={p.name}
                    badges={<><Chip tone={delta >= 0 ? 'good' : 'bad'}>{delta >= 0 ? '+' : ''}{pct(delta, 1)}</Chip>{res.synthetic && <ProvenanceBadge status="синтетика" />}</>} />
                  <div className="sc2-fan__foot">
                    <span className="sc2-muted num">через {last} мес: <b>{money(p.p50[last])}</b> ({money(p.p10[last])} – {money(p.p90[last])})</span>
                    {p.contrib && <button type="button" className="pf-link" onClick={() => setContribId(contribId === p.id ? null : p.id)}>{contribId === p.id ? 'скрыть вклад' : 'вклад факторов'}</button>}
                  </div>
                  {contribId === p.id && p.contrib && <Contrib c={p.contrib} />}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Вклад факторов под веером (не в модале): история, инфляция, курс, спрос; устаревшие множители = 0. */
function Contrib({ c }: { c: NonNullable<ForecastProduct['contrib']> }) {
  const items = [
    { label: 'История ряда', v: c.hist_trend }, { label: 'Инфляция', v: c.inflation }, { label: 'Курс', v: c.fx }, { label: 'Спрос', v: c.demand },
    { label: 'Санкции/ставка (устарело)', v: c.risk_drift }, { label: 'Энергия/логистика (устарело)', v: c.macro },
  ].filter((x) => Math.abs(x.v) > 0.0005 || x.label.includes('устарело'))
  const mx = Math.max(0.01, ...items.map((x) => Math.abs(x.v)))
  return (
    <div className="sc2-contrib">
      <p className="sc2-muted">итог к горизонту <b>{c.total >= 0 ? '+' : ''}{pct(c.total, 1)}</b> <InfoTip id="forecast.factors" values={{ hist: c.hist_trend, inflation: c.inflation, risk: c.risk_drift, macro: c.macro, fx: c.fx, demand: c.demand, total: c.total }} /></p>
      {items.map((x) => (
        <div key={x.label} className="sc2-contrib__row">
          <span>{x.label}</span>
          <span className="sc2-contrib__bar"><span style={{ width: `${(Math.abs(x.v) / mx) * 100}%`, background: x.v >= 0 ? 'var(--cinnabar)' : 'var(--verdigris)' }} /></span>
          <span className="num">{x.v >= 0 ? '+' : ''}{pct(x.v, 1)}</span>
        </div>
      ))}
    </div>
  )
}
