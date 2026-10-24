/**
 * «Внешние условия» (владелец: «плитка инфляции — большое число и пустая карточка»): три равные
 * карточки-веера на chart-системе — ключевая ставка, инфляция в годовом выражении, курс ₽ за $.
 * Одна поверхность у карточки, график 200 px, ось — календарные месяцы от последнего наблюдения ЦБ,
 * в мета-строке — одно изменение к горизонту («−15,8 п. п. к окт. 2027»; «сейчас → конец» — в подсказке
 * и таблице-двойнике), под ним отдельной строкой — качество по отложенной проверке генератора (у «что
 * если» — «проверка относится к прогнозу, не к этому стрессу»). Оговорка «не прогноз» — один раз, в
 * мета-строке раздела, а не под каждым веером. Таблица и SVG — в меню «⋯» рамки. Нет данных —
 * «недоступно» простыми словами и «Повторить», сырой текст ошибки — под «Подробнее».
 */
import type { ForecastProduct, MacroHoldoutVar, MacroRegimes, MacroSummary } from '../../lib/api'
import { num, pct, pp } from '../../explain/format'
import { ChartFrame, Fan, Legend, fanLegend, type FanSeries } from '../../ui/charts'
import { Chip, EmptyState, errorDetail, errorText } from '../../ui/kit'
import { qualityMark } from './forecastModel'
import { addMonths, monthShort } from '../scenarios/monthText'
import type { MacroSampleState } from '../scenarios/useMacroSample'
import { anchorOf, fanFromPaths, historyTail, macroQuality, withHistory, type MacroKey } from './macroModel'
import { calendarLabel, moveText } from './monitorModel'
import './monitor.css'

/** Высота графика карточки, px. */
export const MACRO_FAN_H = 200

const pctFmt = (v: number) => pct(v / 100, 1)
const rubFmt = (v: number) => `${num(v, 1)} ₽`

interface Spec { key: MacroKey; title: string; fmt: (v: number) => string; holdout: 'key_pp' | 'cpi_yoy_pp' | 'usd_rub'; points: boolean }

const SPECS: readonly Spec[] = [
  { key: 'key', title: 'Ключевая ставка', fmt: pctFmt, holdout: 'key_pp', points: true },
  { key: 'cpi', title: 'Инфляция, % в год', fmt: pctFmt, holdout: 'cpi_yoy_pp', points: true },
  { key: 'fx', title: 'Курс доллара, ₽', fmt: rubFmt, holdout: 'usd_rub', points: false },
]

/**
 * Одно изменение медианы к горизонту для чипа: «−15,8 п. п. к окт. 2027» / «+4,4 % к окт. 2027»;
 * «сейчас → конец» — в подсказке чипа.
 */
function deltaChip(s: FanSeries, spec: Pick<Spec, 'fmt' | 'points'>, anchor: string | null): { text: string; title: string } | null {
  const now = s.p50[0]
  const end = s.p50[s.p50.length - 1]
  if (!Number.isFinite(now) || !Number.isFinite(end) || s.p50.length < 2) return null
  const d = spec.points ? pp((end - now) / 100, { signed: true, digits: 1 }) : now > 0 ? moveText(end / now - 1) : ''
  if (!d) return null
  const endMonth = anchor ? monthShort(addMonths(anchor, s.p50.length - 1)) : ''
  return {
    text: endMonth ? `${d} к ${endMonth}` : `${d} к концу горизонта`,
    title: `Медиана: сейчас ${spec.fmt(now)} → ${endMonth ? `в ${endMonth}` : 'к концу горизонта'} ${spec.fmt(end)}`,
  }
}

function Quality({ v, stress }: { v: MacroHoldoutVar | undefined; stress: boolean }) {
  const q = macroQuality(v)
  if (stress) return <span className="fc-q fc-q--none"><span>проверка генератора относится к прогнозу, не к этому стрессу</span></span>
  const m = qualityMark(q.level)
  return <span className={`fc-q fc-q--${q.level}`}><span className="fc-q__g" aria-hidden="true">{m.glyph}</span><span>{q.sentence}</span></span>
}

interface CardProps {
  spec: Spec
  series: FanSeries | null
  anchor: string | null
  holdout: MacroHoldoutVar | undefined
  loading: boolean
  error: unknown
  /** Считаем «что если»: качество генератора к стрессу не относится. */
  stress: boolean
  /** Повтор: у ставки — пересчёт прогноза, у инфляции и курса — повтор запроса путей генератора. */
  onRetry?: () => void
  onOpen?: () => void
}

function Unavailable({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  const raw = typeof error === 'string' ? error : errorDetail(error)
  return (
    <div className="mon-macro__empty fc-fan">
      <p className="ch-title">{title}</p>
      <EmptyState kind="unavailable" size="sm" quiet variant="chart" title="Генератор не ответил"
        action={onRetry ? <button type="button" className="btn btn--sm" onClick={onRetry}>Повторить</button> : undefined}>
        <p>{typeof error === 'string' ? 'Веер не построен — внешние условия без этого ряда.' : errorText(error, 'Веер не построен — повторите расчёт.')}</p>
        {raw && <details className="mon-macro__more"><summary>Подробнее</summary><pre className="mono">{raw}</pre></details>}
      </EmptyState>
    </div>
  )
}

function MacroCard({ spec, series, anchor, holdout, loading, error, stress, onRetry, onOpen }: CardProps) {
  if (!series || series.p50.length === 0) {
    if (error) return <Unavailable title={spec.title} error={error} onRetry={onRetry} />
    return (
      <ChartFrame title={spec.title} ariaLabel={`${spec.title}: считаем`} loading empty="Считаем веер" skeletonHeight={MACRO_FAN_H} className="fc-fan" variant="multiple" />
    )
  }
  const d = deltaChip(series, spec, anchor)
  const q = macroQuality(holdout)
  const hatch = !stress && (q.level === 'bad' || q.level === 'warn')
  return (
    <Fan a={series} fmt={spec.fmt} monthLabel={calendarLabel(anchor)} height={MACRO_FAN_H} title={spec.title}
      subtitle={<Quality v={holdout} stress={stress} />} quality={hatch ? (q.level === 'bad' ? 'bad' : 'warn') : 'ok'}
      badges={d ? <Chip size="sm" title={d.title}>{d.text}</Chip> : undefined}
      showLegend={false} className="fc-fan" loading={loading}
      onTitleClick={onOpen} titleActionLabel={onOpen ? 'Открыть веер' : undefined} />
  )
}

interface MacroFansProps {
  rate: ForecastProduct | null
  /** Почему нет веера ставки (сырой текст — «Подробнее»). */
  rateError: string | null
  /** Прогноз ещё считается (первый раз). */
  ratePending: boolean
  refetching: boolean
  sample: MacroSampleState
  summary: MacroSummary | null
  /** История рядов ЦБ (паспорт генератора) — 24 мес до опоры на каждой карточке. */
  history: MacroRegimes['history'] | undefined
  anchor: string | null
  /** Имя условий «что если» («Как 2022»); прогноз — null. Оговорка «не прогноз» — в мета-строке раздела. */
  stress: string | null
  onRetry: () => void
  onOpenRate?: (p: ForecastProduct) => void
}

export function MacroFans({ rate, rateError, ratePending, refetching, sample, summary, history, anchor, stress, onRetry, onOpenRate }: MacroFansProps) {
  const vars = summary?.holdout?.variables
  const fromSample = (key: MacroKey): FanSeries | null => (sample.sample ? fanFromPaths(sample.sample.paths, key, anchorOf(sample.sample, key)) : null)
  const sampleError = sample.status === 'error' ? sample.error || 'генератор не ответил' : null
  return (
    <div className="mon-macro">
      <Legend className="fc-legend" items={fanLegend({ hasHistory: Boolean(rate?.history?.length || history) })} />
      <div className="mon-macro__grid">
        {SPECS.map((spec) => {
          const isRate = spec.key === 'key'
          const raw: FanSeries | null = isRate ? rate : fromSample(spec.key)
          const series = raw && raw.p50.length ? withHistory(raw, historyTail(history, spec.key, anchor)) : raw
          const error = isRate ? (rate ? null : ratePending ? null : rateError ?? 'нет ответа генератора') : sampleError
          return (
            <MacroCard key={spec.key} spec={spec} series={series} anchor={anchor} holdout={vars?.[spec.holdout]} stress={stress !== null}
              loading={isRate ? refetching : sample.status === 'loading' && Boolean(sample.sample)} error={error} onRetry={isRate ? onRetry : sample.retry}
              onOpen={isRate && rate && onOpenRate ? () => onOpenRate(rate) : undefined} />
          )
        })}
      </div>
    </div>
  )
}
