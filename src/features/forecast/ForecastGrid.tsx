/**
 * Общие части прогноза («Сценарии › Прогноз и проверка» и «Мониторинг»):
 *  - `ForecastFan` — веер на chart-системе (`Fan`): качество словами под заголовком (▲ у отклонения,
 *    ● у нормы — без цвета), штриховка внешней полосы у ненадёжного веера, Δ от «сейчас» чипом;
 *  - `ForecastGrid` — «Требуют внимания»: малые кратные в индексе «сейчас = 100» на общей шкале;
 *  - `ForecastTable` — все ряды таблицей кита: динамика, медиана и P10–P90 к горизонту, качество.
 */
import { useMemo } from 'react'
import type { ForecastProduct } from '../../lib/api'
import { joinRange, num, pct } from '../../explain/format'
import { Fan, Legend, Meter, Sparkline, fanLegend } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { Chip, DataTable, type DataColumn } from '../../ui/kit'
import {
  baseRefLine, fmtFor, forecastDelta, indexTo100, monthLabel, nowValue, qualityMark, qualityOf, sharedDomain, type SeriesQuality,
} from './forecastModel'
import './forecast.css'

/** Строка качества: глиф + фраза + «i» (CRPS и формулы — там). */
export function QualityNote({ q }: { q: SeriesQuality }) {
  const mark = qualityMark(q.level)
  return (
    <span className={`fc-q fc-q--${q.level}`}>
      <span className="fc-q__g" aria-hidden="true">{mark.glyph}</span>
      <span>{q.sentence}</span>
      {q.level !== 'none' && (
        <InfoTip id="forecast.crps" values={{ crps: q.crps, crps_naive: null, skill: q.skill, coverage: q.coverage80 }} />
      )}
    </span>
  )
}

interface FanProps {
  p: ForecastProduct
  height?: number
  /** Индекс «сейчас = 100» и общая шкала (малые кратные). */
  indexed?: boolean
  yDomain?: readonly [number, number]
  showLegend?: boolean
  onOpen?: (p: ForecastProduct) => void
  caveat?: string
}

export function ForecastFan({ p, height = 180, indexed = false, yDomain, showLegend = false, onOpen, caveat }: FanProps) {
  const q = qualityOf(p)
  const d = forecastDelta(p)
  const series = indexed ? indexTo100(p) : p
  const ref = indexed ? null : baseRefLine(p)
  const fmt = indexed ? (v: number) => num(v, 0) : fmtFor(p)
  return (
    <Fan a={series} fmt={fmt} monthLabel={monthLabel} backtestK={q.backtestK} height={height} title={p.name}
      subtitle={<QualityNote q={q} />} quality={q.level === 'bad' ? 'bad' : q.level === 'warn' ? 'warn' : 'ok'}
      badges={d ? <Chip size="sm" title={d.label}>{d.text}</Chip> : undefined} yDomain={yDomain}
      refLines={ref ? [ref] : []} showLegend={showLegend} caveat={caveat} className="fc-fan"
      actions={onOpen ? <button type="button" className="pf-link" onClick={() => onOpen(p)}>открыть веер</button> : undefined} />
  )
}

/** «Требуют внимания»: веера в индексе «сейчас = 100» на одной шкале и одна легенда над сеткой. */
export function ForecastGrid({ products, onOpen }: { products: readonly ForecastProduct[]; onOpen: (p: ForecastProduct) => void }) {
  const domain = useMemo(() => sharedDomain(products.map(indexTo100)), [products])
  if (products.length === 0) return null
  const hasHistory = products.some((p) => (p.history?.length ?? 0) > 0)
  const hasTrend = products.some((p) => Boolean(p.trend))
  const k = qualityOf(products[0]).backtestK
  return (
    <div className="fc-grid-wrap">
      <Legend className="fc-legend" items={fanLegend({ hasHistory, hasTrend, backtestK: k })} />
      <p className="fc-scale fc-muted">Индекс: «сейчас» = 100, шкала общая — веера сравнимы по ширине и наклону.</p>
      <div className="fc-grid">
        {products.map((p) => <ForecastFan key={p.id} p={p} indexed yDomain={domain} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

/* ── Таблица рядов ────────────────────────────────────────────────────────── */

const ROLE_GROUP: Record<ForecastProduct['role'], string> = { rate: 'Внешние условия', product: 'Изделия (цены сбыта)', raw: 'Сырьё (закупочные цены)' }
/** log2 отношения ошибок на шкале ±3 (×⅛…×8): 0 — как «как вчера». */
const LOG_SPAN = 3

interface Row { p: ForecastProduct; q: SeriesQuality; delta: number | null; spark: number[]; mark: number }

function rowOf(p: ForecastProduct): Row {
  const hist = (p.history ?? []).slice(-12)
  return { p, q: qualityOf(p), delta: forecastDelta(p)?.value ?? null, spark: [...hist, ...p.p50.slice(1)], mark: Math.max(0, hist.length - 1) }
}

const at = (a: ReadonlyArray<number>) => a[a.length - 1]

function columns(withQuality: boolean, onOpen: (p: ForecastProduct) => void): ReadonlyArray<DataColumn<Row>> {
  const base: DataColumn<Row>[] = [
    { key: 'name', title: 'Ряд', rowHeader: true, clip: true, get: (r) => r.p.name },
    { key: 'spark', title: 'Динамика', sortable: false, render: (r) => <Sparkline points={r.spark} mark={r.mark} width={96} height={24} /> },
    { key: 'now', title: 'Сейчас', num: true, get: (r) => nowValue(r.p), render: (r) => fmtFor(r.p)(nowValue(r.p)) },
    { key: 'p50', title: 'Медиана к горизонту', num: true, get: (r) => at(r.p.p50), render: (r) => fmtFor(r.p)(at(r.p.p50)) },
    {
      key: 'delta', title: 'Δ к сейчас', num: true, get: (r) => (r.delta === null ? null : Math.abs(r.delta)),
      render: (r) => forecastDelta(r.p)?.text ?? '—',
    },
    {
      key: 'band', title: 'P10–P90 · 8 из 10', num: true, sortable: false,
      render: (r) => { const f = fmtFor(r.p); return joinRange(f(at(r.p.p10)), f(at(r.p.p90))) },
    },
  ]
  const quality: DataColumn<Row>[] = [
    {
      key: 'ratio', title: 'Ошибка к «как вчера»', num: true, className: 'fc-t__ratio', hint: 'Во сколько раз ошибка модели больше (×>1) или меньше (×<1) ошибки прогноза «как вчера»',
      get: (r) => r.q.ratio,
      render: (r) => (r.q.ratio === null ? '—' : (
        <span className="fc-t__meter">
          <Meter value={Math.max(-LOG_SPAN, Math.min(LOG_SPAN, Math.log2(r.q.ratio)))} min={-LOG_SPAN} max={LOG_SPAN} tone="neutral" label={`ошибка к наивной ×${num(r.q.ratio, 1)}`} />
          <span>×{num(r.q.ratio, r.q.ratio >= 10 ? 0 : 1)}</span>
        </span>
      )),
    },
    { key: 'cov', title: 'Попадание в P10–P90', num: true, hint: 'доля месяцев проверки, где факт попал в полосу; норма — 8 из 10', get: (r) => r.q.coverage80, render: (r) => (r.q.coverage80 === null ? '—' : pct(r.q.coverage80, 0)) },
    { key: 'q', title: 'Качество', get: (r) => r.q.level, render: (r) => { const m = qualityMark(r.q.level); return <span className={`fc-q fc-q--${r.q.level}`}><span className="fc-q__g" aria-hidden="true">{m.glyph}</span> {m.word}</span> } },
  ]
  const open: DataColumn<Row> = {
    key: 'open', title: '', sortable: false,
    render: (r) => <button type="button" className="pf-link" onClick={(e) => { e.stopPropagation(); onOpen(r.p) }}>открыть веер</button>,
  }
  return [...base, ...(withQuality ? quality : []), open]
}

interface TableProps {
  products: readonly ForecastProduct[]
  onOpen: (p: ForecastProduct) => void
  withQuality?: boolean
  /** Показать первые N (кнопка «Показать все N»). */
  limit?: number
  caption: string
  /** Сортировка по умолчанию: качество (худшие первыми) или |Δ| к сейчас. */
  sortBy?: 'quality' | 'delta'
  loading?: boolean
}

export function ForecastTable({ products, onOpen, withQuality = true, limit, caption, sortBy = 'quality', loading }: TableProps) {
  const rows = useMemo(() => products.map(rowOf), [products])
  const cols = useMemo(() => columns(withQuality, onOpen), [withQuality, onOpen])
  return (
    <DataTable<Row> columns={cols} rows={rows} rowKey={(r) => r.p.id} onRowClick={(r) => onOpen(r.p)} rowTitle={() => 'Открыть веер ряда'}
      groupBy={(r) => r.p.role} groupLabel={(key, n) => `${ROLE_GROUP[key as ForecastProduct['role']] ?? key} · ${num(n, 0)}`}
      defaultSort={sortBy === 'delta' ? { key: 'delta', dir: 'desc' } : { key: 'ratio', dir: 'desc' }} limit={limit}
      caption={caption} tight loading={loading} empty="Рядов прогноза нет" className="fc-table" />
  )
}
