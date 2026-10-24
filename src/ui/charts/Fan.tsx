/**
 * Веер прогноза (UX-V2 §5.3, X2 «честная неопределённость»): история → «сейчас» → коридоры
 * «8 из 10 исходов» (P10–P90) и «5 из 10» (P25–P75), медиана, тренд (нейтральный пунктир),
 * окно проверки (нейтральная подложка) с ромбами факта проверки. Легенда называет каждый
 * нарисованный элемент словами (коды P10/P50 — только в таблице-двойнике, в скобках). Ось Y — ≥ 3
 * деления; `yDomain` — общая шкала малых кратных (иначе «своя шкала» подписывается): всё, что за
 * шкалой, обрезается рамкой плота, а выход за край отмечен «↑ до …» / «↓ до …». `refLines` —
 * подписанные пороги, `quality` warn/bad штрихует внешний коридор (доверять осторожно — пункт
 * легенды). Подпись «сейчас» на оси не пропадает никогда. Качество словами — у обёртки, не в svg.
 */
import { useCallback, useId, type ReactNode } from 'react'
import { ChartFrame, type ChartTable, type FrameVariant } from './ChartFrame'
import { Crosshair, Grid, Marker, XAxis, X_AXIS_H, YAxis } from './Axis'
import { ChartTooltip } from './Tooltip'
import { useHoverIndex, useMeasuredWidth } from './hooks'
import type { LegendItem } from './palette'
import { axisNum, bandPath, extent, linePath, svgId, yDomain as padDomain, yTicks, type XY } from './scale'
import { DASH } from '../../explain/format'

export interface FanSeries {
  p10: ReadonlyArray<number>
  p50: ReadonlyArray<number>
  p90: ReadonlyArray<number>
  p25?: ReadonlyArray<number>
  p75?: ReadonlyArray<number>
  trend?: ReadonlyArray<number>
  history?: ReadonlyArray<number>
}

/** Подписанный порог: горизонтальная пунктирная линия (в легенде и таблице-двойнике). */
export interface FanRefLine { key: string; value: number; label: string }

export interface FanProps {
  a: FanSeries
  /** Второй веер (сравнение сценариев) — вторым цветом. */
  b?: FanSeries | null
  fmt?: (v: number) => string
  /** Подпись смещения в месяцах: −12 → «−12 мес», 0 → «сейчас». */
  monthLabel?: (offset: number) => string
  /** Скрытые от модели последние точки истории (окно проверки) — ромбы факта и подложка. */
  backtestK?: number
  height?: number
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  ariaLabel?: string
  /** Имена вееров в легенде (нужны при сравнении). */
  nameA?: string
  nameB?: string
  className?: string
  compact?: boolean
  /** Скрыть легенду (малые кратные: одна общая легенда над сеткой). */
  showLegend?: boolean
  /** Общая шкала Y (малые кратные сравнимы); без неё — своя шкала. */
  yDomain?: readonly [number, number]
  /** Подпись «своя шкала» у графика с собственной шкалой в сетке с общей. */
  scaleNote?: string
  refLines?: ReadonlyArray<FanRefLine>
  /** Оговорка одной строкой под графиком («синтетическая история — демонстрация»). */
  caveat?: ReactNode
  /** Качество прогноза: warn/bad — внешняя полоса штрихуется. */
  quality?: 'ok' | 'warn' | 'bad'
  loading?: boolean
  /** multiple — карточка малых кратных (без «⋯»: двойник — общая таблица сетки); nested — вложенный. */
  variant?: FrameVariant
  /** Заголовок как главное действие карточки («Открыть веер»). */
  onTitleClick?: () => void
  titleActionLabel?: string
}

const PT = 14, PB = X_AXIS_H, PR = 12
/** Отступ отметки «за шкалой» от края плота, px. */
const OVER_INSET = 4

function minmax(s: FanSeries): [number, number] {
  return extent([...(s.history ?? []), ...s.p10, ...s.p90, ...(s.trend ?? [])])
}

/** ≥ 3 делений оси Y: если «красивых» вышло 2 — добавляется середина. */
export function fanTicks(lo: number, hi: number): number[] {
  const t = yTicks(lo, hi, 4)
  if (t.length >= 3) return t
  const [a, b] = [t[0] ?? lo, t[t.length - 1] ?? hi]
  return [a, (a + b) / 2, b]
}

const defaultLabel = (o: number) => (o === 0 ? 'сейчас' : o > 0 ? `+${o} мес` : `−${-o} мес`)

export function Fan({
  a, b, fmt = axisNum, monthLabel = defaultLabel, backtestK = 0, height = 200, title, subtitle, badges, actions, ariaLabel,
  nameA = 'прогноз', nameB = 'сценарий B', className, compact, showLegend = true, yDomain, scaleNote, refLines = [], caveat, quality = 'ok', loading,
  variant, onTitleClick, titleActionLabel,
}: FanProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const rid = useId()
  const hatchId = svgId(rid, 'fanhatch')
  const clipId = svgId(rid, 'fanclip')
  const hist = a.history ?? []
  const H = hist.length
  const N = a.p50.length - 1
  const fcStart = H > 0 ? H - 1 : 0
  const total = fcStart + N + 1
  const [loA, hiA] = minmax(a)
  const [loB, hiB] = b ? minmax(b) : [loA, hiA]
  const refVals = refLines.map((r) => r.value).filter(Number.isFinite)
  const [lo, hi] = yDomain ? [yDomain[0], yDomain[1]] : padDomain(Math.min(loA, loB, ...refVals), Math.max(hiA, hiB, ...refVals), false, 0.06)
  const ticks = fanTicks(lo, hi)
  const PL = Math.min(72, Math.max(34, 10 + ticks.reduce((m, t) => Math.max(m, fmt(t).length), 2) * 6.6))
  const plotW = Math.max(40, width - PL - PR)
  const plotH = Math.max(40, height - PT - PB)
  const X = useCallback((i: number) => PL + (i / Math.max(1, total - 1)) * plotW, [PL, total, plotW])
  const Y = (v: number) => PT + (1 - (v - lo) / (hi - lo || 1)) * plotH
  const fc = (arr: ReadonlyArray<number>): XY[] => arr.map((v, f) => ({ x: X(fcStart + f), y: Y(v) }))
  const nowX = X(fcStart)
  const hoverApi = useHoverIndex(total, X)
  const hover = hoverApi.hover
  const k = backtestK
  const hasBt = k > 0 && H > k
  const hatched = quality === 'warn' || quality === 'bad'

  const legend: LegendItem[] = fanLegend({
    hasHistory: H > 0, hasTrend: Boolean(a.trend), hasB: Boolean(b), nameA, nameB, hasInner: Boolean(a.p25 && a.p75),
    backtestK: hasBt ? k : 0, refLines, hatched,
  })
  // Общая шкала уже веера: марки обрезаны рамкой плота, выход за край — подписанной отметкой.
  const [dataLo, dataHi] = b ? [Math.min(loA, loB), Math.max(hiA, hiB)] : [loA, hiA]
  const over = yDomain && dataHi > hi + (hi - lo) * 1e-6 ? dataHi : null
  const under = yDomain && dataLo < lo - (hi - lo) * 1e-6 ? dataLo : null
  const rowLabel = (i: number) => monthLabel(i - fcStart)
  const axisLabels = Array.from({ length: total }, (_, i) => rowLabel(i))
  const axisTicks = [...new Set([...(H > 1 ? [0] : []), fcStart, total - 1])]
  const plotX1 = width - PR
  const atF = (arr: ReadonlyArray<number> | undefined, i: number) => (arr && i >= fcStart && i - fcStart < arr.length ? arr[i - fcStart] : NaN)
  const table: ChartTable = {
    columns: ['Месяц', 'Факт', 'Нижняя граница (P10)', 'Медиана (P50)', 'Верхняя граница (P90)', ...(a.trend ? ['Тренд'] : []), ...refLines.map((r) => r.label)],
    rows: Array.from({ length: total }, (_, i) => [
      rowLabel(i), i < H ? fmt(hist[i]) : DASH, f(atF(a.p10, i), fmt), f(atF(a.p50, i), fmt), f(atF(a.p90, i), fmt),
      ...(a.trend ? [f(atF(a.trend, i), fmt)] : []), ...refLines.map((r) => f(r.value, fmt)),
    ]),
  }
  const isEmpty = a.p50.length === 0
  const label = ariaLabel ?? `Веер: медиана через ${N} мес ${fmt(a.p50[N] ?? 0)}, 8 из 10 исходов — от ${fmt(a.p10[N] ?? 0)} до ${fmt(a.p90[N] ?? 0)}`
  const allBadges = scaleNote || badges ? <>{scaleNote && <span className="ch-scalenote">{scaleNote}</span>}{badges}</> : undefined

  return (
    <ChartFrame title={title} subtitle={subtitle} badges={allBadges} actions={actions} legend={showLegend ? legend : undefined} ariaLabel={label}
      table={isEmpty ? null : table} empty={isEmpty ? 'Нет прогноза' : undefined} className={className} compact={compact} loading={loading} skeletonHeight={height}
      variant={variant} onTitleClick={onTitleClick} titleActionLabel={titleActionLabel}>
      <div ref={ref} className="ch-plot" tabIndex={0} onPointerMove={hoverApi.onPointerMove} onPointerLeave={hoverApi.onPointerLeave}
        onKeyDown={hoverApi.onKeyDown} onBlur={hoverApi.onBlur}>
        <svg className="ch-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect className="ch-fan__hatch" x="0" y="0" width="1.5" height="6" />
            </pattern>
            <clipPath id={clipId}><rect x={PL} y={PT} width={Math.max(0, plotX1 - PL)} height={plotH} /></clipPath>
          </defs>
          <Grid ticks={ticks} yAt={Y} x0={PL} x1={width - PR} />
          <YAxis ticks={ticks} yAt={Y} x={PL - 8} fmt={fmt} />
          <rect className="ch-fan__future" x={nowX} y={PT} width={Math.max(0, width - PR - nowX)} height={plotH} />
          {hasBt && <rect className="ch-fan__bt" x={X(H - 1 - k)} y={PT} width={X(H - 1) - X(H - 1 - k)} height={plotH} />}
          <line className="ch-fan__now" x1={nowX} x2={nowX} y1={PT} y2={PT + plotH} />
          <g className="ch-fan__marks" clipPath={`url(#${clipId})`}>
          {b && <path className="ch-fan__band" fill="var(--chart-2)" d={bandPath(fc(b.p90), fc(b.p10))} />}
          <path className="ch-fan__band" fill="var(--chart-1)" d={bandPath(fc(a.p90), fc(a.p10))} />
          {hatched && <path className="ch-fan__band-hatch" fill={`url(#${hatchId})`} d={bandPath(fc(a.p90), fc(a.p10))} />}
          {a.p25 && a.p75 && <path className="ch-fan__band ch-fan__band--inner" fill="var(--chart-1)" d={bandPath(fc(a.p75), fc(a.p25))} />}
          {refLines.filter((r) => Number.isFinite(r.value)).map((r) => (
            <g key={r.key} className="ch-fan__ref">
              <line x1={PL} x2={width - PR} y1={Y(r.value)} y2={Y(r.value)} />
              <text className="ch-fan__reflabel" x={width - PR - 4} y={Y(r.value) - 4} textAnchor="end">{r.label}</text>
            </g>
          ))}
          {H > 0 && <path className="ch-fan__hist" d={linePath(hist.map((v, i) => ({ x: X(i), y: Y(v) })))} />}
          {hasBt && hist.slice(H - k).map((v, i) => (
            <path key={i} className="ch-fan__fact" d={`M ${X(H - k + i)} ${Y(v) - 4} l 4 4 l -4 4 l -4 -4 z`} />
          ))}
          {b && <path className="ch-line" stroke="var(--chart-2)" d={linePath(fc(b.p50))} />}
          <path className="ch-line" stroke="var(--chart-1)" d={linePath(fc(a.p50))} />
          {a.trend && <path className="ch-line ch-line--dashed ch-fan__trend" d={linePath(fc(a.trend))} />}
          </g>
          {over !== null && <text className="ch-fan__over" x={plotX1 - OVER_INSET} y={PT + 11} textAnchor="end">↑ до {fmt(over)}</text>}
          {under !== null && <text className="ch-fan__over" x={plotX1 - OVER_INSET} y={PT + plotH - OVER_INSET} textAnchor="end">↓ до {fmt(under)}</text>}
          {/* Ось месяцев: начало истории · «сейчас» · горизонт; «сейчас» не пропадает никогда — уступают крайние (placeXLabels). */}
          <XAxis labels={axisLabels} xAt={X} y={PT + plotH} x0={PL} x1={plotX1} tickIndices={axisTicks} keep={[fcStart]} />
          {hover != null && (
            <g>
              <Crosshair x={X(hover)} y0={PT} y1={PT + plotH} />
              {hover < H && <Marker x={X(hover)} y={Y(hist[hover])} color="var(--text)" />}
              {Number.isFinite(atF(a.p50, hover)) && <Marker x={X(hover)} y={Y(atF(a.p50, hover))} color="var(--chart-1)" />}
              <ChartTooltip x={X(hover)} y={PT} width={width} height={plotH} title={rowLabel(hover)} rows={[
                ...(hover < H ? [{ key: 'f', label: hasBt && hover >= H - k ? 'факт проверки' : 'факт', value: fmt(hist[hover]), color: 'var(--text)' }] : []),
                ...(Number.isFinite(atF(a.p50, hover)) ? [
                  { key: '90', label: 'верх коридора', value: fmt(atF(a.p90, hover)), color: 'var(--chart-1)' },
                  { key: '50', label: 'медиана', value: fmt(atF(a.p50, hover)), color: 'var(--chart-1)' },
                  { key: '10', label: 'низ коридора', value: fmt(atF(a.p10, hover)), color: 'var(--chart-1)' },
                ] : []),
                ...(a.trend && Number.isFinite(atF(a.trend, hover)) ? [{ key: 't', label: 'тренд', value: fmt(atF(a.trend, hover)), color: 'var(--text-secondary)' }] : []),
                ...(b && Number.isFinite(atF(b.p50, hover)) ? [{ key: 'b', label: `${nameB} · медиана`, value: fmt(atF(b.p50, hover)), color: 'var(--chart-2)' }] : []),
              ]} />
            </g>
          )}
        </svg>
      </div>
      {caveat && <p className="ch-caveat">{caveat}</p>}
    </ChartFrame>
  )
}

/**
 * Легенда веера — общая для карточки и для сетки малых кратных (одна над всеми); называет каждый
 * нарисованный элемент словами. `hatched` — хоть одна карточка заштрихована (качество warn/bad):
 * пункт «штриховка — коридору доверять осторожно».
 */
export function fanLegend({ hasHistory = true, hasTrend = false, hasB = false, nameA = 'прогноз', nameB = 'сценарий B', hasInner = false, backtestK = 0, refLines = [], hatched = false }: {
  hasHistory?: boolean; hasTrend?: boolean; hasB?: boolean; nameA?: string; nameB?: string; hasInner?: boolean; backtestK?: number; refLines?: ReadonlyArray<FanRefLine>; hatched?: boolean
}): LegendItem[] {
  const pre = hasB ? `${nameA} · ` : ''
  return [
    ...(hasHistory ? [{ key: 'hist', label: 'история (факт)', color: 'var(--text)', shape: 'line' as const }] : []),
    { key: 'p50', label: `${pre}медиана`, color: 'var(--chart-1)', shape: 'line' },
    ...(hasInner ? [{ key: 'inner', label: `${pre}коридор: 5 из 10 исходов`, color: 'var(--chart-1)', shape: 'band' as const, swatchClass: 'ch-sw-band-inner' }] : []),
    { key: 'band', label: `${pre}коридор: 8 из 10 исходов`, color: 'var(--chart-1)', shape: 'band' },
    ...(hatched ? [{ key: 'hatch', label: 'штриховка — коридору доверять осторожно', color: 'var(--chart-1)', shape: 'band' as const, swatchClass: 'ch-sw-hatch' }] : []),
    ...(hasTrend ? [{ key: 'trend', label: 'тренд', color: 'var(--text-secondary)', shape: 'line' as const, dashed: true }] : []),
    ...(backtestK > 0 ? [
      { key: 'fact', label: 'факт проверки', color: 'var(--text)', shape: 'dot' as const, swatchClass: 'ch-sw-fact' },
      { key: 'bt', label: `окно проверки ${backtestK} мес`, color: 'var(--chart-grid)', shape: 'rect' as const, swatchClass: 'ch-sw-bt' },
    ] : []),
    ...refLines.map((r) => ({ key: `ref-${r.key}`, label: r.label, color: 'var(--text-muted)', shape: 'line' as const, dashed: true })),
    ...(hasB ? [
      { key: 'b50', label: `${nameB} · медиана`, color: 'var(--chart-2)', shape: 'line' as const },
      { key: 'b', label: `${nameB} · коридор: 8 из 10 исходов`, color: 'var(--chart-2)', shape: 'band' as const },
    ] : []),
  ]
}

function f(v: number, fmt: (v: number) => string): string {
  return Number.isFinite(v) ? fmt(v) : DASH
}
