/**
 * Тело PUT /api/scenarios/:id из сохранённого сценария (строки БД → числа) + правка. Один источник
 * для экрана «Сценарии» и единого ползунка α (`AlphaSlider`, UX-V2 §4.10 «один α на всех»).
 */
import type { MacroMode, MacroModeName, PriceScenario, ScenarioPayload } from '../../lib/api'

/** `macro_mode` сценария хранится строкой (JSON | имя); в payload уходит объект/имя. */
export function macroModeOf(raw: string | undefined): MacroMode | MacroModeName | undefined {
  if (!raw) return undefined
  if (raw === 'base' || raw === 'regime' || raw === 'quantile' || raw === 'episode' || raw === 'iid_v063') return raw
  try { return JSON.parse(raw) as MacroMode } catch { return undefined }
}

export function payloadOf(sc: PriceScenario, extra: Partial<ScenarioPayload>): ScenarioPayload {
  return {
    name: sc.name, description: sc.description,
    horizon_hours: Number(sc.horizon_hours) || 720, market_corr: Number(sc.market_corr) || 0.5,
    objective: sc.objective || 'cvar', alpha: Number(sc.alpha) || 0.1, max_share: Number(sc.max_share) || 0.6,
    mode: sc.mode || 'stochastic', plan_id: sc.plan_id || '', start_date: sc.start_date || '', end_date: sc.end_date || '',
    inflation: Number(sc.inflation) || 0, fx: Number(sc.fx) || 1, demand: Number(sc.demand) || 1,
    volatility: Number(sc.volatility) || 0.05, months: Number(sc.months) || 6,
    sanctions: Number(sc.sanctions) || 0, tax_change: Number(sc.tax_change) || 0, energy: Number(sc.energy) || 1, logistics: Number(sc.logistics) || 1, key_rate: Number(sc.key_rate) || 8,
    macro_mode: macroModeOf(sc.macro_mode),
    ...extra,
  }
}
