/**
 * Чистая логика «Аналитики»: загрузка по типам РЦ с учётом труда и правила
 * рекомендаций (analytics.bottleneck_rank, analytics.labor_constraint,
 * analytics.recommendations в src/explain/metrics.analytics.ts).
 */
import type { KpiBundle, Machine, SimResults, WorkCenterType, Worker } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { isEligible } from '../nsi/labor'
import { kpiDef, kpiField, type KpiContext } from './kpiCatalog'
import { LOAD_THRESHOLDS } from './thresholds'

export { LOAD_THRESHOLDS, LOAD_MARK, loadLevel, type LoadLevel } from './thresholds'

/** Загрузка типа + труд: реальный параллелизм = min(станки, операторы). */
export interface TypeLoad {
  typeId: string
  name: string
  machines: number
  operators: number
  /** Средняя загрузка станков типа (0..1) из /simulation/results. */
  utilization: number
  /** Операторов меньше станков → упор в труд. */
  laborBound: boolean
}

/** Загрузка по типам РЦ из per_machine + число допущенных операторов; по убыванию загрузки. */
export function computeTypeLoads(
  res: SimResults | null,
  machines: readonly Machine[],
  workers: readonly Worker[],
  wcTypes: readonly WorkCenterType[],
): TypeLoad[] {
  if (!res || !Array.isArray(res.per_machine)) return []
  const mType = new Map(machines.map((m) => [m.id, m.wc_type_id]))
  const agg = new Map<string, { sum: number; n: number }>()
  for (const pm of res.per_machine) {
    const t = mType.get(pm.machine_id)
    if (!t) continue
    const a = agg.get(t) ?? { sum: 0, n: 0 }
    agg.set(t, { sum: a.sum + pm.utilization, n: a.n + 1 })
  }
  const out: TypeLoad[] = []
  for (const t of wcTypes) {
    const machCount = machines.filter((m) => m.wc_type_id === t.id).length
    if (machCount === 0) continue
    const ops = workers.filter((w) => isEligible(w.skills, t.name, t.id)).length
    const a = agg.get(t.id)
    out.push({
      typeId: t.id, name: t.name, machines: machCount, operators: ops,
      utilization: a && a.n ? a.sum / a.n : 0,
      laborBound: ops < machCount,
    })
  }
  return out.sort((x, y) => y.utilization - x.utilization)
}

/** Пороги правил (экспертные — см. caveat analytics.recommendations); узкое место — общий порог загрузки «внимание». */
export const REC_THRESHOLDS = { bottleneck: LOAD_THRESHOLDS.warn, laborUtil: 0.6, otd: 0.9, wait: 0.5, setup: 0.2 } as const

export type RecKind = 'bottleneck' | 'labor' | 'otd' | 'wait' | 'setup'

export interface Recommendation {
  kind: RecKind
  text: string
  /** Тип РЦ для перехода к инвестпроекту. */
  wct?: string
}

const pct0 = (v: number) => pct(v, 0)

/** Значения для подстановки в формулу «i» рекомендаций. */
export function recommendationValues(b: KpiBundle, ctx?: KpiContext) {
  const setup = kpiDef('SETUP_SHARE')
  return {
    bn_util: b.bottleneck?.utilization ?? null,
    otd: kpiField(b, 'otd'),
    wait: kpiField(b, 'wait_share'),
    setup: setup ? setup.value(b, ctx) : Number.NaN,
  }
}

/** Правила поддержки решений: что вышло за пороги и что делать (с количественным обоснованием). */
export function buildRecommendations(b: KpiBundle, loads: readonly TypeLoad[], ctx?: KpiContext): Recommendation[] {
  const recs: Recommendation[] = []
  const bnU = Number(b.bottleneck?.utilization ?? 0)
  if (bnU >= REC_THRESHOLDS.bottleneck && b.bottleneck?.wc_type_id) {
    recs.push({
      kind: 'bottleneck', wct: b.bottleneck.wc_type_id,
      text: `Узкое место «${b.bottleneck.wc_name ?? b.bottleneck.wc_type_id}» загружено на ${pct0(bnU)} — оцените докупку оборудования (инвестпроект).`,
    })
  }
  for (const l of loads.filter((x) => x.laborBound && x.utilization >= REC_THRESHOLDS.laborUtil).slice(0, 2)) {
    recs.push({
      kind: 'labor',
      text: `На «${l.name}» операторов (${num(l.operators, 0)}) меньше станков (${num(l.machines, 0)}) при загрузке ${pct0(l.utilization)} — добавьте допуски или рабочих, иначе станки простаивают.`,
    })
  }
  const otd = kpiField(b, 'otd')
  if (Number.isFinite(otd) && otd < REC_THRESHOLDS.otd) {
    const nLate = kpiField(b, 'n_late')
    recs.push({
      kind: 'otd',
      text: `OTD ${pct0(otd)} — просрочено заказов: ${num(nLate, 0)}; смягчите сроки или снимите узкое место.`,
    })
  }
  const wait = kpiField(b, 'wait_share')
  if (Number.isFinite(wait) && wait > REC_THRESHOLDS.wait) {
    recs.push({
      kind: 'wait',
      text: `Доля ожидания ${pct0(wait)} — поток сдерживается ограничением, разгрузка узкого места сократит время потока.`,
    })
  }
  // B8: доля переналадок — к Σ календарного фонда станков (kpi.setup_share), а не к длине расписания.
  const setup = recommendationValues(b, ctx).setup
  if (Number.isFinite(setup) && setup > REC_THRESHOLDS.setup) {
    recs.push({
      kind: 'setup',
      text: `Переналадки занимают ${pct0(setup)} фонда времени станков — группируйте похожие изделия (правило с учётом наладок).`,
    })
  }
  return recs
}
