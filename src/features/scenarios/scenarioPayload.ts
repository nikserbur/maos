/**
 * Тело PUT /api/scenarios/:id из сохранённого сценария (строки БД → числа) + правка. Один источник
 * для экрана «Сценарии» и единого ползунка α (`AlphaSlider`, UX-V2 §4.10 «один α на всех»).
 * Умолчания — из scenarioDefaults.ts (те же, что показывает шапка); 0 сохраняется (`numOr`),
 * устаревшие поля возвращаются как есть — сохранение «туда и обратно» не теряет ни одного поля.
 */
import type { MacroMode, MacroModeName, PriceScenario, ScenarioPayload } from '../../lib/api'
import { LEGACY_DEFAULTS, SCENARIO_DEFAULTS as D, numOr } from './scenarioDefaults'

/** `macro_mode` сценария хранится строкой (JSON | имя); в payload уходит объект/имя. */
export function macroModeOf(raw: string | undefined): MacroMode | MacroModeName | undefined {
  if (!raw) return undefined
  if (raw === 'base' || raw === 'regime' || raw === 'quantile' || raw === 'episode' || raw === 'iid_v063') return raw
  try { return JSON.parse(raw) as MacroMode } catch { return undefined }
}

export function payloadOf(sc: Partial<PriceScenario>, extra: Partial<ScenarioPayload> = {}): ScenarioPayload {
  return {
    name: sc.name ?? '', description: sc.description,
    horizon_hours: numOr(sc.horizon_hours, D.horizon_hours), market_corr: numOr(sc.market_corr, D.market_corr),
    objective: sc.objective || D.objective, alpha: numOr(sc.alpha, D.alpha), max_share: numOr(sc.max_share, D.max_share),
    mode: sc.mode || D.mode, plan_id: sc.plan_id || '', start_date: sc.start_date || '', end_date: sc.end_date || '',
    inflation: numOr(sc.inflation, D.inflation), fx: numOr(sc.fx, D.fx), demand: numOr(sc.demand, D.demand),
    volatility: numOr(sc.volatility, D.volatility), months: numOr(sc.months, D.months),
    sanctions: numOr(sc.sanctions, LEGACY_DEFAULTS.sanctions), tax_change: numOr(sc.tax_change, LEGACY_DEFAULTS.tax_change),
    energy: numOr(sc.energy, LEGACY_DEFAULTS.energy), logistics: numOr(sc.logistics, LEGACY_DEFAULTS.logistics),
    key_rate: numOr(sc.key_rate, LEGACY_DEFAULTS.key_rate),
    macro_mode: macroModeOf(sc.macro_mode),
    ...extra,
  }
}
