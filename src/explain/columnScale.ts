/**
 * Один масштаб денег на колонку таблицы (владелец: «32,6 млн … 478 тыс.» в одной колонке нечитаемо):
 * порядок (₽ / тыс. ₽ / млн ₽ / млрд ₽) — по наибольшему значению колонки, единица — один раз
 * в заголовке («Вклад в прибыль, млн ₽»), в ячейках — только число: «32,6» … «0,48».
 * Числа — через src/explain/format.ts (num: запятая, U+2212, группы разрядов).
 */
import { MONEY_TIERS, NBSP, num } from './format'

export interface ColumnScale {
  /** Делитель порядка: 1, 1e3, 1e6, 1e9. */
  factor: number
  /** Единица для заголовка: «₽», «тыс. ₽», «млн ₽», «млрд ₽». */
  unit: string
  /** Число ячейки в масштабе колонки (без единицы). */
  fmt: (v: number | null | undefined) => string
}

/** Масштаб колонки денег по наибольшему |значению| (если после округления выходит «1000» — следующий порядок). */
export function columnScale(values: ReadonlyArray<number | null | undefined>): ColumnScale {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const big = finite.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  let tier = MONEY_TIERS.length - 1
  while (tier > 0 && big < MONEY_TIERS[tier].factor) tier--
  if (tier < MONEY_TIERS.length - 1 && Math.round(big / MONEY_TIERS[tier].factor) >= 1000) tier++
  const { factor, suffix } = MONEY_TIERS[tier]
  return {
    factor,
    unit: suffix ? `${suffix}${NBSP}₽` : '₽',
    fmt: (v) => (typeof v === 'number' && Number.isFinite(v) ? num(v / factor) : num(v)),
  }
}
