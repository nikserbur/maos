/**
 * Элементы командной палитры (commandIndex.ts): экраны рельсы, узлы карты методологии (подблоки и
 * формулы), прогоны плана из кэша этой машины и действия оболочки. Собираются при открытии палитры.
 */
import { NODES } from '../features/method-map/registry'
import { blockTag } from '../features/method-map/blocks'
import { planActions, readPlanCache } from '../features/plan/planStore'
import { dateTime, hours } from '../explain/format'
import type { CommandItem } from './commandIndex'
import { overlayActions } from './overlays'
import { navigateTo } from './router'
import { NAV_GROUP_LABEL, SCREENS } from './screens'
import { setTheme, getTheme } from './theme'

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

export function buildCommandItems(): CommandItem[] {
  const screens: CommandItem[] = SCREENS.map((s) => ({
    id: `s:${s.id}`, group: 'screen', title: s.label, hint: s.group ? NAV_GROUP_LABEL[s.group] : undefined,
    keywords: [s.id, s.short ?? ''], href: `#/${s.id}`,
  }))
  const nodes: CommandItem[] = NODES.filter((n) => n.kind === 'subblock' || n.kind === 'block' || n.kind === 'formula').map((n) => ({
    id: `n:${n.id}`, group: 'node', title: n.title, hint: `${blockTag(n.block)} · ${n.kind === 'formula' ? 'формула' : n.kind === 'block' ? 'блок' : 'подблок'}`,
    keywords: [n.id, n.metricId ?? '', n.paramId ?? ''], href: `#/map/${n.id}`,
  }))
  const runs: CommandItem[] = readPlanCache(storage()).map((c) => ({
    id: `r:${c.planId}`, group: 'run', title: `Прогон ${c.result.rule} · ${dateTime(c.builtAt)}`,
    hint: `E[Cmax] ${hours(c.result.kpi.makespan_mean, 0)} · ${c.result.n_orders} заказов`, keywords: [c.planId, 'план', 'plan', 'run'],
    run: () => { planActions.openCached(c.planId, storage()); navigateTo('plan') },
  }))
  const actions: CommandItem[] = [
    { id: 'a:new-plan', group: 'action', title: 'Новый план — мастер', keywords: ['plan', 'wizard', 'создать'], href: '#/plan/new/program' },
    { id: 'a:theme', group: 'action', title: 'Переключить тему', keywords: ['theme', 'dark', 'light', 'тёмная', 'светлая'],
      run: () => setTheme(getTheme() === 'light' ? 'dark' : 'light') },
    { id: 'a:mentat', group: 'action', title: 'Спросить MENTAT: почему так', keywords: ['llm', 'mentat', 'объяснение', 'why'], run: () => overlayActions.openMentat() },
    { id: 'a:guard', group: 'action', title: 'Полномочия агента и единый α', keywords: ['guardrails', 'alpha', 'агент', 'rl'], href: '#/agents' },
  ]
  return [...actions, ...screens, ...runs, ...nodes]
}
