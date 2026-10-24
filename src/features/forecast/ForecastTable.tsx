/**
 * Таблица рядов прогноза («Сценарии › Пути цен» и «Мониторинг»), кит DataTable (владелец: «И…»,
 * «Медиана к горизонт», колонки за правым краем). Таблица помещается по ширине: медиана и её изменение —
 * одна ячейка «46,8 тыс. ₽ · +25 %», ошибка к «как вчера» и попадание в полосу — в подсказке «Надёжности»
 * (подробности — в панели веера), «Динамика» и диапазон скрываются первыми на узкой вкладке.
 * Имя — полностью: основное название строкой 1, марка и назначение — приглушённо строкой 2.
 * В строке один порядок денег (Сейчас, Медиана, Диапазон: «0,66–7,76 тыс. ₽»). Числа — через src/explain/format.ts.
 */
import { useMemo } from 'react'
import type { ForecastProduct } from '../../lib/api'
import { NBSP, joinRange, num, pct, plural, rangeText } from '../../explain/format'
import { columnScale } from '../../explain/columnScale'
import { Sparkline } from '../../ui/charts'
import { DataTable, type DataColumn } from '../../ui/kit'
import { forecastDelta, nowValue, qualityMark, qualityOf, timesText, type SeriesQuality } from './forecastModel'
import { splitSeriesName } from './seriesName'
import './forecast.css'

const ROLE_GROUP: Record<ForecastProduct['role'], string> = { rate: 'Внешние условия', product: 'Изделия (цены сбыта)', raw: 'Сырьё (закупочные цены)' }
/** Пороги скрытия по ширине обёртки, px: «Динамика» (priority 3), затем диапазон (priority 2). */
const COLLAPSE = { p3: 1000, p2: 760 } as const
const MONTHS = ['месяц', 'месяца', 'месяцев'] as const
const POINTS = ['пункт', 'пункта', 'пунктов'] as const

interface Row { p: ForecastProduct; q: SeriesQuality; delta: number | null; spark: number[]; mark: number }

function rowOf(p: ForecastProduct): Row {
  const hist = (p.history ?? []).slice(-12)
  return { p, q: qualityOf(p), delta: forecastDelta(p)?.value ?? null, spark: [...hist, ...p.p50.slice(1)], mark: Math.max(0, hist.length - 1) }
}

const at = (a: ReadonlyArray<number>) => a[a.length - 1]

/** Форматы строки в одном порядке: деньги — по большему из «сейчас», медианы и P90; ставка — проценты. */
function rowFormat(p: ForecastProduct): { one: (v: number) => string; range: (lo: number, hi: number) => string } {
  if (p.role === 'rate') return { one: (v) => pct(v / 100, 1), range: (lo, hi) => rangeText(lo / 100, hi / 100, '%') }
  const s = columnScale([nowValue(p), at(p.p50), at(p.p10), at(p.p90)])
  const unit = `${NBSP}${s.unit}`
  return { one: (v) => `${s.fmt(v)}${unit}`, range: (lo, hi) => joinRange(`${s.fmt(lo)}${unit}`, `${s.fmt(hi)}${unit}`) }
}

/** Изменение медианы без сокращений: цены — «+25 %», ставка — «+1,2 пункта». */
function deltaText(p: ForecastProduct): string {
  const d = forecastDelta(p)
  if (!d) return '—'
  if (p.role !== 'rate') return d.text
  const v = d.value * 100
  const t = num(Math.abs(v), 1)
  const shown = Number(t.replace(/[\s ]/g, '').replace(',', '.'))
  const sign = shown === 0 ? '' : v > 0 ? '+' : '−'
  return `${sign}${t}${NBSP}${plural(shown, POINTS)}`
}

/** Подробности надёжности для подсказки: ошибка к «как вчера» и попадание факта в полосу — словами. */
export function reliabilityDetail(q: SeriesQuality): string {
  if (q.level === 'none' || q.ratio === null || q.coverage80 === null) return 'Качество веера не проверено на истории'
  const err = q.ratio > 1 ? `ошибка ${timesText(q.ratio)} больше, чем у прогноза «как вчера»` : `ошибка на ${pct(1 - q.ratio, 0)} меньше, чем у прогноза «как вчера»`
  const hits = Math.round(q.coverage80 * q.backtestK)
  return `${err[0].toUpperCase()}${err.slice(1)}; факт попал в полосу «8 из 10» ${num(hits, 0)} из ${num(q.backtestK, 0)} ${plural(q.backtestK, MONTHS)} проверки`
}

function Reliability({ q }: { q: SeriesQuality }) {
  const m = qualityMark(q.level)
  return (
    <span className={`fc-q fc-q--${q.level}`} title={reliabilityDetail(q)}>
      <span className="fc-q__g" aria-hidden="true">{m.glyph}</span> {m.word}
    </span>
  )
}

function SeriesNameCell({ name }: { name: string }) {
  const { main, detail } = splitSeriesName(name)
  return (
    <span className="fc-t__name">
      <span>{main}</span>
      {detail && <span className="fc-t__detail">{detail}</span>}
    </span>
  )
}

/** Порядок сортировки надёжности: худшие — первыми при убывании; внутри уровня — по ошибке к «как вчера». */
const LEVEL_ORDER: Record<SeriesQuality['level'], number> = { bad: 3, warn: 2, none: 1, ok: 0 }
const reliabilityRank = (q: SeriesQuality): number => LEVEL_ORDER[q.level] + Math.min(0.99, (q.ratio ?? 0) / 1000)

function columns(horizon: number): ReadonlyArray<DataColumn<Row>> {
  const when = horizon > 0 ? `через ${num(horizon, 0)}${NBSP}${plural(horizon, MONTHS)}` : 'к горизонту'
  return [
    { key: 'name', title: 'Ряд', rowHeader: true, primary: true, get: (r) => r.p.name, render: (r) => <SeriesNameCell name={r.p.name} /> },
    { key: 'spark', title: 'Динамика', sortable: false, width: 'fit', priority: 3, render: (r) => <Sparkline points={r.spark} mark={r.mark} width={96} height={24} /> },
    { key: 'now', title: 'Сейчас', num: true, get: (r) => nowValue(r.p), render: (r) => rowFormat(r.p).one(nowValue(r.p)) },
    {
      key: 'delta', title: `Медиана ${when} и изменение`, num: true,
      hint: 'Медиана прогноза к концу горизонта и её изменение от «сейчас» (последней точки истории); сортировка — по величине изменения',
      get: (r) => (r.delta === null ? null : Math.abs(r.delta)),
      render: (r) => <span className="fc-t__med">{rowFormat(r.p).one(at(r.p.p50))}<span className="fc-t__delta"> · {deltaText(r.p)}</span></span>,
    },
    {
      key: 'band', title: '8 из 10 исходов', num: true, sortable: false, priority: 2,
      hint: 'Диапазон к концу горизонта, в который попадают 8 из 10 смоделированных исходов (от 10-го до 90-го процентиля)',
      render: (r) => rowFormat(r.p).range(at(r.p.p10), at(r.p.p90)),
    },
    {
      key: 'q', title: 'Надёжность', width: 'fit',
      hint: 'По проверке на истории: ошибка к прогнозу «как вчера» и попадание факта в полосу «8 из 10» — в подсказке строки и в панели веера',
      get: (r) => reliabilityRank(r.q), render: (r) => <Reliability q={r.q} />,
    },
    { key: 'open', title: '', sortable: false, width: 'fit', render: () => <span className="fc-t__chev" aria-hidden="true">›</span> },
  ]
}

interface TableProps {
  products: readonly ForecastProduct[]
  onOpen: (p: ForecastProduct) => void
  /** Полный перечень с проверкой качества (вкладка «Пути цен») — во всю ширину; без него — короткий топ по содержимому. */
  withQuality?: boolean
  /** Показать первые N (кнопка «Показать все N»). */
  limit?: number
  caption: string
  /** Сортировка по умолчанию: качество (худшие первыми) или |Δ| к сейчас. */
  sortBy?: 'quality' | 'delta'
  loading?: boolean
  /** Текст пустой таблицы. */
  empty?: string
  /** По умолчанию: полный перечень — во всю ширину, короткий топ (без качества) — по содержимому. */
  width?: 'full' | 'content'
}

export function ForecastTable({ products, onOpen, withQuality = true, limit, caption, sortBy = 'quality', loading, empty = 'Рядов прогноза нет', width }: TableProps) {
  const rows = useMemo(() => products.map(rowOf), [products])
  const horizon = products.length ? Math.max(...products.map((p) => p.p50.length - 1)) : 0
  const cols = useMemo(() => columns(horizon), [horizon])
  return (
    <DataTable<Row> columns={cols} rows={rows} rowKey={(r) => r.p.id} onRowClick={(r) => onOpen(r.p)} rowTitle={() => 'Открыть веер ряда'}
      groupBy={(r) => r.p.role} groupLabel={(key, n) => `${ROLE_GROUP[key as ForecastProduct['role']] ?? key} · ${num(n, 0)}`}
      defaultSort={sortBy === 'delta' ? { key: 'delta', dir: 'desc' } : { key: 'q', dir: 'desc' }} limit={limit}
      collapseAt={COLLAPSE} width={width ?? (withQuality ? 'full' : 'content')}
      caption={caption} tight loading={loading} empty={empty} className="fc-table" />
  )
}
