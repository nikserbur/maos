/**
 * Вкладка «Прогноз и проверка» [7] (UX-V2 §5.1, §5.3; X1 §3 п. 4–5): сначала качество — плитки
 * и таблица `DataTable` (худшие первыми, топ-10 + «все N», сортировка по колонкам, skill —
 * двуполярный `Meter`), затем веера (`FanChart` на chart-системе, small multiples ≥ 200 px),
 * карточка ставки — из генератора; «вклад факторов» — под веером. Числа — через format.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type ForecastProduct, type ForecastResult, type PriceScenario } from '../../lib/api'
import { DASH, MINUS, money, num, pct, signed } from '../../explain/format'
import { FanChart, type FanQuality } from '../../ui/FanChart'
import { BarList, Legend, Meter, fanLegend, type BarRow } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { Chip, DataTable, InlineError, SkeletonRows, type DataColumn } from '../../ui/kit'
import { fromMacroMode, toMacroMode } from './regimeMenu'
import './scenarios-v2.css'

interface Props { sc: PriceScenario; refreshKey?: number }

/** Сколько худших изделий показывать в таблице качества по умолчанию. */
const QUALITY_TOP = 10
/** Сколько худших изделий перечислять в предупреждении. */
const WARN_NAMES = 6
const COVERAGE_OK = 0.7

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

interface QualityRow { p: ForecastProduct; q: FanQuality }

const QUALITY_COLUMNS: ReadonlyArray<DataColumn<QualityRow>> = [
  { key: 'name', title: 'Изделие', rowHeader: true, get: (r) => r.p.name },
  { key: 'mape', title: 'Ошибка', num: true, hint: 'MAPE бэктеста — средняя абсолютная ошибка, %', get: (r) => r.p.backtest?.mape ?? null, render: (r) => (r.p.backtest ? pct(r.p.backtest.mape / 100, 1) : DASH) },
  { key: 'naive', title: 'Наивный', num: true, hint: 'MAPE прогноза «как вчера»', get: (r) => r.p.backtest?.mape_naive ?? null, render: (r) => (r.p.backtest ? pct(r.p.backtest.mape_naive / 100, 1) : DASH) },
  {
    key: 'skill', title: 'Качество против «как вчера»', num: true, className: 'sc2-qtable__skill', hint: 'skill к наивному: > 0 — модель точнее персистентности', get: (r) => r.q.skill ?? null,
    render: (r) => (
      <span className="sc2-qtable__meter">
        <Meter value={Math.max(-1, Math.min(1, r.q.skill ?? 0))} min={-1} max={1} tone={r.q.status === 'ok' ? 'accent' : 'warn'} label={`skill ${pct(r.q.skill ?? 0, 0)}`} />
        <span>{signed(r.q.skill ?? 0, '%')}</span>
      </span>
    ),
  },
  { key: 'cov', title: 'Покрытие', num: true, hint: 'доля факта внутри 80 %-интервала', get: (r) => r.q.coverage80 ?? null, render: (r) => pct(r.q.coverage80 ?? 0, 0) },
  { key: 'crps', title: 'Прокси CRPS', num: true, hint: 'среднее пинбол-потерь P10/P90, ₽', get: (r) => r.q.crps ?? null, render: (r) => money(r.q.crps ?? 0) },
  {
    key: 'fit', title: 'Распределение', sortable: false, hint: 'семейство по AIC и число наблюдений',
    render: (r) => (r.p.fit?.data_driven ? <Chip size="sm">{r.p.fit.dist}{r.p.fit.nu ? ` ν = ${num(r.p.fit.nu, 0)}` : ''} · n = {num(r.p.fit.n_obs, 0)}</Chip> : DASH),
  },
  { key: 'status', title: '', sortable: false, render: (r) => <span className={r.q.status === 'ok' ? 'glyph-running' : 'glyph-setup'} aria-label={r.q.status === 'ok' ? 'лучше наивного' : 'хуже наивного'} /> },
]

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
  const quality = useMemo<QualityRow[]>(() => [...goods, ...raws].map((p) => ({ p, q: qualityOf(p) })).filter((x) => x.q.status !== 'none')
    .sort((a, b) => (a.q.skill ?? 0) - (b.q.skill ?? 0)), [goods, raws])
  const shown = useMemo(() => (showAllQuality ? quality : quality.slice(0, QUALITY_TOP)), [quality, showAllQuality])
  const worseRows = quality.filter((x) => x.q.status === 'warn')
  const worse = worseRows.length
  const covAvg = quality.length ? quality.reduce((a, x) => a + (x.q.coverage80 ?? 0), 0) / quality.length : null
  const skillAvg = quality.length ? quality.reduce((a, x) => a + (x.q.skill ?? 0), 0) / quality.length : null

  if (error) return <InlineError title="Прогноз не рассчитан" message={error} />
  if (!res || loading) return <SkeletonRows rows={5} label="Считаем прогноз" />
  const monthLabel = (o: number) => (o === 0 ? 'сейчас' : o > 0 ? `+${o} мес` : `${MINUS}${-o} мес`)

  return (
    <div className="sc2-tab">
      <section className="sc2-quality" aria-label="Качество прогноза">
        <div className="sc2-quality__head">
          <h3 className="sc2-group__t text-caps">Качество прогноза <InfoTip id="forecast.crps" values={{ crps: null, crps_naive: null, skill: skillAvg, coverage: covAvg }} /></h3>
          <span className="sc2-badges">
            {res.synthetic && <ProvenanceBadge status="синтетика" long title="История цен ts_data синтетическая (R7): качество демонстрационное" />}
            {res.demo && <Chip tone="warn">демонстрационные данные</Chip>}
            {res.rate && res.rate.synthetic === false && <Chip tone="good">ставка — обученный генератор, ряды ЦБ РФ</Chip>}
            {res.deprecated_fields?.length > 0 && <Chip title={`Поля приняты, но не использованы: ${res.deprecated_fields.join(', ')}`}>устаревшие поля: {num(res.deprecated_fields.length, 0)}</Chip>}
          </span>
        </div>
        <div className="sc2-quality__tiles">
          <div className={`sc2-qtile ${worse === 0 ? 'is-ok' : worse < quality.length / 2 ? 'is-warn' : 'is-bad'}`}>
            <span className="text-caps">качество против «как вчера»</span>
            <b className="num">{skillAvg !== null ? pct(skillAvg, 0) : DASH}</b>
            <span className="sc2-muted">{worse === 0 ? 'все изделия лучше наивного' : `${num(worse, 0)} из ${num(quality.length, 0)} хуже наивного`}</span>
          </div>
          <div className={`sc2-qtile ${covAvg !== null && covAvg >= COVERAGE_OK ? 'is-ok' : 'is-warn'}`}>
            <span className="text-caps">покрытие 80 %-интервала</span>
            <b className="num">{covAvg !== null ? pct(covAvg, 0) : DASH}</b>
            <span className="sc2-muted">ориентир 80 %; ниже — веер слишком узок</span>
          </div>
          <div className="sc2-qtile">
            <span className="text-caps">бэктест</span>
            <b className="num">{num(quality[0]?.q.backtestK ?? 6, 0)} мес</b>
            <span className="sc2-muted">скрыто от модели, одна точка отсечения</span>
          </div>
          <div className="sc2-qtile">
            <span className="text-caps">MASE</span>
            <b>{DASH}</b>
            <span className="sc2-muted">после план-факта (R20)</span>
          </div>
        </div>
        {worse > 0 && (
          <p className="sc2-muted sc2-quality__warn">
            <span className="glyph-setup" aria-hidden="true" /> Хуже наивного: {worseRows.slice(0, WARN_NAMES).map((x) => x.p.name).join(', ')}{worse > WARN_NAMES ? ` и ещё ${num(worse - WARN_NAMES, 0)}` : ''} — упростите модель (тип «нормальное», меньше гармоник) или переоцените после импорта факта; на синтетической истории это ожидаемо.
          </p>
        )}
        <DataTable<QualityRow> columns={QUALITY_COLUMNS} rows={shown} rowKey={(r) => r.p.id} defaultSort={{ key: 'skill', dir: 'asc' }} tight
          caption="Качество прогноза по изделиям, худшие первыми" empty="Бэктест не рассчитан" />
        {quality.length > QUALITY_TOP && (
          <button type="button" className="btn btn--ghost sc2-qtable__more" onClick={() => setShowAllQuality((v) => !v)}>
            {showAllQuality ? `показать худшие ${num(QUALITY_TOP, 0)}` : `все ${num(quality.length, 0)}`}
          </button>
        )}
      </section>

      {res.rate && (
        <section className="sc2-group" aria-label="Ключевая ставка">
          <h3 className="sc2-group__t text-caps">Внешнее условие — ключевая ставка <span className="sc2-group__affects">{res.rate.source ?? ''}{res.rate.regimes ? ` · ${num(res.rate.regimes, 0)} режима` : ''}</span></h3>
          <div className="sc2-fans">
            <FanChart a={res.rate} fmt={(v) => pct(v / 100, 1)} monthLabel={monthLabel} quality={qualityOf(res.rate)}
              title={res.rate.name} badges={<ProvenanceBadge status={res.rate.synthetic === false ? 'Н' : 'синтетика'} />} />
          </div>
        </section>
      )}

      {[{ title: 'Изделия (цены сбыта)', items: goods }, { title: 'Сырьё (закупочные цены)', items: raws }].map((g) => g.items.length > 0 && (
        <section key={g.title} className="sc2-group" aria-label={g.title}>
          <h3 className="sc2-group__t text-caps">{g.title}</h3>
          <Legend className="sc2-fans__legend" items={fanLegend({ hasHistory: g.items.some((p) => (p.history?.length ?? 0) > 0), hasTrend: g.items.some((p) => Boolean(p.trend)) })} />
          <div className="sc2-fans">
            {g.items.map((p) => {
              const last = p.p50.length - 1
              const delta = p.base > 0 ? p.p50[last] / p.base - 1 : 0
              return (
                <div key={p.id} className="sc2-fan">
                  <FanChart a={p} fmt={(v) => money(v)} monthLabel={monthLabel} quality={qualityOf(p)} title={p.name} showLegend={false}
                    badges={<><Chip size="sm">{signed(delta, '%')}</Chip>{res.synthetic && <ProvenanceBadge status="синтетика" />}</>} />
                  <div className="sc2-fan__foot">
                    <span className="sc2-muted num">через {num(last, 0)} мес: <b>{money(p.p50[last])}</b> ({money(p.p10[last])} – {money(p.p90[last])})</span>
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
