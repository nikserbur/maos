/**
 * Пороги загрузки «Аналитики» — единственное определение (X2 «цвет — только для отклонений»):
 * от `warn` — «близко к пределу» (▲), от `bad` — «перегрузка» (■). Ниже `warn` — норма, без глифа
 * и без цвета. Читают: KPI «Загрузка узкого места» (kpiCatalog), ранжир узких мест (Bottlenecks),
 * правила рекомендаций (analyticsModel.REC_THRESHOLDS) и строка-вердикт экрана.
 */

export const LOAD_THRESHOLDS = { warn: 0.8, bad: 0.95 } as const

export type LoadLevel = 'ok' | 'warn' | 'bad'

/** Уровень загрузки по порогам; NaN — норма (нечего отмечать). */
export function loadLevel(u: number): LoadLevel {
  if (!Number.isFinite(u)) return 'ok'
  if (u >= LOAD_THRESHOLDS.bad) return 'bad'
  if (u >= LOAD_THRESHOLDS.warn) return 'warn'
  return 'ok'
}

/** Глиф (glyphs.css) и слово отклонения; норма не подписывается. */
export const LOAD_MARK: Readonly<Record<Exclude<LoadLevel, 'ok'>, { glyph: 'glyph-setup' | 'glyph-down'; word: string }>> = {
  warn: { glyph: 'glyph-setup', word: 'близко к пределу' },
  bad: { glyph: 'glyph-down', word: 'перегрузка' },
}
