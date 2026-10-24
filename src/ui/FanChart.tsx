/**
 * Веер прогноза экранов «Сценарии»/«Мониторинг» (UX-V2 §5.3, X2) — обёртка над `Fan` chart-системы:
 * качество прогноза — одной строкой простыми словами под заголовком («точнее наивного прогноза на
 * 12 %; 8 из 10 исходов накрыли 7 фактов из 10 при норме 8»), мера (CRPS) — в «i». Хуже наивного —
 * ▲ и штриховка внешней полосы. Контракт `FanSeries`/`FanQuality` сохранён для ForecastTab.
 */
import type { ReactNode } from 'react'
import { Fan, type FanRefLine, type FanSeries } from './charts'
import { InfoTip } from './InfoTip'
import { pct } from '../explain/format'
import './fields.css'

export type { FanSeries }

export interface FanQuality {
  /** skill ∈ [0, 1]: доля ошибки, снятой относительно наивного; < 0 — хуже наивного. */
  skill?: number | null
  crps?: number | null
  /** Подпись меры: «CRPS» или «прокси (пинбол P10/P90)». */
  crpsLabel?: string
  coverage80?: number | null
  /** Сколько последних точек истории скрыто от модели (окно проверки). */
  backtestK?: number
  /** Состояние: ok — лучше наивного, warn — хуже, none — нет проверки. */
  status: 'ok' | 'warn' | 'none'
  /** Готовая фраза качества от экрана (приоритетнее собранной здесь). */
  sentence?: string
  info?: string
  infoValues?: Readonly<Record<string, number | string | null | undefined>>
}

interface FanChartProps {
  a: FanSeries
  b?: FanSeries | null
  monthLabel?: (offset: number) => string
  fmt?: (v: number) => string
  quality?: FanQuality
  title?: ReactNode
  badges?: ReactNode
  height?: number
  nameA?: string
  nameB?: string
  /** Скрыть легенду — у сетки малых кратных одна общая легенда. */
  showLegend?: boolean
  /** Общая шкала Y малых кратных и пометка «своя шкала». */
  yDomain?: readonly [number, number]
  scaleNote?: string
  refLines?: ReadonlyArray<FanRefLine>
  caveat?: ReactNode
}

/** Качество словами: модель против наивного прогноза и покрытие интервала против номинала. */
export function qualitySentence(q: FanQuality): string {
  if (q.sentence) return q.sentence
  const parts: string[] = []
  if (q.skill != null && Number.isFinite(q.skill)) {
    parts.push(q.skill >= 0 ? `точнее наивного прогноза на ${pct(q.skill, 0)}` : `хуже наивного прогноза на ${pct(-q.skill, 0)}`)
  }
  if (q.coverage80 != null && Number.isFinite(q.coverage80)) {
    parts.push(`полоса «8 из 10 исходов» накрыла ${pct(q.coverage80, 0)} фактов при норме 80 %`)
  }
  return parts.length ? parts.join('; ') : 'качество не проверено'
}

/** Строка качества: ▲ только у отклонения + фраза + «i» (мера CRPS и формулы — там). */
export function QualityLine({ q }: { q: FanQuality; fmtCrps?: (v: number) => string }) {
  const warn = q.status === 'warn'
  return (
    <span className={`pf-quality is-${q.status}`}>
      {warn && <span className="glyph-setup" aria-hidden="true" />}
      <span>{warn ? `Внимание: ${qualitySentence(q)}` : qualitySentence(q)}</span>
      {q.info && <InfoTip id={q.info} values={{ ...q.infoValues, crps: q.crps ?? q.infoValues?.crps }} />}
    </span>
  )
}

export function FanChart({ a, b, monthLabel, fmt, quality, title, badges, height = 200, nameA, nameB, showLegend = true, yDomain, scaleNote, refLines, caveat }: FanChartProps) {
  return (
    <Fan
      a={a}
      b={b}
      fmt={fmt}
      monthLabel={monthLabel}
      backtestK={quality?.backtestK ?? 0}
      height={height}
      title={title}
      subtitle={quality && quality.status !== 'none' ? <QualityLine q={quality} /> : undefined}
      badges={badges}
      nameA={nameA}
      nameB={nameB}
      showLegend={showLegend}
      yDomain={yDomain}
      scaleNote={scaleNote}
      refLines={refLines}
      caveat={caveat}
      quality={quality?.status === 'warn' ? 'warn' : 'ok'}
      className="pf-fan"
    />
  )
}
