/**
 * Вкладка «Прогноз и проверка» [7] (UX-V2 §5.1, §5.3): сначала качество — сводка по изделиям
 * (skill к наивному, покрытие 80 %, прокси CRPS по пинбол-потерям P10/P90) цветными статусами, затем
 * веера (`FanChart` с осями дат и значений, ромбы факта бэктеста), карточка ставки — из генератора
 * (synthetic:false), бейджи «демонстрационные данные» по флагам ответа; «вклад факторов» — под веером.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type ForecastProduct, type ForecastResult, type PriceScenario } from '../../lib/api'
import { money, num, pct, signed } from '../../explain/format'
import { FanChart, type FanQuality } from '../../ui/FanChart'
import { BarList, Legend, Meter, fanLegend, type BarRow } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { Chip, InlineError, SkeletonRows } from '../plan/ui'
import { fromMacroMode, toMacroMode } from './regimeMenu'
import './scenarios-v2.css'

interface Props { sc: PriceScenario; refreshKey?: number }

/** Сколько худших изделий показывать в таблице качества по умолчанию. */
const QUALITY_TOP = 10

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
  const [showAllQuality, setShowAllQuality] = useState(false)
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
  // Худшие — первыми (по skill); в таблице по умолчанию топ-10, остальные — по кнопке.
  const quality = useMemo(() => [...goods, ...raws].map((p) => ({ p, q: qualityOf(p) })).filter((x) => x.q.status !== 'none')
    .sort((a, b) => (a.q.skill ?? 0) - (b.q.skill ?? 0)), [goods, raws])
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
          <thead><tr>
            <th scope="col">Изделие</th><th scope="col">MAPE</th><th scope="col">наивный</th>
            <th scope="col" className="sc2-qtable__skill">skill к наивному</th><th scope="col">покрытие</th><th scope="col">прокси CRPS</th><th scope="col">распределение (AIC)</th><th scope="col" />
          </tr></thead>
          <tbody>
            {(showAllQuality ? quality : quality.slice(0, QUALITY_TOP)).map(({ p, q }) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td className="num">{pct(p.backtest!.mape / 100, 1)}</td>
                <td className="num">{pct(p.backtest!.mape_naive / 100, 1)}</td>
                <td className="num sc2-qtable__skill">
                  <span className="sc2-qtable__meter">
                    <Meter value={Math.max(-1, Math.min(1, q.skill ?? 0))} min={-1} max={1} tone={q.status === 'ok' ? 'accent' : 'warn'}
                      label={`skill ${pct(q.skill ?? 0, 0)}`} />
                    <span>{signed(q.skill ?? 0, '%')}</span>
                  </span>
                </td>
                <td className="num">{pct(q.coverage80 ?? 0, 0)}</td>
                <td className="num">{money(q.crps ?? 0)}</td>
                <td><span className="sc2-chip">{p.fit?.data_driven ? `${p.fit.dist}${p.fit.nu ? ` ν=${num(p.fit.nu, 0)}` : ''} · n=${p.fit.n_obs}` : '—'}</span></td>
                <td><span className={q.status === 'ok' ? 'glyph-running' : 'glyph-setup'} aria-label={q.status === 'ok' ? 'лучше наивного' : 'хуже наивного'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {quality.length > QUALITY_TOP && (
          <button type="button" className="btn btn--ghost sc2-qtable__more" onClick={() => setShowAllQuality((v) => !v)}>
            {showAllQuality ? `показать худшие ${QUALITY_TOP}` : `все ${quality.length}`}
          </button>
        )}
      </section>

      {res.rate && (
        <section className="sc2-group" aria-label="Ключевая ставка">
          <p className="sc2-group__t text-caps">Внешнее условие — ключевая ставка <span className="sc2-muted">{res.rate.source ?? ''}{res.rate.regimes ? ` · ${res.rate.regimes} режима` : ''}</span></p>
          <div className="sc2-fans">
            <FanChart a={res.rate} fmt={(v) => pct(v / 100, 1)} monthLabel={monthLabel} quality={qualityOf(res.rate)}
              title={res.rate.name} badges={<ProvenanceBadge status={res.rate.synthetic === false ? 'Н' : 'синтетика'} />} />
          </div>
        </section>
      )}

      {[{ title: 'Изделия (цены сбыта)', items: goods }, { title: 'Сырьё (закупочные цены)', items: raws }].map((g) => g.items.length > 0 && (
        <section key={g.title} className="sc2-group" aria-label={g.title}>
          <p className="sc2-group__t text-caps">{g.title}</p>
          <Legend className="sc2-fans__legend" items={fanLegend({ hasHistory: g.items.some((p) => (p.history?.length ?? 0) > 0), hasTrend: g.items.some((p) => Boolean(p.trend)) })} />
          <div className="sc2-fans">
            {g.items.map((p) => {
              const last = p.p50.length - 1
              const delta = p.base > 0 ? p.p50[last] / p.base - 1 : 0
              return (
                <div key={p.id} className="sc2-fan">
                  <FanChart a={p} fmt={(v) => money(v)} monthLabel={monthLabel} quality={qualityOf(p)} title={p.name} showLegend={false}
                    badges={<><Chip>{signed(delta, '%')}</Chip>{res.synthetic && <ProvenanceBadge status="синтетика" />}</>} />
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

/** Вклад факторов под веером (не в модале): двуполярные бары от нуля; устаревшие множители = 0. */
function Contrib({ c }: { c: NonNullable<ForecastProduct['contrib']> }) {
  const rows: BarRow[] = [
    { key: 'hist', label: 'История ряда', value: c.hist_trend }, { key: 'infl', label: 'Инфляция', value: c.inflation },
    { key: 'fx', label: 'Курс', value: c.fx }, { key: 'demand', label: 'Спрос', value: c.demand },
    { key: 'risk', label: 'Санкции/ставка', value: c.risk_drift, secondary: 'устарело' },
    { key: 'macro', label: 'Энергия/логистика', value: c.macro, secondary: 'устарело' },
  ].filter((x) => Math.abs(x.value) > 0.0005 || x.secondary)
  return (
    <div className="sc2-contrib">
      <BarList rows={rows} bipolar fmt={(v) => signed(v, '%')} valueHeader="Вклад" compact
        title={<>итог к горизонту <b className="num">{signed(c.total, '%')}</b> <InfoTip id="forecast.factors" values={{ hist: c.hist_trend, inflation: c.inflation, risk: c.risk_drift, macro: c.macro, fx: c.fx, demand: c.demand, total: c.total }} /></>} />
    </div>
  )
}
