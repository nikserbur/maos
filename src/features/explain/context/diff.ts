/**
 * Разности между двумя прогонами портфеля (METHODOLOGY-V2 §9 (в)): «текущий − прогон сравнения» по
 * метрикам робастного портфеля. Разность считает код, а не LLM: модель только пересказывает узлы
 * `diff.*` и ссылается на них. Прогоны с разными α или N помечаются — сравнение по хвосту тогда условно.
 */
import { isSoft, type OptResultExt } from '../../optimization/optTypes'
import type { OptMetrics } from '../../../lib/api'
import type { FactNode } from './facts'
import { compactValues, ctxValue } from './values'

interface MetricDef { key: keyof OptMetrics; title: string; mapNode: string; unit: '₽' | '%' }

const METRICS: readonly MetricDef[] = [
  { key: 'expected', title: 'E[прибыли]', mapNode: 'dec.portfolio.f.expected', unit: '₽' },
  { key: 'cvar', title: 'CVaR прибыли', mapNode: 'crit.profit.f.cvar', unit: '₽' },
  { key: 'var', title: 'VaR прибыли', mapNode: 'crit.profit.f.var', unit: '₽' },
  { key: 'worst_case', title: 'Худший сценарий', mapNode: 'crit.profit.f.worst', unit: '₽' },
  { key: 'std', title: 'σ прибыли', mapNode: 'crit.profit.f.sigma', unit: '₽' },
  { key: 'p_loss', title: 'P(убытка)', mapNode: 'crit.profit.f.p_loss', unit: '%' },
  { key: 'max_regret', title: 'Максимальное сожаление', mapNode: 'crit.profit.f.max_regret', unit: '₽' },
]

const runLabel = (r: OptResultExt): string => `${r.scenario_name || r.scenario_id}${r.run_id ? ` · прогон ${r.run_id.slice(0, 8)}` : ''}`

/** Узлы `diff.*`: заголовок сравнения + по узлу на метрику. Пусто, если один из прогонов без результата. */
export function diffRuns(current: OptResultExt | null | undefined, compare: OptResultExt | null | undefined): FactNode[] {
  if (!current || !compare || isSoft(current) || isSoft(compare)) return []
  const sameTail = current.alpha === compare.alpha && current.samples === compare.samples
  const head: FactNode = {
    id: 'diff.runs', title: 'Сравнение прогонов портфеля', kind: 'diff', block: 'criteria', mapNode: 'crit.profit', parent: 'crit.profit',
    status: 'расчёт',
    values: compactValues([
      ctxValue('current', 'Текущий прогон', runLabel(current)),
      ctxValue('compare', 'Прогон сравнения', runLabel(compare)),
      ctxValue('alpha_a', 'α текущего', current.alpha, '%'),
      ctxValue('alpha_b', 'α сравнения', compare.alpha, '%'),
      ctxValue('n_a', 'Сценариев в текущем', current.samples),
      ctxValue('n_b', 'Сценариев в сравнении', compare.samples),
      ctxValue('objective_a', 'Критерий текущего', current.objective),
      ctxValue('objective_b', 'Критерий сравнения', compare.objective),
    ]),
    note: sameTail ? 'Одинаковые α и N.' : 'Разные α или N: разности хвостовых метрик условны.',
  }
  const rows = METRICS.map((m): FactNode | null => {
    const a = current.robust.metrics[m.key]
    const b = compare.robust.metrics[m.key]
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    const delta = a - b
    const values = compactValues([
      ctxValue('current', `${m.title}: текущий прогон`, a, m.unit),
      ctxValue('compare', `${m.title}: прогон сравнения`, b, m.unit),
      ctxValue('delta', `${m.title}: разность (текущий − сравнение)`, delta, m.unit),
      m.unit === '₽' && b !== 0 ? ctxValue('rel', `${m.title}: относительная разность к |сравнению|`, delta / Math.abs(b), '%') : null,
    ])
    return { id: `diff.opt.${m.key}`, title: `Разность: ${m.title}`, kind: 'diff', block: 'criteria', mapNode: m.mapNode, parent: 'diff.runs', status: 'расчёт', values }
  })
  return [head, ...rows.filter((r): r is FactNode => r !== null)]
}
