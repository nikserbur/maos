/**
 * Общие части прогноза («Сценарии › Прогноз цен» и «Мониторинг»):
 *  - `ForecastFan` — веер на chart-системе (`Fan`): качество словами под заголовком (▲ у отклонения,
 *    ● у нормы — без цвета), штриховка внешней полосы у ненадёжного веера, Δ от «сейчас» в мета-строке;
 *    заголовок — главное действие карточки («Открыть веер»), таблица и SVG — в меню «⋯» рамки;
 *  - `ForecastGrid` — «Требуют внимания»: малые кратные в индексе «сейчас = 100» на общей шкале;
 *  - `ForecastTable` (ForecastTable.tsx) — ряды таблицей кита: имя полностью в 2 строки, помещается по ширине.
 */
import { useMemo } from 'react'
import type { ForecastProduct } from '../../lib/api'
import { num } from '../../explain/format'
import { Fan, Legend, fanLegend } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { Chip } from '../../ui/kit'
import { addMonths, monthShort } from '../scenarios/monthText'
import {
  baseRefLine, fmtFor, forecastDelta, indexTo100, monthLabel, qualityMark, qualityOf, sharedDomain, type ForecastDelta, type SeriesQuality,
} from './forecastModel'
import { calendarLabel } from './monitorModel'
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
  /** Карточка малых кратных: без встроенных действий (двойник — общая таблица сетки). */
  variant?: 'default' | 'multiple'
  className?: string
  /** Месяц «сейчас» (`YYYY-MM`): ось в календарных месяцах, чип — «медиана +25 % к окт. 2027». */
  anchor?: string | null
  /** Заголовок карточки; null — без заголовка (панель веера, где имя уже в шапке панели). */
  title?: string | null
}

/** Чип изменения медианы со словами: «медиана +25 % к окт. 2027» (без опоры — «к горизонту»). */
export function deltaChipText(d: ForecastDelta, anchor?: string | null): string {
  const when = anchor ? monthShort(addMonths(anchor, d.horizon)) : ''
  return `медиана ${d.text} ${when ? `к ${when}` : 'к горизонту'}`
}

export function ForecastFan({ p, height = 180, indexed = false, yDomain, showLegend = false, onOpen, caveat, variant, className = 'fc-fan', anchor, title }: FanProps) {
  const q = qualityOf(p)
  const d = forecastDelta(p)
  const series = indexed ? indexTo100(p) : p
  const ref = indexed ? null : baseRefLine(p)
  const fmt = indexed ? (v: number) => num(v, 0) : fmtFor(p)
  return (
    <Fan a={series} fmt={fmt} monthLabel={anchor ? calendarLabel(anchor) : monthLabel} backtestK={q.backtestK} height={height}
      title={title === null ? undefined : (title ?? p.name)}
      subtitle={<QualityNote q={q} />} quality={q.level === 'bad' ? 'bad' : q.level === 'warn' ? 'warn' : 'ok'}
      badges={d ? <Chip size="sm" title={d.label}>{deltaChipText(d, anchor)}</Chip> : undefined} yDomain={yDomain}
      refLines={ref ? [ref] : []} showLegend={showLegend} caveat={caveat} className={className} variant={variant}
      onTitleClick={onOpen ? () => onOpen(p) : undefined} titleActionLabel={onOpen ? 'Открыть веер' : undefined} />
  )
}

/** «Требуют внимания»: веера в индексе «сейчас = 100» на одной шкале и одна легенда над сеткой. */
export function ForecastGrid({ products, onOpen, anchor }: { products: readonly ForecastProduct[]; onOpen: (p: ForecastProduct) => void; anchor?: string | null }) {
  const domain = useMemo(() => sharedDomain(products.map(indexTo100)), [products])
  if (products.length === 0) return null
  const hasHistory = products.some((p) => (p.history?.length ?? 0) > 0)
  const hasTrend = products.some((p) => Boolean(p.trend))
  const k = qualityOf(products[0]).backtestK
  return (
    <div className="fc-grid-wrap">
      <Legend className="fc-legend" items={fanLegend({ hasHistory, hasTrend, backtestK: k })} />
      <p className="fc-scale fc-muted">Индекс: «сейчас» = 100, шкала общая — веера сравнимы по ширине и наклону; полоса выше шкалы подписана «↑ до …».</p>
      <div className="fc-grid">
        {products.map((p) => <ForecastFan key={p.id} p={p} indexed yDomain={domain} onOpen={onOpen} variant="multiple" anchor={anchor} />)}
      </div>
    </div>
  )
}

/* ── Таблица рядов — ForecastTable.tsx (кит DataTable); экспорт здесь — для прежних импортов. ── */
export { ForecastTable } from './ForecastTable'
