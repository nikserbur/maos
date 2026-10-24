/**
 * Значения узлов контекста: сырое число + род единицы + текст по единым форматтерам
 * (src/explain/format.ts). Модель копирует текст дословно, проверка сверяет число с сырым значением.
 */
import { DASH, NBSP, fmtValue, num, type Unit } from '../../../explain/format'
import type { CtxValue, UnitKind } from './types'

const UNITS: ReadonlySet<string> = new Set<Unit>(['ч', 'мин', 'мес', '%', '₽', '₽/мес', 'ед.', 'ед./сут', 'шт', 'заказов', 'заказ/сут', 'чел.', 'нед', '—'])
const PP_UNITS: ReadonlySet<string> = new Set(['%/год', '%/мес', 'п.п.'])

/** Род единицы по подписи единицы реестра/паспорта. */
export function unitKindOf(unit: string | undefined): Exclude<UnitKind, 'text'> {
  if (unit === '₽' || unit === '₽/мес') return 'money'
  if (unit === '%') return 'pct'
  if (unit === 'ч') return 'hours'
  if (unit && (PP_UNITS.has(unit) || unit.startsWith('%'))) return 'pp'
  return 'plain'
}

/** Текст значения: единицы реестра — через fmtValue, прочие («×», «%/год», «дн») — число + единица. */
export function valueText(value: number, unit: string | undefined): string {
  if (!unit || UNITS.has(unit)) return fmtValue(value, unit as Unit | undefined)
  return `${num(value)}${NBSP}${unit}`
}

/**
 * Значение для контекста; null/undefined/NaN/пустая строка → null (в контекст не попадает:
 * «нет данных» — это отсутствие узла, а не ноль).
 */
export function ctxValue(key: string, label: string, value: unknown, unit?: string): CtxValue | null {
  if (typeof value === 'string') {
    const s = value.trim()
    return s ? { key, label, value: s, unitKind: 'text', text: s } : null
  }
  if (typeof value === 'boolean') return { key, label, value: value ? 'да' : 'нет', unitKind: 'text', text: value ? 'да' : 'нет' }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const text = valueText(value, unit)
  if (text === DASH) return null
  return { key, label, value, unitKind: unitKindOf(unit), text }
}

/** Список значений без пустых. */
export function compactValues(list: ReadonlyArray<CtxValue | null>): CtxValue[] {
  return list.filter((v): v is CtxValue => v !== null)
}
