import { lazy, type ComponentType } from 'react'
import type { BlockId } from '../features/method-map/types'
import { REGISTRIES } from '../features/nsi/registries'
import type { Crumb } from '../ui/kit/Breadcrumbs'
import { crumbTitle } from './crumbs'

/* Ленивые экраны: каждый — отдельный чанк. three.js (~1 МБ) грузится только при
 * открытии «Схемы предприятия», а не в стартовом бандле до логина. */
const PlantScene = lazy(() => import('../features/plant-scene'))
const NsiScreen = lazy(() => import('../features/nsi/NsiScreen').then((m) => ({ default: m.NsiScreen })))
const OptimizationScreen = lazy(() => import('../features/optimization/OptimizationScreen').then((m) => ({ default: m.OptimizationScreen })))
const ScenariosHub = lazy(() => import('../features/scenarios/ScenariosHub').then((m) => ({ default: m.ScenariosHub })))
const PlanScreen = lazy(() => import('../features/plan/PlanScreen').then((m) => ({ default: m.PlanScreen })))
const AgentsScreen = lazy(() => import('../features/agents/AgentsScreen').then((m) => ({ default: m.AgentsScreen })))
const MonitoringScreen = lazy(() => import('../features/forecast/ForecastScreen').then((m) => ({ default: m.ForecastScreen })))
const AnalyticsScreen = lazy(() => import('../features/analytics/AnalyticsScreen').then((m) => ({ default: m.AnalyticsScreen })))
const MapScreen = lazy(() => import('../features/method-map/MapScreen').then((m) => ({ default: m.MapScreen })))
const MethodologyScreen = lazy(() => import('../features/methodology/MethodologyScreen'))
const WorkflowBuilder = lazy(() => import('../features/workflow-builder/WorkflowBuilder').then((m) => ({ default: m.WorkflowBuilder })))
const AdminScreen = lazy(() => import('../features/admin/AdminScreen').then((m) => ({ default: m.AdminScreen })))

/** Группы рельсы по карте методологии (UX-V2 §2.3). */
export type NavGroup = 'model' | 'conditions' | 'decide' | 'observe' | 'explain' | 'system'

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  model: 'Модель',
  conditions: 'Условия',
  decide: 'Решения',
  observe: 'Наблюдение',
  explain: 'Объяснение',
  system: 'Система',
}

export interface ScreenDef {
  /** Сегмент hash-маршрута: `#/<id>[/<anchor>][?query]`. */
  id: string
  /**
   * Каноническое имя экрана — одно на всё приложение: рельса, верхняя панель (крошки), палитра,
   * document.title, ScreenHeader, MENTAT (X2 «одно имя — одна вещь»). Берите через screenTitle(id).
   */
  label: string
  /** Подпись под иконкой рельсы (≤ 11 символов): только сокращение label (префикс) или из SHORT_ALLOW. */
  short?: string
  /** Синонимы для палитры (латиница, прежние имена). */
  keywords?: readonly string[]
  icon: string
  /** Группа рельсы; без неё — группа предыдущего экрана. */
  group?: NavGroup
  /** Стадия двухуровневой модели: 2 — что выпускать, 1 — как выпускать. */
  stage?: 1 | 2
  /** Блоки карты методологии, которые реализует экран (PLAN-V2 §3). */
  blocks?: readonly BlockId[]
  /** Показывать полосу методологии (PipelineStrip) под верхней панелью. */
  pipeline?: boolean
  /** Вложенные маршруты экрана (`#/<id>/<anchor>`), которые экран разбирает сам; F5 восстанавливает тот же вид. */
  anchors?: readonly string[]
  /** Крошки после корня экрана для якоря: «Техкарты › ТК-12 Вал». */
  crumbs?: (anchor: string) => Crumb[]
  /** Экран зарезервирован: пункт рельсы есть, содержимое — «скоро» (волна). */
  soon?: string
  Component: ComponentType
}

/**
 * Реестр экранов по карте методологии (UX-V2 §2.3) — единственный источник имён экранов:
 * Модель (Схема · Справочники) → Условия (Сценарии [1][2]) → Решения (Портфель [4][5] ②,
 * План [3][4][5] ①, Агенты [6] — статус RL, гейт, полномочия, игры) → Наблюдение (Мониторинг [7], Аналитика [7]) →
 * Объяснение (Карта, Методика) → Система (AI-воркфлоу, Администрирование).
 * Стартовый экран после входа — «Схема» (решение владельца, UX-V2 §8).
 */
export const SCREENS: ScreenDef[] = [
  { id: 'scheme', label: 'Схема предприятия', short: 'Схема', icon: 'scheme', group: 'model', blocks: ['internal'],
    anchors: ['<factoryId>', '<factoryId>/<shopId>?sel=<объект>'], crumbs: (a) => objectCrumbs('scheme', a), Component: PlantScene },
  { id: 'nsi', label: 'Справочники', short: 'НСИ', keywords: ['нси', 'nsi', 'реестры', 'техкарты'], icon: 'nsi', group: 'model', blocks: ['internal', 'distributions'], pipeline: true,
    anchors: ['<реестр>', 'routing/<id|new>'], crumbs: nsiCrumbs, Component: NsiScreen },
  { id: 'scenarios', label: 'Сценарии', short: 'Сценарии', icon: 'scenarios', group: 'conditions', blocks: ['external', 'distributions', 'criteria'], pipeline: true,
    anchors: ['<вкладка>', '<id>/<вкладка>', 'compare/<id,id>'], crumbs: scenarioCrumbs, Component: ScenariosHub },
  { id: 'optimization', label: 'Портфель', short: 'Портфель', keywords: ['оптимизация', 'optimization', 'робастный', 'portfolio', 'стадия 2'], icon: 'optimization', group: 'decide', stage: 2, blocks: ['decisions', 'criteria'], pipeline: true, Component: OptimizationScreen },
  { id: 'plan', label: 'План', short: 'План', keywords: ['расписание', 'schedule', 'гант', 'стадия 1'], icon: 'plan', group: 'decide', stage: 1, blocks: ['internal', 'decisions', 'criteria'], pipeline: true,
    anchors: ['run/<id>', 'run/<id>/<раздел>', 'new', 'new/<шаг>'], crumbs: planCrumbs, Component: PlanScreen },
  { id: 'agents', label: 'Агенты', short: 'Агенты', keywords: ['rl', 'агент', 'гейт', 'полномочия'], icon: 'sparkle', group: 'decide', blocks: ['agents'], pipeline: true,
    anchors: ['<вкладка>'], crumbs: (a) => objectCrumbs('agents', a), Component: AgentsScreen },
  { id: 'monitoring', label: 'Мониторинг', short: 'Монитор', keywords: ['прогноз', 'forecast'], icon: 'monitoring', group: 'observe', blocks: ['monitoring', 'external'], pipeline: true, Component: MonitoringScreen },
  { id: 'analytics', label: 'Аналитика', short: 'Аналитика', keywords: ['kpi', 'отчёт'], icon: 'analytics', group: 'observe', blocks: ['monitoring'], pipeline: true,
    anchors: ['<вкладка>', '<вкладка>/<planId>'], crumbs: (a) => objectCrumbs('analytics', a), Component: AnalyticsScreen },
  { id: 'map', label: 'Карта методологии', short: 'Карта', keywords: ['граф', 'узлы', 'методология'], icon: 'graph', group: 'explain',
    anchors: ['<узел>'], crumbs: (a) => objectCrumbs('map', a, 'Узел карты'), Component: MapScreen },
  { id: 'methodology', label: 'Методика', short: 'Методика', keywords: ['формулы', 'диплом'], icon: 'book', group: 'explain', blocks: ['llm'],
    anchors: ['<раздел>'], crumbs: (a) => objectCrumbs('methodology', a), Component: MethodologyScreen },
  { id: 'aiflow', label: 'AI-воркфлоу', short: 'AI-воркфлоу', keywords: ['конструктор', 'workflow', 'llm', 'ai'], icon: 'workflow', group: 'system', blocks: ['llm'], Component: WorkflowBuilder },
  { id: 'admin', label: 'Администрирование', short: 'Админ', keywords: ['пользователи', 'аудит', 'журнал', 'admin'], icon: 'admin', group: 'system',
    anchors: ['?type=<журнал>&q=<поиск>'], Component: AdminScreen },
]

/** Подписи рельсы, которые не являются префиксом имени, но приняты как общеупотребительные. */
export const SHORT_ALLOW: Readonly<Record<string, string>> = { nsi: 'НСИ' }

/** Каноническое имя экрана по id (верхняя панель, ScreenHeader, палитра, document.title). */
export function screenTitle(id: string): string {
  return getScreen(id)?.label ?? id
}

/* ── Крошки по якорям ─────────────────────────────────────────────────────── */

const NSI_ROUTING = 'routing'

function nsiCrumbs(anchor: string): Crumb[] {
  const [seg, id] = anchor.split('/')
  const reg = REGISTRIES.find((r) => r.id === seg)
  if (!reg) return []
  if (seg === NSI_ROUTING && id) {
    const title = crumbTitle('nsi', anchor) ?? (id === 'new' ? 'Новая техкарта' : 'Техкарта')
    return [{ label: reg.title, href: '#/nsi/routing' }, { label: title }]
  }
  return [{ label: reg.title }]
}

const SCENARIO_TABS: Readonly<Record<string, string>> = { conditions: 'Условия', distributions: 'Распределения', forecast: 'Прогноз и проверка' }

function scenarioCrumbs(anchor: string): Crumb[] {
  const parts = anchor.split('/')
  if (parts[0] === 'compare') return [{ label: 'Сравнение сценариев' }]
  if (SCENARIO_TABS[parts[0]]) return [{ label: SCENARIO_TABS[parts[0]] }]
  const name = crumbTitle('scenarios', parts[0]) ?? 'Сценарий'
  return parts[1] && SCENARIO_TABS[parts[1]]
    ? [{ label: name, href: `#/scenarios/${encodeURIComponent(parts[0])}` }, { label: SCENARIO_TABS[parts[1]] }]
    : [{ label: name }]
}

const WIZARD_STEP_TITLES: Readonly<Record<string, string>> = {
  program: 'Программа', conditions: 'Условия', distributions: 'Распределения', constraints: 'Ограничения',
  objective: 'Цель и риск', launch: 'Запуск', result: 'Результат',
}

function planCrumbs(anchor: string): Crumb[] {
  const parts = anchor.split('/')
  if (parts[0] === 'new') {
    const step = parts[1] ? WIZARD_STEP_TITLES[parts[1]] : undefined
    return step ? [{ label: 'Новый план', href: '#/plan/new' }, { label: step }] : [{ label: 'Новый план' }]
  }
  if (parts[0] === 'run' && parts[1]) {
    const runKey = `run/${parts[1]}`
    const run = crumbTitle('plan', runKey) ?? (/^\d+$/.test(parts[1]) ? `План №${parts[1]}` : 'Прогон')
    const section = parts[2] ? crumbTitle('plan', anchor) : undefined
    return section ? [{ label: run, href: `#/plan/${runKey}` }, { label: section }] : [{ label: run }]
  }
  return []
}

/** Объект экрана, имя которого сообщил сам экран (setCrumbTitle); без имени — `fallback` или ничего. */
function objectCrumbs(screenId: string, anchor: string, fallback?: string): Crumb[] {
  const title = crumbTitle(screenId, anchor)
  if (title) return [{ label: title }]
  return fallback ? [{ label: fallback }] : []
}

/** Полные крошки маршрута: «Справочники › Техкарты › ТК-12 Вал». Корень — ссылка, если есть продолжение. */
export function buildCrumbs(screenId: string, anchor: string | null): Crumb[] {
  const screen = getScreen(screenId)
  if (!screen) return []
  const tail = anchor && screen.crumbs ? screen.crumbs(anchor) : []
  return tail.length ? [{ label: screen.label, href: `#/${screen.id}` }, ...tail] : [{ label: screen.label }]
}

/** Подпись стадии для подсказок и верхней панели. */
export const STAGE_HINT: Record<1 | 2, string> = {
  2: 'Стадия 2 — что выпускать (устойчивый портфель)',
  1: 'Стадия 1 — как выпускать (расписание)',
}

export function getScreen(id: string): ScreenDef | undefined {
  return SCREENS.find((s) => s.id === id)
}
