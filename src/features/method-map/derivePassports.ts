/**
 * Паспорта параметров из статических определений (`params.ts`) и живых значений:
 * сценарий → scenario.*, форма «Оптимизации» → opt.*, параметры «Плана» → plan.*.
 * Происхождение: `manual`, если пользователь отошёл от значения по умолчанию;
 * коэффициенты «для заметности» остаются `normative` при любом значении.
 */
import type { DeriveInput } from './deriveInput'
import { PARAM_LIST } from './params'
import type { ParamDef, ParameterPassport, Provenance } from './types'

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Значение параметра из текущего контекста; undefined — источник недоступен. */
function liveValue(def: ParamDef, input: DeriveInput): number | string | null | undefined {
  const { scenario, opt, plan } = input
  const scn = (field: keyof NonNullable<typeof scenario>) => (scenario ? toNum(scenario[field]) : undefined)
  switch (def.id) {
    case 'scenario.key_rate': return scn('key_rate')
    case 'scenario.fx': return scn('fx')
    case 'scenario.inflation': { const v = scn('inflation'); return v == null ? v : v * 100 }
    case 'scenario.demand': return scn('demand')
    case 'scenario.volatility': { const v = scn('volatility'); return v == null ? v : v * 100 }
    case 'scenario.market_corr': return scn('market_corr')
    case 'scenario.months': return scn('months')
    case 'scenario.energy': return scn('energy')
    case 'scenario.logistics': return scn('logistics')
    case 'scenario.sanctions': return scn('sanctions')
    case 'scenario.tax_change': return scn('tax_change')
    case 'scenario.objective': return scenario?.objective || opt.form.objective
    case 'scenario.alpha': return scn('alpha') ?? toNum(opt.form.alpha)
    case 'scenario.max_share': return scn('max_share') ?? toNum(opt.form.maxShare)
    case 'dist.beta_default': {
      const betas = (scenario?.distributions ?? []).map((d) => toNum(d.beta)).filter((b): b is number => b !== null)
      return betas.length ? Math.round((betas.reduce((a, b) => a + b, 0) / betas.length) * 100) / 100 : undefined
    }
    case 'opt.samples': return toNum(opt.form.samples)
    case 'opt.horizon_months': return toNum(opt.form.horizonMonths)
    case 'plan.rule': return plan.params.rule
    case 'plan.samples': return toNum(plan.params.samples)
    case 'plan.w_risk': return toNum(plan.params.wRisk)
    case 'plan.w_time': return plan.result?.weights.time ?? undefined
    case 'plan.w_cost': return plan.result?.weights.cost ?? undefined
    case 'cal.enabled': return plan.params.useCalendar ? 'вкл' : 'выкл'
    case 'cal.work_fond': return plan.result?.calendar.work_fond_hours ?? undefined
    default: return undefined
  }
}

function provenanceOf(def: ParamDef, value: number | string | null, hasSource: boolean): Provenance {
  if (def.stage && def.stage !== 'done') return 'default'
  if (def.provenance === 'normative') return 'normative'
  if (def.provenance === 'estimated') return value === null ? 'default' : 'estimated'
  if (!hasSource || value === null) return 'default'
  const differs = def.defaultValue === undefined || String(value) !== String(def.defaultValue)
  return differs ? 'manual' : 'default'
}

function outOfRange(def: ParamDef, value: number | string | null): boolean {
  if (!def.range || typeof value !== 'number') return false
  return value < def.range[0] || value > def.range[1]
}

export function buildPassport(def: ParamDef, input: DeriveInput): ParameterPassport {
  const live = liveValue(def, input)
  const hasSource = live !== undefined
  const value = live === undefined ? (def.defaultValue ?? null) : live
  const provenance = provenanceOf(def, value, hasSource)
  const updatedAt = def.owner === 'run' && input.plan.builtAt ? new Date(input.plan.builtAt).toISOString() : undefined
  return {
    id: def.id, label: def.label, unit: def.unit, value, provenance, owner: def.owner,
    range: def.range, step: def.step, editable: def.editable, screen: def.screen, note: def.note,
    stage: def.stage, outOfRange: outOfRange(def, value), estimatedAt: updatedAt,
  }
}

export function derivePassports(input: DeriveInput): Record<string, ParameterPassport> {
  return Object.fromEntries(PARAM_LIST.map((def) => [def.id, buildPassport(def, input)]))
}
