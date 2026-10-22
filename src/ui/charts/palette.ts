/**
 * Палитра chart-системы (X1 §8, dataviz): только токены `--chart-1…8`, порядок закреплён за
 * сущностью (ряд/заказ), девятый и далее ряд — `--chart-other`. Статусные цвета для рядов
 * не используются; текст никогда не носит цвет ряда.
 */

/** Число категориальных слотов палитры. */
export const CHART_SLOTS = 8

/** Цвет ряда по его индексу: слот 1…8, далее «прочее». */
export function seriesColor(index: number): string {
  if (!Number.isInteger(index) || index < 0) return 'var(--chart-other)'
  return index < CHART_SLOTS ? `var(--chart-${index + 1})` : 'var(--chart-other)'
}

/** Цвет ряда с возможностью явного переопределения (миграция старых компонентов). */
export function colorOf(index: number, explicit?: string): string {
  return explicit ?? seriesColor(index)
}

/** Форма образца в легенде/подсказке: линия (ряды-линии), прямоугольник (столбцы/площади), точка, полоса (веер). */
export type SwatchShape = 'line' | 'rect' | 'dot' | 'band'

export interface LegendItem {
  key: string
  label: string
  color: string
  shape?: SwatchShape
  /** Пунктир — только для «проекции/порога», никогда для сетки. */
  dashed?: boolean
  /** Глиф состояния (класс из glyphs.css: glyph-running/setup/idle/down) вместо образца цвета. */
  glyph?: string
  /** Собственный образец (штриховка, обводка) — класс элемента вместо SVG-образца. */
  swatchClass?: string
}
