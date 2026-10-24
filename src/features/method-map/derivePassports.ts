/**
 * Паспорта параметров из статических определений (`params.ts`), живых значений и
 * серверного паспорта (волна G2): сценарий → scenario.*, форма «Оптимизации» → opt.*,
 * параметры «Плана» → plan.*, fin_params → fin.*, сводка генератора → macro.*.
 * Происхождение: статус серверного паспорта (Н/О/К/НОРМ/UI/синтетика) по `passportCode`,
 * `manual` — если пользователь отошёл от значения по умолчанию у редактируемого поля;
 * [К] и [НОРМ] никогда не становятся «оценено». Чистая функция.
 */
import type { PassportParam } from '../../lib/api'
import { num } from '../../explain/format'
import type { DeriveInput } from './deriveInput'
import { PARAM_LIST } from './params'
import type { ParamDef, ParameterPassport, Provenance } from './types'

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Статус серверного паспорта → происхождение; «техн.» — константа кода. */
export function provenanceFromStatus(status: string | undefined): Provenance | null {
  switch (status) {
    case 'Н': return 'observed'
    case 'О': return 'estimated'
    case 'К': return 'calibrated'
    case 'НОРМ': return 'normative'
    case 'UI': return 'ui'
    case 'синтетика': return 'synthetic'
    case 'техн.': return 'default'
    default: return null
  }
}

/** Значение параметра из текущего контекста; undefined — источник недоступен. */
function liveValue(def: ParamDef, input: DeriveInput): number | string | null | undefined {
  const { scenario, opt, plan, fin, macro } = input
  const scn = (field: keyof NonNullable<typeof scenario>) => (scenario ? toNum(scenario[field]) : undefined)
  const pctOf = (v: number | null | undefined) => (v == null ? v : v * 100)
  switch (def.id) {
    case 'scenario.key_rate': return scn('key_rate')
    case 'scenario.fx': return scn('fx')
    case 'scenario.inflation': return pctOf(scn('inflation'))
    case 'scenario.demand': return scn('demand')
    case 'scenario.volatility': return pctOf(scn('volatility'))
    case 'scenario.market_corr': return scn('market_corr')
    case 'scenario.months': return scn('months')
    case 'scenario.energy': return scn('energy')
    case 'scenario.logistics': return scn('logistics')
    case 'scenario.sanctions': return scn('sanctions')
    case 'scenario.tax_change': return scn('tax_change')
    case 'scenario.objective': return scenario?.objective || opt.form.objective
    case 'scenario.alpha': return scn('alpha') ?? toNum(opt.form.alpha)
    case 'scenario.max_share': return scn('max_share') ?? toNum(opt.form.maxShare)
    case 'macro.mode': return scenario ? macroModeLabel(scenario.macro_mode) : undefined
    case 'macro.generator': return macro ? `${macro.regimes} режима · блок ${macro.block_months} мес · ранг ${macro.rank}` : undefined
    case 'macro.selection_crps': return macro ? macro.selection.choice.joint_standardized_CRPS_13months : undefined
    case 'macro.holdout_coverage80': {
      const v = macro?.holdout?.variables
      return v ? `π ${num(v.cpi_yoy_pp.coverage80, 2)} · ставка ${num(v.key_pp.coverage80, 2)} · курс ${num(v.usd_rub.coverage80, 2)}` : undefined
    }
    case 'macro.ref_key': return macro ? macro.last_obs.key_pp : undefined
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
    case 'agent.policy_version': return input.rl ? (input.rl.l0.ok ? input.rl.l0.sha256.slice(0, 10) : 'не опубликована') : undefined
    case 'agent.max_moves': return input.guardrails ? input.guardrails.limits.max_moves : undefined
    case 'fin.cash0': return fin ? fin.c0 : undefined
    case 'fin.credit_limit': return fin ? fin.credit_limit : undefined
    case 'fin.credit_rate': return fin ? (fin.key_rate + fin.spread) * 100 : undefined
    case 'fin.spread': return fin ? fin.spread * 100 : undefined
    case 'fin.dso': return fin ? fin.dso_kernel.map((w) => String(w).replace('.', ',')).join(' / ') : undefined
    case 'fin.dpo': return fin ? fin.dpo_weeks : undefined
    case 'fin.pd': return fin ? fin.pd : undefined
    case 'fin.beta': return fin ? fin.beta : undefined
    case 'fin.l_min': return fin ? fin.l_min : undefined
    case 'fin.repair_budget': return fin ? fin.repair_budget_weekly : undefined
    case 'fin.tau_v': return fin ? fin.tau_v : undefined
    case 'fin.tau_p': return fin ? fin.tau_p : undefined
    case 'fin.dscr_covenant': return fin ? fin.dscr_covenant : undefined
    case 'fin.auto_repay': return fin ? (fin.auto_repay ? 'включено' : 'выключено') : undefined
    case 'fin.tax_cumulative': return fin ? ((fin.tax_cumulative ?? 1) ? 'включено' : 'выключено') : undefined
    default: return undefined
  }
}

/** Подпись режима генератора по полю сценария `macro_mode` (JSON MacroMode | имя | пусто = base). */
export function macroModeLabel(raw: string | undefined): string {
  if (!raw || raw === 'base') return 'base'
  try {
    const m = JSON.parse(raw) as { mode?: string; stress?: Record<string, unknown> | null }
    if (!m.mode || m.mode === 'base') return 'base'
    if (m.stress && 'regime' in m.stress) return `режим ${m.stress.regime} навязан`
    if (m.stress && 'quantile_t' in m.stress) return `квантиль ${m.stress.quantile_t}`
    if (m.stress && 'episode' in m.stress) return `эпизод ${m.stress.episode}`
    return m.mode
  } catch {
    return raw
  }
}

function provenanceOf(def: ParamDef, value: number | string | null, hasSource: boolean, server: PassportParam | undefined): Provenance {
  if (def.stage && def.stage !== 'done') return 'default'
  const fromServer = server ? provenanceFromStatus(server.status) : null
  // Пользовательские поля (значение по умолчанию кода, редактируемые) — «вручную», если отошли от умолчания.
  const userField = def.editable && (def.provenance === 'default' || def.provenance === 'manual')
  if (userField) {
    if (!hasSource || value === null) return fromServer ?? 'default'
    const differs = def.defaultValue === undefined || String(value) !== String(def.defaultValue)
    return differs ? 'manual' : (fromServer ?? 'default')
  }
  if (fromServer) return fromServer
  if (def.provenance === 'estimated') return value === null ? 'default' : 'estimated'
  return def.provenance
}

function outOfRange(def: ParamDef, value: number | string | null): boolean {
  if (!def.range || typeof value !== 'number') return false
  return value < def.range[0] || value > def.range[1]
}

export function buildPassport(def: ParamDef, input: DeriveInput): ParameterPassport {
  const live = liveValue(def, input)
  const hasSource = live !== undefined
  const value = live === undefined ? (def.defaultValue ?? null) : live
  const server = def.passportCode ? input.passport?.[def.passportCode] : undefined
  const provenance = provenanceOf(def, value, hasSource, server)
  const runAt = def.owner === 'run' && input.plan.builtAt ? new Date(input.plan.builtAt).toISOString() : undefined
  const serverAt = server?.updated_at ? server.updated_at.replace(' ', 'T') : undefined
  const note = [def.note, server?.note].filter((t) => t && t.trim()).join(' ') || undefined
  return {
    id: def.id, label: def.label, unit: def.unit, value, provenance, owner: def.owner,
    range: def.range, step: def.step, editable: def.editable, screen: def.screen, note,
    stage: def.stage, outOfRange: outOfRange(def, value), estimatedAt: runAt ?? serverAt,
    status: server?.status, passportCode: def.passportCode, sourceText: server?.source || undefined,
    fileRef: server?.file_ref || undefined, deprecated: def.deprecated,
  }
}

export function derivePassports(input: DeriveInput): Record<string, ParameterPassport> {
  return Object.fromEntries(PARAM_LIST.map((def) => [def.id, buildPassport(def, input)]))
}
