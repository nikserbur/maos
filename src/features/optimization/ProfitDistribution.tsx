/**
 * D2 «CVaR = среднее худших α» на живых данных (A6 §6) — `Histogram` chart-системы (X1 §4 п. 3):
 * гистограмма прибыли робастного портфеля, хвост худших α левее VaR — цвет ряда 4 + штриховка,
 * линия VaR с прямой подписью, маркеры E (●) и CVaR (●) на дорожке со скобкой E − CVaR,
 * квадрат «худший», пунктирный контур портфеля «макс. E» с подписью в легенде. Плашка
 * «худшие α» — подзаголовком вне плота; легенда — три пункта (хвост / E / CVaR).
 * Логика (optStore, расчёты) не тронута — только представление; числа те же (money/axisMoney/pct).
 */
import type { OptHistBin, OptMetrics } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { Histogram, axisMoney, type HistMarker, type LegendItem } from '../../ui/charts'

interface Props {
  histogram: OptHistBin[]
  /** Метрики робастного портфеля (E, VaR, CVaR, худший). */
  metrics: OptMetrics
  alpha: number
  samples: number
}

/** Доля прогонов, отрезаемая с каждого края окна (≈ p0,5…p99,5 по корзинам). */
const TAIL_CLIP = 0.005

/**
 * Окно оси X — собственный размах робастного распределения (корзины бэкенда общие с «макс. E»,
 * чей широкий разброс иначе сжимает главное в «иглу», X1 §4 «не ломать»): по корзинам обрезаем
 * по 0,5 % массы с краёв, всегда включаем марки VaR/CVaR/E/худший и добавляем по половине
 * корзины отступа. Сам контур «макс. E» за окном показывается отметкой у края.
 */
export function robustDomain(bins: ReadonlyArray<OptHistBin>, keep: ReadonlyArray<number>): [number, number] {
  const total = bins.reduce((s, b) => s + b.count, 0) || 1
  let first = 0
  for (let acc = 0; first < bins.length - 1; first++) { acc += bins[first].count; if (acc / total > TAIL_CLIP) break }
  let last = bins.length - 1
  for (let acc = 0; last > first; last--) { acc += bins[last].count; if (acc / total > TAIL_CLIP) break }
  const w = bins.length ? bins[0].x1 - bins[0].x0 : 1
  const lo = Math.min(bins[first]?.x0 ?? 0, ...keep) - w / 2
  const hi = Math.max(bins[last]?.x1 ?? 1, ...keep) + w / 2
  return [lo, hi]
}

const LEGEND: ReadonlyArray<LegendItem> = [
  { key: 'tail', label: 'хвост худших α', color: 'var(--chart-4)', shape: 'rect' },
  { key: 'e', label: 'E — среднее всех', color: 'var(--chart-1)', shape: 'dot' },
  { key: 'cvar', label: 'CVaR — среднее хвоста', color: 'var(--chart-4)', shape: 'dot' },
]

export function ProfitDistribution({ histogram, metrics, alpha, samples }: Props) {
  if (histogram.length === 0) return null
  const totalExp = histogram.reduce((s, b) => s + (b.count_expected ?? 0), 0) || 1
  const hasExp = histogram.some((b) => (b.count_expected ?? 0) > 0)
  const outline = hasExp ? { shares: histogram.map((b) => (b.count_expected ?? 0) / totalExp), label: 'портфель «макс. E»' } : undefined
  const gap = metrics.expected - metrics.cvar
  const inTail = (b: OptHistBin) => (b.x0 + b.x1) / 2 <= metrics.var

  const markers: HistMarker[] = [
    { key: 'var', x: metrics.var, label: `VaR = ${axisMoney(metrics.var)}`, kind: 'line' },
    { key: 'worst', x: metrics.worst_case, label: 'худший', kind: 'square', color: 'var(--status-down)' },
    { key: 'cvar', x: metrics.cvar, label: 'CVaR', kind: 'dot', color: 'var(--chart-4)' },
    { key: 'e', x: metrics.expected, label: 'E', kind: 'dot', color: 'var(--chart-1)' },
  ]
  const domain = robustDomain(histogram, [metrics.worst_case, metrics.cvar, metrics.var, metrics.expected])
  const legend = hasExp ? [...LEGEND, { key: 'maxe', label: 'портфель «макс. E»', color: 'var(--chart-2)', shape: 'line' as const, dashed: true }] : LEGEND

  const summary =
    `Распределение прибыли робастного портфеля по ${num(samples, 0)} сценариям. ` +
    `Ожидаемая прибыль ${money(metrics.expected)}, VaR ${money(metrics.var)}, CVaR худших ${pct(alpha, 0)} — ${money(metrics.cvar)}, ` +
    `худший сценарий ${money(metrics.worst_case)}.`

  return (
    <Histogram
      className="pd"
      bins={histogram}
      highlight={inTail}
      highlightLabel="хвост худших α"
      outline={outline}
      markers={markers}
      bracket={{ from: metrics.cvar, to: metrics.expected, label: `E − CVaR = ${axisMoney(gap)}` }}
      domain={domain}
      fmtX={axisMoney}
      height={300}
      subtitle={`худшие α = ${pct(alpha, 0)} — левее VaR · прибыль за горизонт, ₽ · N = ${num(samples, 0)}`}
      seriesLabel="устойчивый"
      legend={legend}
      tipRows={(i) => (inTail(histogram[i]) ? [{ key: 'tail', label: 'в хвосте худших α', value: '' }] : [])}
      ariaLabel={summary}
    />
  )
}
