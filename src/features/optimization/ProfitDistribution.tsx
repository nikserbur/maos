/**
 * D2 «CVaR = среднее худших α» на живых данных (A6 §6) — `Histogram` chart-системы:
 * заголовок-утверждение («В 1 из 10 сценариев прибыль ниже −47 млн ₽»), гистограмма прибыли
 * устойчивого портфеля на его собственных корзинах (`histogram_robust`, если сервер их прислал —
 * иначе общие корзины с окном по массе), хвост худших α — цвет ряда 4 + штриховка. Не больше трёх
 * аннотаций: линия VaR, скобка E − CVaR (её концы подписаны «E» и «CVaR» прямо на дорожке) и
 * квадрат «худший». Портфель «макс. E» на общих корзинах — пунктирный контур нейтрального тона;
 * на собственных корзинах — одна фраза о его разбросе в подзаголовке. Показатели не меняются.
 */
import type { OptHistBin } from '../../lib/api'
import { joinRange, money, num, pct } from '../../explain/format'
import { Histogram, type HistMarker, type LegendItem } from '../../ui/charts'
import { histogramTitle } from './optText'
import type { OptResultExt } from './optTypes'

/** Доля прогонов, отрезаемая с каждого края окна (≈ p0,5…p99,5 по корзинам). */
const TAIL_CLIP = 0.005

/**
 * Окно оси X — собственный размах устойчивого распределения: по корзинам обрезаем по 0,5 % массы
 * с краёв, всегда включаем марки VaR/CVaR/E/худший и добавляем по половине корзины отступа.
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

/** Корзины для показа: собственные корзины устойчивого портфеля, если есть, иначе общие. */
export function displayBins(r: Pick<OptResultExt, 'histogram' | 'histogram_robust'>): { bins: OptHistBin[]; own: boolean } {
  const own = r.histogram_robust?.length ? r.histogram_robust : null
  return own ? { bins: own, own: true } : { bins: r.histogram, own: false }
}

export function ProfitDistribution({ result }: { result: OptResultExt }) {
  const { bins, own } = displayBins(result)
  if (bins.length === 0) return null
  const metrics = result.robust.metrics
  const maxE = result.expected.metrics
  const alpha = result.alpha
  const tailLabel = `хвост худших ${pct(alpha, 0)}`
  const totalExp = bins.reduce((s, b) => s + (b.count_expected ?? 0), 0) || 1
  const hasOutline = !own && bins.some((b) => (b.count_expected ?? 0) > 0)
  const outline = hasOutline ? { shares: bins.map((b) => (b.count_expected ?? 0) / totalExp), label: 'портфель «макс. E»' } : undefined
  const inTail = (b: OptHistBin) => (b.x0 + b.x1) / 2 <= metrics.var

  const markers: HistMarker[] = [
    { key: 'var', x: metrics.var, label: 'VaR', kind: 'line' },
    { key: 'worst', x: metrics.worst_case, label: 'худший', kind: 'square', color: 'var(--chart-4)' },
    { key: 'cvar', x: metrics.cvar, label: 'CVaR', kind: 'dot', color: 'var(--chart-4)' },
    { key: 'e', x: metrics.expected, label: 'E', kind: 'dot', color: 'var(--chart-1)' },
  ]
  const domain = robustDomain(bins, [metrics.worst_case, metrics.cvar, metrics.var, metrics.expected])
  const legend: LegendItem[] = [
    { key: 'tail', label: tailLabel, color: 'var(--chart-4)', shape: 'rect' },
    ...(outline ? [{ key: 'maxe', label: 'портфель «макс. E»', color: 'var(--text-secondary)', shape: 'line' as const, dashed: true }] : []),
  ]
  const months = result.horizon_hours / 720
  const maxESpread = own ? ` · у «макс. E» разброс ${joinRange(money(maxE.worst_case), money(maxE.best))}` : ''
  const subtitle = `прибыль за ${num(months, 0)} мес · N = ${num(result.samples, 0)}${maxESpread}`

  const summary =
    `Распределение прибыли устойчивого портфеля по ${num(result.samples, 0)} сценариям. ` +
    `Ожидаемая прибыль ${money(metrics.expected)}, VaR ${money(metrics.var)}, CVaR худших ${pct(alpha, 0)} — ${money(metrics.cvar)}, ` +
    `худший сценарий ${money(metrics.worst_case)}.`

  return (
    <Histogram
      className="pd"
      bins={bins}
      highlight={inTail}
      highlightLabel={tailLabel}
      outline={outline}
      markers={markers}
      bracket={{ from: metrics.cvar, to: metrics.expected, label: `E − CVaR = ${money(metrics.expected - metrics.cvar)}` }}
      domain={domain}
      fmtX={money}
      height={300}
      title={histogramTitle(alpha, metrics.var)}
      subtitle={subtitle}
      seriesLabel="доля сценариев"
      legend={legend}
      tipRows={(i) => (inTail(bins[i]) ? [{ key: 'tail', label: `в хвосте худших ${pct(alpha, 0)}`, value: '' }] : [])}
      ariaLabel={summary}
    />
  )
}
