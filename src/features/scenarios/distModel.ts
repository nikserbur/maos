/**
 * Чистая модель строки вкладки «Распределения» (X1 §3 п. 6): строка из сценария и изделия,
 * признак «задано вручную / отличается от умолчания» (только таким строкам рисуем плотность),
 * текстовая сводка «нормальное · σ 12 %» для остальных. Без DOM — vitest.
 */
import type { DistType, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { pct } from '../../explain/format'
import { DIST_TYPE_LABEL } from '../../ui/DensityMini'

export const SIGMA_DEFAULT = 0.12
export const BETA_DEFAULT = 0.7
/** Допуск сравнения относительной σ с умолчанием (12 % ± 0,5 п. п.). */
const REL_TOLERANCE = 0.005

export interface DistRow {
  p: Product
  /** Покупное сырьё (закупочная цена), не изделие сбыта. */
  raw: boolean
  d?: PriceDistribution
  base: number
  /** Точечный оверрайд базовой цены в сценарии. */
  hasOverride: boolean
  center: number
  sd: number
  /** σ / центр. */
  rel: number
  beta: number
  type: DistType
}

const toNum = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export function distRow(sc: Pick<PriceScenario, 'distributions' | 'overrides'>, p: Product): DistRow {
  const d = sc.distributions?.find((x) => x.product_id === p.id)
  const raw = p.purchased === '1'
  const ovr = sc.overrides?.find((o) => o.product_id === p.id)
  const base = toNum((raw ? p.base_cost : p.base_price) || 0)
  const center = d ? toNum(d.mean) || base : toNum(ovr?.base_price ?? ovr?.base_cost ?? base)
  const sd = d ? toNum(d.stddev) : Math.round(base * SIGMA_DEFAULT)
  const type: DistType = d?.dist_type ?? 'normal'
  return {
    p, raw, d, base, hasOverride: Boolean(ovr), center, sd,
    rel: center > 0 ? sd / center : SIGMA_DEFAULT,
    beta: d?.beta !== undefined ? toNum(d.beta) : BETA_DEFAULT,
    type,
  }
}

/** Распределение задано вручную или отличается от умолчания (нормальное · σ 12 % · β 0,7 · без хвостов). */
export function isCustomDist(r: Pick<DistRow, 'd' | 'type' | 'rel' | 'beta' | 'center' | 'base'>): boolean {
  if (!r.d) return false
  if (r.type !== 'normal') return true
  if (Math.abs(r.rel - SIGMA_DEFAULT) > REL_TOLERANCE) return true
  if (Math.abs(r.beta - BETA_DEFAULT) > 1e-9) return true
  if (r.d.min_val || r.d.max_val) return true
  return r.base > 0 && Math.abs(r.center - r.base) > 1e-9
}

/** Текстовая сводка вместо плотности: «нормальное · σ 12 %». */
export function distSummary(type: DistType, rel: number): string {
  return `${DIST_TYPE_LABEL[type]} · σ ${pct(rel, 0)}`
}

/** Подпись хвостов: явные границы, параметры семейства или «—». */
export function tailsLabel(r: Pick<DistRow, 'd' | 'type'>): string {
  if (r.d?.min_val || r.d?.max_val) return `${r.d.min_val ?? '−∞'} … ${r.d.max_val ?? '+∞'}`
  if (r.type === 't') return 'ν = 5 · норматив'
  if (r.type === 'pareto') return 'α = 2,3 · для UI'
  return '—'
}
