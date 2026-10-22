/**
 * Граница Парето «доходность — риск» — `Scatter` chart-системы (X1 §4 п. 4): X — σ прибыли
 * (меньше — лучше), Y — E[Π]. Недоминируемые — линия фронта с 10 % заливкой; доминируемые —
 * приглушённые точки; выбранный робастный портфель — ▲ (ряд 2), портфель «макс. E» — ■ (ряд 4);
 * подписи «выбрано» / «макс. E» — с лидер-линией и отступом от правого края. Подсказка по точке.
 * Логика не тронута: те же кандидаты, те же числа (money/pct).
 */
import type { OptCandidate } from '../../lib/api'
import { money, pct } from '../../explain/format'
import { Scatter, axisMoney, type LegendItem, type ScatterPoint } from '../../ui/charts'

const LEGEND: ReadonlyArray<LegendItem> = [
  { key: 'front', label: 'граница Парето', color: 'var(--chart-1)', shape: 'line' },
  { key: 'dom', label: 'доминируемые', color: 'var(--chart-other)', shape: 'dot' },
  { key: 'robust', label: 'выбранный устойчивый', color: 'var(--chart-2)', swatchClass: 'pf-sw-tri' },
  { key: 'maxe', label: 'максимум ожидания', color: 'var(--chart-4)', swatchClass: 'pf-sw-sq' },
]

const kind = (c: OptCandidate) =>
  c.is_robust ? 'выбранный устойчивый' : c.is_expected ? 'максимум ожидания' : c.is_pareto ? 'на границе Парето' : 'доминируемый'

export function ParetoFrontier({ candidates }: { candidates: OptCandidate[] }) {
  if (candidates.length < 2) return null
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
        { key: 'e', label: 'E[Π]', value: money(c.expected) },
        { key: 's', label: 'σ', value: money(c.std) },
        { key: 'c', label: 'CVaR', value: money(c.cvar) },
        { key: 'w', label: 'худший', value: money(c.worst_case) },
        { key: 'p', label: 'P(убыток)', value: pct(c.p_loss) },
        ...(c.concentration != null ? [{ key: 'k', label: 'макс. доля', value: pct(c.concentration, 0) }] : []),
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
      yLabel="E[Π], ₽ ↑"
      height={300}
      frontArea
      legend={LEGEND}
      ariaLabel={`Граница Парето: ${nPareto} недоминируемых портфелей из ${candidates.length}; ось X — риск σ, ось Y — ожидаемая прибыль.`}
    />
  )
}
