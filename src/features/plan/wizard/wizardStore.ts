/**
 * Хранилище мастера плана (UX-V2 §4): 6 шагов (результат живёт по своему адресу `#/plan/run/<id>`),
 * источник программы, унаследованные значения («база» — из сценария / портфеля / НСИ с подписью
 * владельца) и переопределения на прогон (`owner: 'run'`). Ничего не пишется в НСИ/сценарий молча:
 * правка на шаге — только override, «Сохранить в проект» — отдельное явное действие экрана.
 * Черновик мастера (шаг, источник, переопределения) переживает F5 — localStorage, best-effort.
 * Иммутабельно, useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'
import type { DiffRow } from '../../../ui/DiffList'
import { CRITERIA, type Crit } from '../types'
import type { RunParams } from '../runMeta'

export type WizardStep = 'program' | 'conditions' | 'distributions' | 'constraints' | 'objective' | 'launch'
export const WIZARD_STEPS: readonly WizardStep[] = ['program', 'conditions', 'distributions', 'constraints', 'objective', 'launch']

export type ProgramSource = 'portfolio' | 'orders' | 'manual'
export type RiskPreset = 'time' | 'money' | 'balance' | 'expert'
export type CashCriterion = 'profit' | 'cash' | 'both'

export interface WizardOrder {
  id?: string
  product_id: string
  qty: number
  /** Календарные часы от начала горизонта (техническое поле; UI показывает дату). */
  due_hours: number
  priority: number
}

/** Поля прогона, у которых есть унаследованное значение и возможное переопределение. */
export interface WizardFields {
  rule: string
  samples: number
  wTime: number
  wRisk: number
  wCost: number
  /** Один α на портфель, план и кассу — из сценария. */
  alpha: number
  objective: string
  useCalendar: boolean
  /** null — задаёт планировщик (паспорт r1.03). */
  tailWeight: number | null
  /** Слой F: порог ликвидности и β хвоста кассы. */
  lMin: number
  beta: number
  cashCriterion: CashCriterion
  financing: 'recourse' | 'first'
}

export type FieldKey = keyof WizardFields

export const FIELD_LABEL: Readonly<Record<FieldKey, string>> = {
  rule: 'Метод поиска порядка', samples: 'Прогонов Монте-Карло', wTime: 'Вес срока', wRisk: 'Вес хвоста риска',
  wCost: 'Вес переналадок', alpha: 'α хвоста', objective: 'Критерий портфеля', useCalendar: 'Календарь смен',
  tailWeight: 'Доля операций с тяжёлым хвостом', lMin: 'Порог ликвидности L_min', beta: 'β хвоста кассы', cashCriterion: 'Критерий кассы',
  financing: 'Финансирование кассы',
}

/** Шаг, на котором правится поле (для переходов из диффа). */
export const FIELD_STEP: Readonly<Record<FieldKey, WizardStep>> = {
  rule: 'objective', samples: 'objective', wTime: 'objective', wRisk: 'objective', wCost: 'objective', alpha: 'objective',
  objective: 'objective', useCalendar: 'constraints', tailWeight: 'distributions', lMin: 'constraints', beta: 'constraints',
  cashCriterion: 'objective', financing: 'objective',
}

export const DEFAULT_FIELDS: WizardFields = {
  rule: 'auto', samples: 500, wTime: 1, wRisk: 0.5, wCost: 0, alpha: 0.1, objective: 'cvar', useCalendar: true,
  tailWeight: null, lMin: 0, beta: 0.05, cashCriterion: 'profit', financing: 'recourse',
}

/** Пресеты склонности к риску (UX-V2 §4.2 шаг 5) — нормативные наборы весов для интерфейса. */
export const RISK_PRESETS: Readonly<Record<Exclude<RiskPreset, 'expert'>, Pick<WizardFields, 'wTime' | 'wRisk' | 'wCost' | 'cashCriterion'>>> = {
  time: { wTime: 1, wRisk: 0.5, wCost: 0, cashCriterion: 'profit' },
  money: { wTime: 0.5, wRisk: 0.5, wCost: 1, cashCriterion: 'both' },
  balance: { wTime: 1, wRisk: 1, wCost: 0.5, cashCriterion: 'both' },
}

export interface WizardState {
  step: WizardStep
  source: ProgramSource
  /** Прогон Стадии 2 (портфель) — источник программы. */
  runId: string
  /** Производственный план (реестр заказов). */
  planId: string
  scenarioId: string
  manualOrders: readonly WizardOrder[]
  /** Начало горизонта ISO; null → запасная дата (сегодня), подписывается честно. */
  startDate: string | null
  base: WizardFields
  /** Владелец унаследованного значения по полю: «из сценария «Базовый»», «из НСИ», «умолчание». */
  owners: Readonly<Partial<Record<FieldKey, string>>>
  overrides: Readonly<Partial<WizardFields>>
  preset: RiskPreset
  crits: readonly Crit[]
  visited: ReadonlySet<WizardStep>
}

const initial = (): WizardState => ({
  step: 'program', source: 'orders', runId: '', planId: '', scenarioId: '', manualOrders: [], startDate: null,
  base: DEFAULT_FIELDS, owners: {}, overrides: {}, preset: 'time', crits: [{ criterion: 'duration', dir: -1, weight: 1 }],
  visited: new Set(['program']),
})

let state: WizardState = initial()
const listeners = new Set<() => void>()

function commit(next: WizardState): void {
  if (next === state) return
  state = next
  saveDraft(next)
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const getSnapshot = (): WizardState => state

export function useWizard(): WizardState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function getWizardState(): WizardState {
  return state
}

/* ── Чистые функции (тестируются) ───────────────────────────────────────── */

/** Эффективные значения: база + переопределения. */
export function effectiveFields(s: Pick<WizardState, 'base' | 'overrides'>): WizardFields {
  return { ...s.base, ...s.overrides }
}

const same = (a: unknown, b: unknown): boolean => String(a ?? '') === String(b ?? '')

/** Переопределение «изменило» поле, только если отличается от базы. */
export function isChanged(s: Pick<WizardState, 'base' | 'overrides'>, key: FieldKey): boolean {
  return key in s.overrides && !same(s.overrides[key], s.base[key])
}

export interface DiffInput extends Pick<WizardState, 'base' | 'overrides' | 'owners'> {
  format?: (key: FieldKey, v: WizardFields[FieldKey]) => string
}

/** Дифф «наследовано / изменено / не задано» для шага «Запуск» (UX-V2 §4.2 шаг 6). */
export function diffFields(s: DiffInput): DiffRow[] {
  const fmt = s.format ?? ((_k, v) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'вкл' : 'выкл') : String(v)))
  const eff = effectiveFields(s)
  return (Object.keys(FIELD_LABEL) as FieldKey[]).map((key) => {
    const changed = isChanged(s, key)
    const value = eff[key]
    const unset = !changed && (value === null || value === undefined)
    return {
      key, label: FIELD_LABEL[key], step: FIELD_STEP[key],
      owner: changed ? 'этот прогон' : s.owners[key] ?? 'умолчание',
      value: fmt(key, value), base: changed ? fmt(key, s.base[key]) : undefined,
      origin: changed ? 'changed' : unset ? 'unset' : 'inherited',
    }
  })
}

export interface StepReadiness {
  programOk: boolean
  scenarioOk: boolean
  finOk: boolean
  running: boolean
}

/** Состояние шага для степпера (глифы как на карте). */
export function stepState(s: WizardState, step: WizardStep, r: StepReadiness): 'done' | 'warn' | 'default' | 'empty' | 'running' {
  const changedOn = (st: WizardStep) => (Object.keys(FIELD_STEP) as FieldKey[]).some((k) => FIELD_STEP[k] === st && isChanged(s, k))
  switch (step) {
    case 'program': return r.programOk ? 'done' : 'empty'
    case 'conditions': return r.scenarioOk ? 'done' : 'warn'
    case 'distributions': return changedOn('distributions') ? 'done' : 'default'
    case 'constraints': return !r.finOk ? 'warn' : changedOn('constraints') ? 'done' : 'default'
    case 'objective': return s.visited.has('objective') || changedOn('objective') ? 'done' : 'default'
    case 'launch': return r.running ? 'running' : r.programOk ? 'default' : 'empty'
  }
}

/* ── Черновик мастера в localStorage (переживает F5; ошибки хранилища не мешают работе) ── */

export const WIZARD_DRAFT_KEY = 'maos.plan.wizard'

type Draft = Pick<WizardState, 'step' | 'source' | 'runId' | 'planId' | 'scenarioId' | 'manualOrders' | 'overrides' | 'preset' | 'crits' | 'startDate'>

const SOURCES: readonly ProgramSource[] = ['portfolio', 'orders', 'manual']
const PRESETS: readonly RiskPreset[] = ['time', 'money', 'balance', 'expert']
const CRIT_KEYS = new Set(CRITERIA.map((c) => c.id))
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Разбор черновика с проверкой формы: мусор → null (старт с нуля). */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<Record<keyof Draft, unknown>>
    if (!d || typeof d !== 'object') return null
    const step = WIZARD_STEPS.includes(d.step as WizardStep) ? (d.step as WizardStep) : 'program'
    const source = SOURCES.includes(d.source as ProgramSource) ? (d.source as ProgramSource) : 'orders'
    const preset = PRESETS.includes(d.preset as RiskPreset) ? (d.preset as RiskPreset) : 'time'
    const orders = Array.isArray(d.manualOrders) ? (d.manualOrders as WizardOrder[]).filter((o) => o && typeof o.product_id === 'string' && Number.isFinite(o.qty)) : []
    const crits = Array.isArray(d.crits) ? (d.crits as Crit[]).filter((c) => c && CRIT_KEYS.has(c.criterion) && Number.isFinite(c.weight)) : []
    const overrides = d.overrides && typeof d.overrides === 'object' ? pickKnown(d.overrides as Record<string, unknown>) : {}
    return {
      step, source, preset, runId: str(d.runId), planId: str(d.planId), scenarioId: str(d.scenarioId), manualOrders: orders,
      crits: crits.length ? crits : [{ criterion: 'duration', dir: -1, weight: 1 }], overrides,
      startDate: typeof d.startDate === 'string' ? d.startDate : null,
    }
  } catch {
    return null
  }
}

/** Только известные поля прогона того же типа, что и умолчание. */
function pickKnown(o: Record<string, unknown>): Partial<WizardFields> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(DEFAULT_FIELDS) as FieldKey[]) {
    const v = o[k]
    const def = DEFAULT_FIELDS[k]
    if (v === undefined) continue
    if (def === null ? typeof v === 'number' || v === null : typeof v === typeof def) out[k] = v
  }
  return out as Partial<WizardFields>
}

const draftOf = (s: WizardState): Draft => ({
  step: s.step, source: s.source, runId: s.runId, planId: s.planId, scenarioId: s.scenarioId, manualOrders: s.manualOrders,
  overrides: s.overrides, preset: s.preset, crits: s.crits, startDate: s.startDate,
})

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function saveDraft(s: WizardState): void {
  const st = storage()
  if (!st) return
  try {
    st.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draftOf(s)))
  } catch {
    // квота или приватный режим: черновик просто не переживёт F5
  }
}

function loadDraft(): Partial<WizardState> {
  const st = storage()
  if (!st) return {}
  try {
    return parseDraft(st.getItem(WIZARD_DRAFT_KEY)) ?? {}
  } catch {
    return {}
  }
}

// Подъём черновика после объявления всех констант разбора (порядок модуля важен).
state = { ...state, ...loadDraft() }

/* ── Действия ──────────────────────────────────────────────────────────── */

export const wizardActions = {
  setStep(step: WizardStep): void {
    if (state.step === step) return
    const visited = new Set(state.visited)
    visited.add(step)
    commit({ ...state, step, visited })
  },
  next(): void {
    const i = WIZARD_STEPS.indexOf(state.step)
    if (i < WIZARD_STEPS.length - 1) wizardActions.setStep(WIZARD_STEPS[i + 1])
  },
  prev(): void {
    const i = WIZARD_STEPS.indexOf(state.step)
    if (i > 0) wizardActions.setStep(WIZARD_STEPS[i - 1])
  },
  setSource(source: ProgramSource): void {
    if (state.source === source) return
    commit({ ...state, source })
  },
  setRunId(runId: string): void {
    if (state.runId === runId) return
    commit({ ...state, runId })
  },
  setPlanId(planId: string): void {
    if (state.planId === planId) return
    commit({ ...state, planId })
  },
  setScenarioId(scenarioId: string): void {
    if (state.scenarioId === scenarioId) return
    commit({ ...state, scenarioId })
  },
  setStartDate(startDate: string | null): void {
    if (state.startDate === startDate) return
    commit({ ...state, startDate })
  },
  setManualOrders(manualOrders: readonly WizardOrder[]): void {
    commit({ ...state, manualOrders })
  },
  /** Обновить унаследованную базу (из сценария/портфеля/НСИ) с владельцем; переопределения сохраняются. */
  setBase(patch: Partial<WizardFields>, owner: string): void {
    const base = { ...state.base, ...patch }
    const owners = { ...state.owners }
    for (const k of Object.keys(patch) as FieldKey[]) owners[k] = owner
    const unchanged = (Object.keys(patch) as FieldKey[]).every((k) => same(base[k], state.base[k]) && state.owners[k] === owner)
    if (unchanged) return
    commit({ ...state, base, owners })
  },
  setOverride<K extends FieldKey>(key: K, value: WizardFields[K]): void {
    if (same(state.overrides[key], value) && key in state.overrides) return
    commit({ ...state, overrides: { ...state.overrides, [key]: value } })
  },
  revert(key: FieldKey): void {
    if (!(key in state.overrides)) return
    const { [key]: _dropped, ...rest } = state.overrides
    commit({ ...state, overrides: rest })
  },
  /** Пресет склонности к риску: веса пишутся как переопределения прогона; «Экспертно» их не трогает. */
  applyPreset(preset: RiskPreset): void {
    if (preset === 'expert') { commit({ ...state, preset }); return }
    commit({ ...state, preset, overrides: { ...state.overrides, ...RISK_PRESETS[preset] } })
  },
  setCrits(crits: readonly Crit[]): void {
    commit({ ...state, crits })
  },
  /** Новый поток из портфеля («Передать в План»): источник и прогон, остальное — заново. */
  startFromPortfolio(runId: string, scenarioId: string): void {
    commit({ ...initial(), source: 'portfolio', runId, scenarioId })
  },
  /** «Новый план» / «Повторить»: параметры прошлого прогона как черновик (база выводится заново). */
  prefill(p: RunParams, step: WizardStep = 'program'): void {
    commit({
      ...state, step, source: p.source, runId: p.runId, planId: p.planId, scenarioId: p.scenarioId, manualOrders: [...p.manualOrders],
      overrides: pickKnown(p.overrides as Record<string, unknown>), preset: p.preset, crits: p.crits.length ? [...p.crits] : state.crits,
      startDate: p.startDate, visited: new Set([...state.visited, step]),
    })
  },
  reset(): void {
    commit(initial())
  },
}
