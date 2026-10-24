/**
 * Граница Парето «доходность — риск» — `Scatter` chart-системы: X — σ прибыли (меньше — лучше),
 * Y — ожидаемая прибыль E. Недоминируемые — линия фронта (--chart-1) с 10 % заливкой; доминируемые —
 * приглушённые точки; выбранный устойчивый портфель — ▲ охрой (--chart-2, единственная охра графика),
 * портфель «макс. E» — нейтральный ■ (--chart-other), как контур в гистограмме. Подсказка по точке —
 * те же подписи показателей, что в карточках (kpiLabels). Кандидаты и числа не меняются.
 */
import type { OptCandidate } from '../../lib/api'
import { money, pct } from '../../explain/format'
import { Scatter, axisMoney, type LegendItem, type ScatterPoint } from '../../ui/charts'
import { kpiLabels } from './optTypes'

const LEGEND: ReadonlyArray<LegendItem> = [
  { key: 'front', label: 'граница Парето', color: 'var(--chart-1)', shape: 'line' },
  { key: 'dom', label: 'доминируемые', color: 'var(--chart-other)', shape: 'dot' },
  { key: 'robust', label: 'выбранный устойчивый', color: 'var(--chart-2)', swatchClass: 'pf-sw-tri' },
  { key: 'maxe', label: 'максимум ожидания', color: 'var(--chart-other)', swatchClass: 'pf-sw-sq' },
]

const kind = (c: OptCandidate) =>
  c.is_robust ? 'выбранный устойчивый' : c.is_expected ? 'максимум ожидания' : c.is_pareto ? 'на границе Парето' : 'доминируемый'

export function ParetoFrontier({ candidates, alpha }: { candidates: OptCandidate[]; alpha: number }) {
  if (candidates.length < 2) return null
  const L = kpiLabels(alpha)
  const nPareto = candidates.filter((c) => c.is_pareto).length
  const points: ScatterPoint[] = candidates.map((c, i) => {
    const maxE = c.is_expected && !c.is_robust
    return {
      key: String(i),
      x: c.std,
      y: c.expected,
      onFront: Boolean(c.is_pareto),
      emphasis: c.is_robust ? 'selected' : maxE ? 'alt' : c.is_pareto ? 'primary' : 'muted',
      shape: c.is_robust ? 'triangle' : maxE ? 'square' : 'dot',
      label: c.is_robust ? 'выбрано' : maxE ? 'макс. E' : undefined,
      tipTitle: kind(c),
      tip: [
        { key: 'e', label: L.expected, value: money(c.expected) },
        { key: 's', label: L.std, value: money(c.std) },
        { key: 'c', label: L.cvar, value: money(c.cvar) },
        { key: 'w', label: L.worst, value: money(c.worst_case) },
        { key: 'p', label: L.p_loss, value: pct(c.p_loss) },
        ...(c.concentration != null ? [{ key: 'k', label: L.share, value: pct(c.concentration, 0) }] : []),
      ],
    }
  })
  return (
    <Scatter
      className="pf"
      points={points}
      fmtX={axisMoney}
      fmtY={axisMoney}
      xLabel="риск σ прибыли, ₽ →"
      yLabel="ожидаемая прибыль E, ₽ ↑"
      height={300}
      frontArea
      legend={LEGEND}
      ariaLabel={`Граница Парето: ${nPareto} недоминируемых портфелей из ${candidates.length}; ось X — риск σ, ось Y — ожидаемая прибыль E.`}
    />
  )
}
