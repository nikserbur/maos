/**
 * Шаблоны сценариев (решение владельца UX-V2 §8 п. 4 — серверные с паспортами). Эндпоинта
 * `GET /api/scenarios/templates` пока нет → фронтовые пресеты с теми же полями и паспортом
 * (происхождение каждого числа), помечены «локально» и описаны в отчёте G2 как задача бэкенду.
 * Значения — не оценки по данным предприятия: [НОРМ] / [К] / [Н] явно подписаны.
 */
import type { MacroMode, MacroModeName, ScenarioPayload } from '../../lib/api'

export interface TemplatePassportRow {
  field: string
  label: string
  value: string
  status: 'Н' | 'О' | 'К' | 'НОРМ' | 'UI'
  source: string
}

export interface ScenarioTemplate {
  id: string
  name: string
  description: string
  /** Поля сценария, которые задаёт шаблон (остальное — умолчания бэкенда). */
  values: Omit<ScenarioPayload, 'name' | 'description' | 'distributions' | 'overrides'> & { macro_mode?: MacroMode | MacroModeName }
  passport: readonly TemplatePassportRow[]
  /** Слово «прогноз» допустимо только для базового режима. */
  isForecast: boolean
}

const COMMON: readonly TemplatePassportRow[] = [
  { field: 'alpha', label: 'α хвоста', value: '10 %', status: 'К', source: 'паспорт r1.19' },
  { field: 'max_share', label: 'Макс. доля изделия', value: '35 %', status: 'НОРМ', source: 'паспорт r1.40 (клип [0,1; 1])' },
  { field: 'market_corr', label: 'Корреляция рынка', value: '0,5', status: 'НОРМ', source: 'паспорт r1.30' },
  { field: 'volatility', label: 'Волатильность цен', value: '5 %/мес', status: 'UI', source: 'паспорт r1.50 (умолчание прогноза)' },
]

export const SCENARIO_TEMPLATES: readonly ScenarioTemplate[] = [
  {
    id: 'base', name: 'Базовый', isForecast: true,
    description: 'Обученный генератор в базовом режиме (прогноз): режимы по p_last и P_HMM, опора ставки — последнее наблюдение ЦБ РФ.',
    values: { objective: 'cvar', alpha: 0.1, max_share: 0.35, market_corr: 0.5, volatility: 0.05, inflation: 0.005, fx: 1, demand: 1, months: 12, mode: 'stochastic', macro_mode: 'base' },
    passport: [
      ...COMMON,
      { field: 'macro_mode', label: 'Режим генератора', value: 'base — прогноз', status: 'НОРМ', source: 'паспорт macro.mode_default; обучение [О] на cbr.ru 2013-09…2026-09' },
      { field: 'inflation', label: 'Инфляция (прогноз цен)', value: '0,5 %/мес', status: 'НОРМ', source: 'ориентир ≈ 6 % г/г; с генератором цены индексируются pass-through [К]' },
    ],
  },
  {
    id: 'crisis', name: 'Ценовой кризис', isForecast: false,
    description: 'Стресс: навязан режим «кризис» генератора (2014-12, 2022-02 в истории) — одновременный рост ставки, слабый рубль, падение цен; волатильность выше.',
    values: { objective: 'cvar', alpha: 0.1, max_share: 0.35, market_corr: 0.75, volatility: 0.12, inflation: 0.01, fx: 1, demand: 0.85, months: 12, mode: 'stochastic', macro_mode: { mode: 'regime', stress: { regime: 1 } } },
    passport: [
      ...COMMON.filter((r) => r.field !== 'volatility' && r.field !== 'market_corr'),
      { field: 'macro_mode', label: 'Режим генератора', value: 'режим 1 «кризис» навязан — стресс, не прогноз', status: 'Н', source: '12 кризисных месяцев истории ЦБ РФ (§2.6б)' },
      { field: 'volatility', label: 'Волатильность цен', value: '12 %/мес', status: 'НОРМ', source: 'экспертный множитель ×2,4 к умолчанию' },
      { field: 'market_corr', label: 'Корреляция рынка', value: '0,75', status: 'НОРМ', source: 'цены ходят вместе в кризис — экспертно' },
      { field: 'demand', label: 'Спрос', value: '×0,85', status: 'НОРМ', source: 'экспертное допущение' },
    ],
  },
  {
    id: 'high-rate', name: 'Высокая ставка', isForecast: false,
    description: 'Стресс: квантильный путь q = 0,95 (высокая инфляция, слабый рубль, высокая ставка) — дорогая кредитная линия, проверка кассы и DSCR.',
    values: { objective: 'cvar', alpha: 0.1, max_share: 0.35, market_corr: 0.5, volatility: 0.07, inflation: 0.01, fx: 1, demand: 1, months: 12, mode: 'stochastic', macro_mode: { mode: 'quantile', stress: { quantile_t: 0.95 } } },
    passport: [
      ...COMMON.filter((r) => r.field !== 'volatility'),
      { field: 'macro_mode', label: 'Режим генератора', value: 'квантиль 0,95 Student-t — только квантили', status: 'НОРМ', source: 'RJMF §6: детерминированный путь, не ожидание' },
      { field: 'volatility', label: 'Волатильность цен', value: '7 %/мес', status: 'НОРМ', source: 'экспертный множитель' },
    ],
  },
  {
    id: 'calm', name: 'Дезинфляция', isForecast: false,
    description: 'Стресс: квантильный путь q = 0,05 (низкая инфляция, крепкий рубль, снижение ставки) — проверка, что портфель не держится только на росте цен.',
    values: { objective: 'cvar', alpha: 0.1, max_share: 0.35, market_corr: 0.4, volatility: 0.04, inflation: 0.002, fx: 1, demand: 1, months: 12, mode: 'stochastic', macro_mode: { mode: 'quantile', stress: { quantile_t: 0.05 } } },
    passport: [
      ...COMMON.filter((r) => r.field !== 'volatility' && r.field !== 'market_corr'),
      { field: 'macro_mode', label: 'Режим генератора', value: 'квантиль 0,05 Student-t', status: 'НОРМ', source: 'RJMF §6' },
      { field: 'volatility', label: 'Волатильность цен', value: '4 %/мес', status: 'НОРМ', source: 'экспертный множитель' },
      { field: 'market_corr', label: 'Корреляция рынка', value: '0,4', status: 'НОРМ', source: 'экспертно' },
    ],
  },
]

export function getTemplate(id: string): ScenarioTemplate | undefined {
  return SCENARIO_TEMPLATES.find((t) => t.id === id)
}
