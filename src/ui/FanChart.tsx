/**
 * Веер прогноза экранов «Сценарии»/«Мониторинг» (UX-V2 §5.3) — обёртка над `Fan` chart-системы:
 * качество прогноза «CRPS · skill · покрытие» выводится строкой под заголовком (не плашкой внутри
 * svg), бейджи — в шапке рамки, высота ≥ 200 px, ось дат и значений, ромбы факта бэктеста.
 * Контракт `FanSeries`/`FanQuality` сохранён для ForecastTab.
 */
import type { ReactNode } from 'react'
import { Fan, type FanSeries } from './charts'
import { InfoTip } from './InfoTip'
import { money, pct } from '../explain/format'
import './fields.css'

export type { FanSeries }

export interface FanQuality {
  /** skill ∈ [0, 1]: доля ошибки, снятой относительно наивного; < 0 — хуже наивного. */
  skill?: number | null
  crps?: number | null
  /** Подпись меры: «CRPS» или «прокси (пинбол P10/P90)». */
  crpsLabel?: string
  coverage80?: number | null
  /** Сколько последних точек истории скрыто от модели (бэктест). */
  backtestK?: number
  /** Состояние: ok — лучше наивного, warn — хуже, none — нет проверки. */
  status: 'ok' | 'warn' | 'none'
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
}

/** Строка качества: глиф состояния + «прокси CRPS 6,7 тыс. ₽ · skill −50 % · покрытие 67 %» + «i». */
export function QualityLine({ q, fmtCrps = money }: { q: FanQuality; fmtCrps?: (v: number) => string }) {
  const glyph = q.status === 'ok' ? 'glyph-running' : q.status === 'warn' ? 'glyph-setup' : 'glyph-idle'
  return (
    <span className={`pf-quality is-${q.status}`}>
      <span className={glyph} aria-hidden="true" />
      <span className="num">
        {q.crps != null && `${q.crpsLabel ?? 'CRPS'} ${fmtCrps(q.crps)} · `}
        {q.skill != null ? `skill ${pct(q.skill, 0)}` : 'без проверки'}
        {q.coverage80 != null && ` · покрытие ${pct(q.coverage80, 0)}`}
      </span>
      {q.info && <InfoTip id={q.info} values={q.infoValues} />}
    </span>
  )
}

export function FanChart({ a, b, monthLabel, fmt, quality, title, badges, height = 200, nameA, nameB, showLegend = true }: FanChartProps) {
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
      className="pf-fan"
    />
  )
}
