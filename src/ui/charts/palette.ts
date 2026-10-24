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

/* ── Один цвет на сущность во всех графиках (X2) ─────────────────────────── */

/** Число именованных слотов сущностей (изделия, станки): дальше — «прочие». */
export const ENTITY_SLOTS = 6

export interface EntitySlot {
  /** 0…5 — именованный слот; -1 — «прочие». */
  slot: number
  color: string
  other: boolean
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

/**
 * Слот сущности по порядку НСИ (сортировка id), а не по порядку на экране: одно изделие — один
 * цвет при любом фильтре и сортировке. Первые 6 — --chart-1…6, седьмая и далее — «прочие»
 * (--chart-8, штриховка), никогда не по модулю (цвет не повторяется у разных сущностей).
 * `kind` разделяет пространства («product», «machine»), `universe` — все id этого вида в НСИ.
 */
export function slotForEntity(kind: string, id: string, universe: ReadonlyArray<string>): EntitySlot {
  void kind
  const ordered = [...new Set(universe)].sort(collator.compare)
  const at = ordered.indexOf(id)
  if (at < 0 || at >= ENTITY_SLOTS) return { slot: -1, color: 'var(--chart-other)', other: true }
  return { slot: at, color: `var(--chart-${at + 1})`, other: false }
}

/** Легенда сущностей: ≤ 6 именованных + одна строка «прочие (N)» со штриховкой. */
export function entityLegend(kind: string, items: ReadonlyArray<{ id: string; label: string }>, universe: ReadonlyArray<string>): LegendItem[] {
  const named: LegendItem[] = []
  let others = 0
  for (const it of items) {
    const s = slotForEntity(kind, it.id, universe)
    if (s.other) others++
    else named.push({ key: it.id, label: it.label, color: s.color, shape: 'rect' })
  }
  named.sort((a, b) => collator.compare(a.key, b.key))
  return others > 0 ? [...named, { key: '__other', label: `прочие (${others})`, color: 'var(--chart-other)', shape: 'rect', swatchClass: 'ch-sw-other' }] : named
}
