/**
 * Хранилище мастера плана (UX-V2 §4): 7 шагов, источник программы, унаследованные значения
 * («база» — из сценария / портфеля / НСИ с подписью владельца) и переопределения на прогон
 * (`owner: 'run'`). Ничего не пишется в НСИ/сценарий молча: правка на шаге — только override,
 * «Сохранить в проект» — отдельное явное действие экрана. Иммутабельно, useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'
import type { DiffRow } from '../../../ui/DiffList'
import type { Crit } from '../types'

export type WizardStep = 'program' | 'conditions' | 'distributions' | 'constraints' | 'objective' | 'launch' | 'result'
export const WIZARD_STEPS: readonly WizardStep[] = ['program', 'conditions', 'distributions', 'constraints', 'objective', 'launch', 'result']

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
  rule: 'Диспетчерское правило', samples: 'Прогонов хвоста', wTime: 'Вес срока w_time', wRisk: 'Вес риска w_risk',
  wCost: 'Вес стоимости w_cost', alpha: 'α хвоста', objective: 'Критерий', useCalendar: 'Календарь смен',
  tailWeight: 'Вес хвоста Парето', lMin: 'Порог ликвидности L_min', beta: 'β хвоста кассы', cashCriterion: 'Критерий кассы',
  financing: 'Финансирование',
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
      owner: changed ? 'этот прогон' : s.owners[key] ?? 'умолчание кода',
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
  hasResult: boolean
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
    case 'result': return r.hasResult ? 'done' : 'empty'
  }
}

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
  reset(): void {
    commit(initial())
  },
}
