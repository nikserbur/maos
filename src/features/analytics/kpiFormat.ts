/**
 * Отображение KPI: число и единица раздельно (крупная цифра + приглушённая
 * единица), светофор → статус-глиф. Числа — общие форматтеры src/explain/format.ts.
 */
import { DASH, NBSP, fmtValue, money, num, plural, signed } from '../../explain/format'
import type { KpiDef, KpiDir, KpiStatus, KpiUnit } from './kpiCatalog'

export interface ValueParts { value: string; unit: string }

/** «1 123,4 ч» → { value: «1 123,4», unit: «ч» }: граница — первый пробел после цифры перед не-цифрой. */
export function splitUnit(text: string): ValueParts {
  const m = /^(.*\d)\s+(\D.*)$/u.exec(text)
  return m ? { value: m[1], unit: m[2] } : { value: text, unit: '' }
}

/** Значение KPI по частям для плитки. NaN → «—» без единицы. */
export function kpiParts(v: number, unit: KpiUnit): ValueParts {
  if (!Number.isFinite(v)) return { value: DASH, unit: '' }
  if (unit === '₽') return splitUnit(money(v))
  if (unit === 'ч') return { value: num(v, Math.abs(v) >= 100 ? 0 : 1), unit: 'ч' }
  return splitUnit(fmtValue(v, unit))
}

/** Значение KPI одной строкой. */
export function kpiText(v: number, unit: KpiUnit): string {
  const p = kpiParts(v, unit)
  return p.unit ? `${p.value}${NBSP}${p.unit}` : p.value
}

/** Разность A − B с единицей KPI; для долей — в процентных пунктах. */
export function kpiDeltaText(d: number, unit: KpiUnit): string {
  if (!Number.isFinite(d)) return DASH
  if (unit === '%') {
    // Процентные пункты словом: «+1,2 пункта» (без «п. п.»).
    const t = signed(d * 100)
    return `${t}${NBSP}${plural(Math.abs(Number(t.replace(/[+−\s ]/g, '').replace(',', '.'))), ['пункт', 'пункта', 'пунктов'])}`
  }
  if (unit === 'ч') return signed(d, 'ч')
  if (unit === '₽') return signed(d, '₽')
  return signed(d, unit)
}

/** Лучше ли изменение с учётом направления показателя (null — нейтрально / нет данных). */
export function isBetter(d: number, dir: KpiDir): boolean | null {
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12 || dir === 'neutral') return null
  return dir === 'up' ? d > 0 : d < 0
}

export const STATUS_GLYPH: Record<Exclude<KpiStatus, ''>, string> = {
  good: 'glyph-running',
  warn: 'glyph-setup',
  bad: 'glyph-down',
}
export const STATUS_LABEL: Record<Exclude<KpiStatus, ''>, string> = {
  good: 'в норме',
  warn: 'внимание',
  bad: 'критично',
}

/** Статус KPI по светофору; нет значения или правила — ''. */
export function kpiStatus(def: KpiDef, v: number, b: Parameters<NonNullable<KpiDef['status']>>[1]): KpiStatus {
  return def.status && Number.isFinite(v) ? def.status(v, b) : ''
}

/** Отклонение для показа (X2: норма не подписывается и не красится) — только «внимание» и «критично». */
export type KpiDeviation = Exclude<KpiStatus, 'good' | ''>

export function kpiDeviation(def: KpiDef, v: number, b: Parameters<NonNullable<KpiDef['status']>>[1]): KpiDeviation | null {
  const st = kpiStatus(def, v, b)
  return st === 'warn' || st === 'bad' ? st : null
}

/** Направление «лучше» для DeltaChip кита: up → рост лучше, down → снижение лучше, neutral — без оценки. */
export function deltaBetter(dir: KpiDir): 'high' | 'low' | undefined {
  return dir === 'up' ? 'high' : dir === 'down' ? 'low' : undefined
}

export const DIR_ARROW: Record<KpiDir, string> = { up: '↑', down: '↓', neutral: '·' }
export const DIR_TITLE: Record<KpiDir, string> = {
  up: 'больше — лучше',
  down: 'меньше — лучше',
  neutral: 'оценивается по контексту',
}
