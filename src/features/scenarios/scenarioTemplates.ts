/**
 * Шаблоны сценариев (решение владельца UX-V2 §8 п. 4): фронтовые пресеты с паспортом — откуда
 * каждое число. Общие значения — из scenarioDefaults.ts (те же, с которыми считает движок).
 * Источник — простыми словами («калибровка по ставке ЦБ РФ 2013–2026», «экспертная оценка»,
 * «норматив предприятия»); код паспорта — только в подсказке (`code`).
 */
import type { MacroMode, MacroModeName, ScenarioPayload } from '../../lib/api'
import { NBSP } from '../../explain/format'
import { SCENARIO_DEFAULTS as D } from './scenarioDefaults'

export interface TemplatePassportRow {
  field: string
  label: string
  value: string
  status: 'Н' | 'О' | 'К' | 'НОРМ' | 'UI'
  /** Источник простыми словами. */
  source: string
  /** Код записи паспорта — только для подсказки. */
  code?: string
}

export interface ScenarioTemplate {
  id: string
  name: string
  description: string
  /** Поля сценария, которые задаёт шаблон (остальное — умолчания движка). */
  values: Omit<ScenarioPayload, 'name' | 'description' | 'distributions' | 'overrides'> & { macro_mode?: MacroMode | MacroModeName }
  passport: readonly TemplatePassportRow[]
  /** Слово «прогноз» допустимо только для базового режима. */
  isForecast: boolean
}

const P = `${NBSP}%`
const COMMON: readonly TemplatePassportRow[] = [
  { field: 'alpha', label: 'α хвоста', value: `10${P}`, status: 'К', source: 'калибровка: доля худших сценариев для CVaR', code: 'r1.19' },
  { field: 'max_share', label: 'Макс. доля изделия', value: `60${P}`, status: 'НОРМ', source: 'норматив предприятия', code: 'r1.40' },
  { field: 'market_corr', label: 'Корреляция цен', value: '0,5', status: 'НОРМ', source: 'норматив предприятия', code: 'r1.30' },
  { field: 'volatility', label: 'Волатильность цен', value: `5${P}/мес`, status: 'UI', source: 'значение по умолчанию прогноза', code: 'r1.50' },
]

/** Общие значения шаблонов — умолчания движка. */
const BASE_VALUES = {
  objective: D.objective, alpha: D.alpha, max_share: D.max_share, market_corr: D.market_corr, volatility: D.volatility,
  fx: D.fx, demand: D.demand, mode: D.mode, months: 12,
} as const

export const SCENARIO_TEMPLATES: readonly ScenarioTemplate[] = [
  {
    id: 'base', name: 'Базовый', isForecast: true,
    description: 'Обученный генератор в базовом режиме: режимы по последнему наблюдению, опора ставки — последнее значение ЦБ РФ.',
    values: { ...BASE_VALUES, inflation: 0.005, macro_mode: 'base' },
    passport: [
      ...COMMON,
      { field: 'macro_mode', label: 'Режим генератора', value: 'базовый — прогноз', status: 'НОРМ', source: 'калибровка по ставке ЦБ РФ 2013–2026', code: 'macro.mode_default' },
      { field: 'inflation', label: 'Инфляция цен', value: `0,5${P}/мес`, status: 'НОРМ', source: `ориентир ≈ 6${P} в год (экспертная оценка)` },
    ],
  },
  {
    id: 'crisis', name: 'Ценовой кризис', isForecast: false,
    description: 'Стресс: режим «кризис» навязан (как 2014-12 и 2022-02) — рост ставки, слабый рубль, падение цен, волатильность выше.',
    values: { ...BASE_VALUES, market_corr: 0.75, volatility: 0.12, inflation: 0.01, demand: 0.85, macro_mode: { mode: 'regime', stress: { regime: 1 } } },
    passport: [
      ...COMMON.filter((r) => r.field !== 'volatility' && r.field !== 'market_corr'),
      { field: 'macro_mode', label: 'Режим генератора', value: 'режим «кризис» навязан — стресс', status: 'Н', source: '12 кризисных месяцев истории ЦБ РФ' },
      { field: 'volatility', label: 'Волатильность цен', value: `12${P}/мес`, status: 'НОРМ', source: 'экспертная оценка (×2,4 к умолчанию)' },
      { field: 'market_corr', label: 'Корреляция цен', value: '0,75', status: 'НОРМ', source: 'экспертная оценка: в кризис цены ходят вместе' },
      { field: 'demand', label: 'Спрос', value: '×0,85', status: 'НОРМ', source: 'экспертная оценка' },
    ],
  },
  {
    id: 'high-rate', name: 'Высокая ставка', isForecast: false,
    description: 'Стресс: путь 95-го процентиля — высокая инфляция, слабый рубль, высокая ставка; проверка кассы и кредитной линии.',
    values: { ...BASE_VALUES, volatility: 0.07, inflation: 0.01, macro_mode: { mode: 'quantile', stress: { quantile_t: 0.95 } } },
    passport: [
      ...COMMON.filter((r) => r.field !== 'volatility'),
      { field: 'macro_mode', label: 'Режим генератора', value: 'квантиль 0,95 — стресс', status: 'НОРМ', source: 'норматив методики: детерминированный путь, не ожидание' },
      { field: 'volatility', label: 'Волатильность цен', value: `7${P}/мес`, status: 'НОРМ', source: 'экспертная оценка' },
    ],
  },
  {
    id: 'calm', name: 'Дезинфляция', isForecast: false,
    description: 'Стресс: путь 5-го процентиля — низкая инфляция, крепкий рубль, снижение ставки; держится ли портфель без роста цен.',
    values: { ...BASE_VALUES, market_corr: 0.4, volatility: 0.04, inflation: 0.002, macro_mode: { mode: 'quantile', stress: { quantile_t: 0.05 } } },
    passport: [
      ...COMMON.filter((r) => r.field !== 'volatility' && r.field !== 'market_corr'),
      { field: 'macro_mode', label: 'Режим генератора', value: 'квантиль 0,05 — стресс', status: 'НОРМ', source: 'норматив методики' },
      { field: 'volatility', label: 'Волатильность цен', value: `4${P}/мес`, status: 'НОРМ', source: 'экспертная оценка' },
      { field: 'market_corr', label: 'Корреляция цен', value: '0,4', status: 'НОРМ', source: 'экспертная оценка' },
    ],
  },
]

export function getTemplate(id: string): ScenarioTemplate | undefined {
  return SCENARIO_TEMPLATES.find((t) => t.id === id)
}

/** «Базовый» → «Базовый 2», если имя занято (регистр и пробелы не различаются). */
export function uniqueName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  const base = name.trim() || 'Новый сценарий'
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 1000; i++) {
    const next = `${base} ${i}`
    if (!taken.has(next.toLowerCase())) return next
  }
  return `${base} ${existing.length + 1}`
}

/** Имя уже занято другим сценарием. */
export function isDuplicateName(name: string, existing: readonly string[]): boolean {
  const n = name.trim().toLowerCase()
  return n !== '' && existing.some((e) => e.trim().toLowerCase() === n)
}
