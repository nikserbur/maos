/**
 * Раскладка колонок таблицы данных (владелец: «сокращения по таблицам — нечитаемо»): одна
 * гибкая колонка имени (primary) забирает свободную ширину и переносится целиком, без многоточия;
 * числовые колонки — по содержимому (width: 1 %, без переноса), прочие текстовые — переносятся.
 * Primary выбирается автоматически, если не задан: заголовок строки (rowHeader) с текстом →
 * первая колонка `clip` → первая текстовая колонка. Чистые функции — vitest без DOM.
 */

/** Минимальная ширина колонки в знаках (`ch`) — фиксированная шкала классов `dk-minw-N`. */
export type MinWidthCh = 8 | 10 | 12 | 14 | 16 | 18 | 20 | 24

export interface ColumnLayoutSpec {
  key: string
  num?: boolean
  rowHeader?: boolean
  /** @deprecated Прежняя «обрезка с многоточием»; теперь — полный перенос, минимум 12 знаков (у rowHeader — primary). */
  clip?: boolean
  /** Гибкая колонка имени: забирает свободную ширину, ≥ 14rem, переносится целиком. Одна на таблицу. */
  primary?: boolean
  /** 'fit' — по содержимому без переноса (по умолчанию у числовых); 'auto' — как решит таблица. */
  width?: 'fit' | 'auto'
  /** Минимальная ширина, `ch`. */
  minWidth?: MinWidthCh
  /** Ограничение строк текста (1–3, с подсказкой полного текста); по умолчанию — без ограничения: имена не обрезаются. */
  wrap?: 1 | 2 | 3
  /** Приоритет при нехватке ширины: 3 — скрывается первой (узкий контейнер), 2 — следом. */
  priority?: 1 | 2 | 3
  /** Выравнивание; по умолчанию числа — вправо, текст — влево. */
  align?: 'left' | 'right' | 'center'
}

export interface ColumnLayout {
  primary: boolean
  fit: boolean
  right: boolean
  center: boolean
  /** Ограничение строк для простого текста ячейки (undefined — без ограничения). */
  clamp?: 1 | 2 | 3
  minWidth?: MinWidthCh
  priority?: 2 | 3
}

/**
 * Индекс primary-колонки: явный → rowHeader с текстом → первая `clip` → первая текстовая; −1 — нет текстовых.
 * `numericValued[i]` — значение колонки в данных число (номер прогона без `num`) — такая колонка не гибкая.
 */
export function primaryIndex(cols: ReadonlyArray<ColumnLayoutSpec>, numericValued: ReadonlyArray<boolean> = []): number {
  const explicit = cols.findIndex((c) => c.primary)
  if (explicit >= 0) return explicit
  const isText = (c: ColumnLayoutSpec) => !c.num && c.align !== 'right' && c.width !== 'fit' && !numericValued[cols.indexOf(c)]
  const rh = cols.findIndex((c) => c.rowHeader && isText(c))
  if (rh >= 0) return rh
  const clip = cols.findIndex((c) => c.clip && isText(c))
  if (clip >= 0) return clip
  return cols.findIndex(isText)
}

/** Сколько колонок явно помечены primary (больше одной — ошибка вызывающего кода). */
export function explicitPrimaryCount(cols: ReadonlyArray<ColumnLayoutSpec>): number {
  return cols.filter((c) => c.primary).length
}

/** Раскладка каждой колонки в порядке `cols`. */
export function columnLayouts(cols: ReadonlyArray<ColumnLayoutSpec>, numericValued: ReadonlyArray<boolean> = []): ColumnLayout[] {
  const p = primaryIndex(cols, numericValued)
  return cols.map((c, i) => {
    const primary = i === p
    const right = c.align ? c.align === 'right' : Boolean(c.num)
    const fit = !primary && (c.width === 'fit' || (c.width === undefined && Boolean(c.num)))
    const clamp = c.wrap
    // Бывшая `clip`-колонка, не ставшая primary, не схлопывается: минимум 12 знаков.
    const minWidth = c.minWidth ?? (!primary && c.clip ? 12 : undefined)
    const priority = c.priority === 2 || c.priority === 3 ? c.priority : undefined
    return { primary, fit, right, center: c.align === 'center', clamp, minWidth, priority }
  })
}

/** Классы ячейки (и заголовка) по раскладке; заголовок получает те же классы ширины, но не обрезается. */
export function layoutClass(l: ColumnLayout, extra?: string): string | undefined {
  return [
    l.right ? 'num' : '',
    l.center ? 'dk-col-center' : '',
    l.primary ? 'dk-col-primary' : '',
    l.fit ? 'dk-col-fit' : '',
    l.minWidth ? `dk-minw-${l.minWidth}` : '',
    l.priority ? `dk-col-p${l.priority}` : '',
    extra ?? '',
  ].filter(Boolean).join(' ') || undefined
}

/** Шкала ширин шапки узкой колонки, `ch` (классы `dk-thw-N`). */
export type HeadWidthCh = 8 | 10 | 12 | 14 | 16 | 18 | 20 | 22
const HEAD_MIN = 8
const HEAD_MAX = 22
/** Запас на стрелку сортировки и межбуквенное расхождение кириллицы с шириной «0». */
const HEAD_SLACK = 2

/**
 * Минимальная ширина шапки узкой колонки (числа, `fit`) по её заголовку: без неё колонка с width 1 %
 * сжимается до самого длинного слова и заголовок встаёт столбиком по слову («Суммарное / время / по /
 * норме, / мин»). Ширина ≈ половина текста + запас (2 строки), не уже самого длинного слова + запас;
 * шкала 8–22 знака с шагом 2. Не строка (узел) или гибкая/обычная колонка — undefined.
 */
export function headWidth(title: unknown, layout: Pick<ColumnLayout, 'fit' | 'right' | 'primary'>): HeadWidthCh | undefined {
  if (typeof title !== 'string' || layout.primary || !(layout.fit || layout.right)) return undefined
  const text = title.trim()
  if (!text) return undefined
  const longestWord = Math.max(...text.split(/\s+/).map((w) => w.length))
  const want = Math.max(Math.ceil(text.length / 2), longestWord) + HEAD_SLACK
  const even = Math.ceil(Math.min(HEAD_MAX, Math.max(HEAD_MIN, want)) / 2) * 2
  return even as HeadWidthCh
}
