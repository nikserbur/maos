/**
 * Полномочия агента (UX-V2 §4.10): чистые функции над `AgentGuardrails` — умолчания, строки карточки
 * (вид хода · маска · доступность), лимиты пакета, персональные маски (заморозки и отклонения с
 * причиной) и перенос α из сценария («один α на всех»). Хранение — guardrailsStore.ts.
 */
import type { AgentGuardrails, MoveKind, StructuralMove } from '../../lib/api'
import { MOVE_KINDS, canonicalKind, type MoveKindMeta } from '../plan/moves/moveKinds'

export const DEFAULT_LIMITS: AgentGuardrails['limits'] = { max_moves: 12, max_orders_share: 0.3, max_shift_days: 10, max_outsource_share: 0.15 }

export const OBJECTIVE_LABEL: Readonly<Record<AgentGuardrails['objective'], string>> = {
  cvar_profit: 'CVaR прибыли',
  cvar_profit_cash: 'CVaR прибыли + CVaR кассы',
  cvar_cash: 'только касса',
}

/** Умолчания: разрешено всё реализованное, «перенос цеха» и «отказ» выключены (запланированы), α — из сценария. */
export function defaultGuardrails(alpha: number): AgentGuardrails {
  const allowed: Record<string, boolean> = {}
  for (const m of MOVE_KINDS) allowed[m.kind] = m.readiness !== 'planned'
  return { alpha, objective: 'cvar_profit_cash', allowed, limits: DEFAULT_LIMITS, frozen: [], rejected_masks: [], owner: 'project' }
}

/** Доступность вида хода: доступно · нужны данные Справочников · запланировано. */
export type KindAvailability = 'available' | 'nsi' | 'planned'

/**
 * Единственная карта «состояние → глиф и слово» (X2 «цвет — одна работа»): нормальное «доступно» —
 * простым текстом без глифа и чипа; отклонения — глиф + слово (▲ — нужны данные, ○ — запланировано).
 */
export const AVAILABILITY: Readonly<Record<KindAvailability, { word: string; glyph: 'glyph-setup' | 'glyph-idle' | null; href?: string }>> = {
  available: { word: 'доступно', glyph: null },
  nsi: { word: 'нужны данные Справочников', glyph: 'glyph-setup', href: '#/nsi' },
  planned: { word: 'запланировано', glyph: 'glyph-idle' },
}

export interface GuardrailRow {
  meta: MoveKindMeta
  /** Разрешён и может применяться (выключен, если заблокирован). */
  on: boolean
  /** Переключатель заблокирован: ход запланирован или в Справочниках нет данных. */
  locked: boolean
  availability: KindAvailability
  /** Почему заблокирован — простыми словами (подсказка переключателя). */
  reason?: string
}

/** Строки таблицы видов ходов: все канонические виды в порядке §4.7.1 с текущим разрешением. */
export function guardrailRows(g: AgentGuardrails, nsiAllowed?: Readonly<Record<string, boolean>>): GuardrailRow[] {
  return MOVE_KINDS.map((meta) => {
    const planned = meta.readiness === 'planned'
    const nsi = nsiAllowed ? nsiAllowed[meta.kind] !== false : meta.readiness !== 'nsi'
    const availability: KindAvailability = planned ? 'planned' : nsi ? 'available' : 'nsi'
    const locked = availability !== 'available'
    const reason = planned ? 'запланировано — пока не реализовано' : !nsi ? (meta.note ?? 'в Справочниках нет нужных данных') : undefined
    return { meta, on: Boolean(g.allowed[meta.kind]) && !locked, locked, availability, reason }
  })
}

export function toggleKind(g: AgentGuardrails, kind: MoveKind, on: boolean): AgentGuardrails {
  const k = canonicalKind(kind)
  if (Boolean(g.allowed[k]) === on) return g
  return { ...g, allowed: { ...g.allowed, [k]: on } }
}

export function setLimit<K extends keyof AgentGuardrails['limits']>(g: AgentGuardrails, key: K, value: number): AgentGuardrails {
  if (!Number.isFinite(value) || g.limits[key] === value) return g
  return { ...g, limits: { ...g.limits, [key]: value } }
}

export function setObjective(g: AgentGuardrails, objective: AgentGuardrails['objective']): AgentGuardrails {
  return g.objective === objective ? g : { ...g, objective }
}

/** α всегда из сценария; переопределение на прогон помечается owner: 'run'. */
export function withAlpha(g: AgentGuardrails, alpha: number, owner: AgentGuardrails['owner'] = 'project'): AgentGuardrails {
  return g.alpha === alpha && g.owner === owner ? g : { ...g, alpha, owner }
}

/** Отклонение с причиной становится персональной маской («не предлагать отказ от заказа #9»). */
export function addRejectedMask(g: AgentGuardrails, move: StructuralMove, reason: string): AgentGuardrails {
  const dup = g.rejected_masks.some((m) => m.kind === move.kind && JSON.stringify(m.targets) === JSON.stringify(move.targets))
  if (dup) return g
  return { ...g, rejected_masks: [...g.rejected_masks, { kind: move.kind, targets: move.targets, reason }] }
}

export function addFrozen(g: AgentGuardrails, move: StructuralMove, reason?: string): AgentGuardrails {
  const t = move.targets
  const entries: AgentGuardrails['frozen'] = []
  for (const op of t.op_ids ?? []) entries.push({ op_id: op, reason })
  for (const o of t.order_idx ?? []) entries.push({ order_idx: o, reason })
  for (const m of t.machine_ids ?? []) entries.push({ machine_id: m, reason })
  const key = (f: AgentGuardrails['frozen'][number]) => `${f.op_id ?? ''}|${f.order_idx ?? ''}|${f.machine_id ?? ''}`
  const have = new Set(g.frozen.map(key))
  const fresh = entries.filter((e) => !have.has(key(e)))
  return fresh.length ? { ...g, frozen: [...g.frozen, ...fresh] } : g
}

export function clearFrozen(g: AgentGuardrails): AgentGuardrails {
  return g.frozen.length ? { ...g, frozen: [] } : g
}

export function removeRejectedMask(g: AgentGuardrails, index: number): AgentGuardrails {
  if (index < 0 || index >= g.rejected_masks.length) return g
  return { ...g, rejected_masks: g.rejected_masks.filter((_m, i) => i !== index) }
}

/** Виды, которые агент не предложит ни разу: выключенные пользователем (без «в плане»). */
export function disabledKinds(g: AgentGuardrails): MoveKind[] {
  return MOVE_KINDS.filter((m) => m.readiness !== 'planned' && !g.allowed[m.kind]).map((m) => m.kind)
}

/** Безопасный разбор значения из prefs/localStorage: чужие поля отбрасываются, недостающие — из умолчаний. */
export function parseGuardrails(raw: unknown, alpha: number): AgentGuardrails | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const base = defaultGuardrails(alpha)
  const allowed = r.allowed && typeof r.allowed === 'object'
    ? Object.fromEntries(Object.entries(r.allowed as Record<string, unknown>).filter(([k, v]) => k in base.allowed && typeof v === 'boolean')) as Record<string, boolean>
    : {}
  const lim = r.limits && typeof r.limits === 'object' ? (r.limits as Record<string, unknown>) : {}
  const limits = { ...DEFAULT_LIMITS }
  for (const k of Object.keys(DEFAULT_LIMITS) as Array<keyof typeof DEFAULT_LIMITS>) if (typeof lim[k] === 'number') limits[k] = lim[k] as number
  const objective = r.objective === 'cvar_profit' || r.objective === 'cvar_cash' || r.objective === 'cvar_profit_cash' ? r.objective : base.objective
  return {
    ...base, objective, allowed: { ...base.allowed, ...allowed }, limits,
    frozen: Array.isArray(r.frozen) ? (r.frozen as AgentGuardrails['frozen']) : [],
    rejected_masks: Array.isArray(r.rejected_masks) ? (r.rejected_masks as AgentGuardrails['rejected_masks']) : [],
  }
}
