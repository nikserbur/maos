/**
 * Адрес экрана «Сценарии» (X2 «адрес — это состояние», F5 восстанавливает вид):
 *  - `#/scenarios/<id>/<вкладка>` — открытый сценарий и вкладка;
 *  - `#/scenarios/<вкладка>` — старые ссылки карты и мастера: вкладка рабочего сценария;
 *  - `#/scenarios/compare/<id>,<id>` — сравнение (до 5 колонок).
 * Открытый сценарий: адрес → рабочий (контекст решения) → первый. Просмотр рабочий не меняет.
 * Чистые функции — vitest.
 */
import { anchorParts, joinAnchor } from '../../shell/router'

export type ScenarioTab = 'conditions' | 'distributions' | 'forecast'
export const SCENARIO_TABS: readonly ScenarioTab[] = ['conditions', 'distributions', 'forecast']
/** Имена вкладок — одни для вкладки, крошек верхней панели и ссылок («Прогноз цен» — у любого сценария; прогноз/что если — чипом внутри). */
export const SCENARIO_TAB_TITLES: Readonly<Record<ScenarioTab, string>> = { conditions: 'Условия', distributions: 'Распределения', forecast: 'Прогноз цен' }
export const DEFAULT_TAB: ScenarioTab = 'conditions'
/** Сравнение — не больше пяти колонок (читаемость и время расчёта портфелей). */
export const MAX_COMPARE = 5
export const COMPARE = 'compare'

export interface ScenarioRoute {
  compare: boolean
  /** id из адреса (null — не указан). */
  id: string | null
  tab: ScenarioTab
  /** Отмеченные к сравнению. */
  ids: string[]
}

export const isTab = (s: string | null | undefined): s is ScenarioTab => (SCENARIO_TABS as readonly string[]).includes(s ?? '')

export function parseScenarioAnchor(anchor: string | null | undefined): ScenarioRoute {
  const parts = anchorParts(anchor)
  if (parts[0] === COMPARE) {
    const ids = (parts[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    return { compare: true, id: null, tab: DEFAULT_TAB, ids: [...new Set(ids)].slice(0, MAX_COMPARE) }
  }
  if (parts.length === 0) return { compare: false, id: null, tab: DEFAULT_TAB, ids: [] }
  if (isTab(parts[0])) return { compare: false, id: null, tab: parts[0], ids: [] }
  return { compare: false, id: parts[0], tab: isTab(parts[1]) ? parts[1] : DEFAULT_TAB, ids: [] }
}

export function scenarioAnchor(id: string, tab: ScenarioTab = DEFAULT_TAB): string {
  return joinAnchor(id, tab)
}

export function compareAnchor(ids: readonly string[]): string {
  const uniq = [...new Set(ids)].slice(0, MAX_COMPARE)
  return uniq.length ? joinAnchor(COMPARE, uniq.join(',')) : COMPARE
}

/** Рабочий сценарий: из контекста решения, если он есть в списке, иначе первый. */
export function workingIdOf(ctxId: string | undefined, ids: readonly string[]): string {
  return ctxId && ids.includes(ctxId) ? ctxId : ids[0] ?? ''
}

/** Открытый сценарий: адрес → рабочий → первый (неизвестный id из адреса пропускается). */
export function resolveOpenId(routeId: string | null, ctxId: string | undefined, ids: readonly string[]): string {
  if (routeId && ids.includes(routeId)) return routeId
  return workingIdOf(ctxId, ids)
}

/** Вход в сравнение: рабочий и открытый (если это разные сценарии). */
export function initialCompare(workingId: string, openId: string): string[] {
  return [...new Set([workingId, openId].filter(Boolean))]
}

/** Отметить/снять сценарий в сравнении; шестой не добавляется. */
export function toggleCompare(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id)
  return ids.length >= MAX_COMPARE ? [...ids] : [...ids, id]
}
