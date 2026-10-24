/**
 * Элементы командной палитры (commandIndex.ts): недавние адреса, экраны рельсы (каноническое имя из
 * screens.tsx + синонимы), сценарии, реестры НСИ, прогоны плана из кэша этой машины, действия и
 * узлы карты методологии. Собираются при открытии палитры.
 */
import { NODES } from '../features/method-map/registry'
import { blockTag } from '../features/method-map/blocks'
import { REGISTRIES } from '../features/nsi/registries'
import { planActions, readPlanCache } from '../features/plan/planStore'
import { dateTimeShort, hours, runLabel } from '../explain/format'
import { ruleLabel } from '../explain/labels'
import type { CommandItem } from './commandIndex'
import { setDecisionContext } from './context'
import { overlayActions } from './overlays'
import { navigateTo } from './router'
import { NAV_GROUP_LABEL, SCREENS } from './screens'
import { setTheme, getTheme } from './theme'

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

/* ── Недавние адреса (последние 5 маршрутов, localStorage) ───────────────── */

const RECENT_KEY = 'maos.recent-routes'
const RECENT_MAX = 5

export interface RecentRoute { hash: string; title: string }

export function readRecentRoutes(store: Pick<Storage, 'getItem'> | null = storage()): RecentRoute[] {
  try {
    const raw = store?.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is RecentRoute => !!r && typeof r === 'object' && typeof (r as RecentRoute).hash === 'string' && typeof (r as RecentRoute).title === 'string')
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

/** Запомнить посещённый адрес (повтор поднимается наверх). */
export function recordRecentRoute(hash: string, title: string, store: Pick<Storage, 'getItem' | 'setItem'> | null = storage()): void {
  if (!hash || !title) return
  const next = [{ hash, title }, ...readRecentRoutes(store).filter((r) => r.hash !== hash)].slice(0, RECENT_MAX)
  try { store?.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* приватный режим — без «Недавних» */ }
}

export interface CommandSources {
  /** Сценарии из кэша справочников (useRefs): id и имя. */
  scenarios?: ReadonlyArray<{ id: string; name: string }>
}

export function buildCommandItems(sources: CommandSources = {}): CommandItem[] {
  const recent: CommandItem[] = readRecentRoutes().map((r, i) => ({
    id: `h:${i}:${r.hash}`, group: 'recent', title: r.title, keywords: [r.hash], href: r.hash,
  }))
  const screens: CommandItem[] = SCREENS.map((s) => ({
    id: `s:${s.id}`, group: 'screen', title: s.label, hint: s.group ? NAV_GROUP_LABEL[s.group] : undefined,
    keywords: [s.id, s.short ?? '', ...(s.keywords ?? [])], href: `#/${s.id}`,
  }))
  const scenarios: CommandItem[] = (sources.scenarios ?? []).map((sc) => ({
    id: `c:${sc.id}`, group: 'scenario', title: sc.name || 'Сценарий без имени', hint: 'сценарий', keywords: ['сценарий', 'scenario'],
    run: () => { setDecisionContext({ scenarioId: sc.id }); navigateTo('scenarios', sc.id) },
  }))
  const registries: CommandItem[] = REGISTRIES.map((r) => ({
    id: `g:${r.id}`, group: 'registry', title: r.title, hint: 'справочник', keywords: [r.id, 'нси', 'справочник'], href: `#/nsi/${r.id}`,
  }))
  const nodes: CommandItem[] = NODES.filter((n) => n.kind === 'subblock' || n.kind === 'block' || n.kind === 'formula').map((n) => ({
    id: `n:${n.id}`, group: 'node', title: n.title, hint: `${blockTag(n.block)} · ${n.kind === 'formula' ? 'формула' : n.kind === 'block' ? 'блок' : 'подблок'}`,
    keywords: [n.id, n.metricId ?? '', n.paramId ?? ''], href: `#/map/${n.id}`,
  }))
  const runs: CommandItem[] = readPlanCache(storage()).map((c) => ({
    id: `r:${c.planId}`, group: 'run',
    title: runLabel({ id: c.planId, rule: ruleLabel(c.result.rule), createdAt: c.builtAt }),
    hint: `E[Cmax] ${hours(c.result.kpi.makespan_mean, 0)} · ${c.result.n_orders} заказов · ${dateTimeShort(c.builtAt)}`, keywords: [c.planId, 'план', 'plan', 'run'],
    run: () => { planActions.openCached(c.planId, storage()); navigateTo('plan') },
  }))
  const actions: CommandItem[] = [
    { id: 'a:new-plan', group: 'action', title: 'Новый план — мастер', keywords: ['plan', 'wizard', 'создать'], href: '#/plan/new/program' },
    { id: 'a:mentat', group: 'action', title: 'Спросить MENTAT: почему так', keywords: ['llm', 'mentat', 'объяснение', 'why'], run: () => overlayActions.openMentat(), shortcut: 'mod+j' },
    { id: 'a:theme', group: 'action', title: 'Переключить тему', keywords: ['theme', 'dark', 'light', 'тёмная', 'светлая'],
      run: () => setTheme(getTheme() === 'light' ? 'dark' : 'light') },
    { id: 'a:guard', group: 'action', title: 'Агенты: полномочия и уровень риска α', keywords: ['guardrails', 'alpha', 'агент', 'rl', 'полномочия'], href: '#/agents' },
  ]
  return [...recent, ...actions, ...screens, ...scenarios, ...registries, ...runs, ...nodes]
}
