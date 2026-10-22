import { lazy, type ComponentType } from 'react'
import type { BlockId } from '../features/method-map/types'

/* Ленивые экраны: каждый — отдельный чанк. three.js (~1 МБ) грузится только при
 * открытии «Схемы предприятия», а не в стартовом бандле до логина. */
const PlantScene = lazy(() => import('../features/plant-scene'))
const NsiScreen = lazy(() => import('../features/nsi/NsiScreen').then((m) => ({ default: m.NsiScreen })))
const OptimizationScreen = lazy(() => import('../features/optimization/OptimizationScreen').then((m) => ({ default: m.OptimizationScreen })))
const ScenariosHub = lazy(() => import('../features/scenarios/ScenariosHub').then((m) => ({ default: m.ScenariosHub })))
const PlanScreen = lazy(() => import('../features/plan/PlanScreen').then((m) => ({ default: m.PlanScreen })))
const AgentsStub = lazy(() => import('../features/agents/AgentsStub').then((m) => ({ default: m.AgentsStub })))
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
  /** Сегмент hash-маршрута: `#/<id>[/<anchor>]`. */
  id: string
  /** Полное название (верхняя панель, подсказка рельсы). */
  label: string
  /** Короткая подпись под иконкой рельсы (≤ 11 символов); по умолчанию label. */
  short?: string
  icon: string
  /** Группа рельсы; без неё — группа предыдущего экрана. */
  group?: NavGroup
  /** Стадия двухуровневой модели: 2 — что выпускать, 1 — как выпускать. */
  stage?: 1 | 2
  /** Блоки карты методологии, которые реализует экран (PLAN-V2 §3). */
  blocks?: readonly BlockId[]
  /** Показывать полосу методологии (PipelineStrip) под верхней панелью. */
  pipeline?: boolean
  /** Вложенные маршруты экрана (`#/<id>/<anchor>`), которые экран разбирает сам. */
  anchors?: readonly string[]
  /** Экран зарезервирован: пункт рельсы есть, содержимое — «скоро» (волна). */
  soon?: string
  Component: ComponentType
}

/**
 * Реестр экранов по карте методологии (UX-V2 §2.3):
 * Модель (Схема · Справочники) → Условия (Сценарии [1][2]) → Решения (Портфель [4][5] ②,
 * План [3][4][5] ①, Агенты [6] — заглушка) → Наблюдение (Мониторинг [7], Аналитика [7]) →
 * Объяснение (Карта, Методика) → Система (AI-воркфлоу, Администрирование).
 * Стартовый экран после входа — «Схема» (решение владельца, UX-V2 §8).
 */
export const SCREENS: ScreenDef[] = [
  { id: 'scheme', label: 'Схема предприятия', short: 'Схема', icon: 'scheme', group: 'model', blocks: ['internal'], Component: PlantScene },
  { id: 'nsi', label: 'Справочники', short: 'НСИ', icon: 'nsi', group: 'model', blocks: ['internal', 'distributions'], anchors: ['<реестр>', 'routing/<id|new>'], Component: NsiScreen },
  { id: 'scenarios', label: 'Сценарии', short: 'Сценарии', icon: 'scenarios', group: 'conditions', blocks: ['external', 'distributions', 'criteria'], pipeline: true, Component: ScenariosHub },
  { id: 'optimization', label: 'Оптимизация', short: 'Портфель', icon: 'optimization', group: 'decide', stage: 2, blocks: ['decisions', 'criteria'], pipeline: true, Component: OptimizationScreen },
  { id: 'plan', label: 'План', short: 'План', icon: 'plan', group: 'decide', stage: 1, blocks: ['internal', 'decisions', 'criteria'], pipeline: true, Component: PlanScreen },
  { id: 'agents', label: 'Агенты', short: 'Агенты', icon: 'sparkle', group: 'decide', blocks: ['agents'], soon: 'волна 3', Component: AgentsStub },
  { id: 'monitoring', label: 'Мониторинг', short: 'Монитор', icon: 'monitoring', group: 'observe', blocks: ['monitoring', 'external'], pipeline: true, Component: MonitoringScreen },
  { id: 'analytics', label: 'Аналитика', short: 'Аналитика', icon: 'analytics', group: 'observe', blocks: ['monitoring'], Component: AnalyticsScreen },
  { id: 'map', label: 'Карта методологии', short: 'Карта', icon: 'graph', group: 'explain', Component: MapScreen },
  { id: 'methodology', label: 'Методика', short: 'Методика', icon: 'book', group: 'explain', blocks: ['llm'], Component: MethodologyScreen },
  { id: 'aiflow', label: 'AI-воркфлоу (конструктор)', short: 'AI', icon: 'workflow', group: 'system', blocks: ['llm'], Component: WorkflowBuilder },
  { id: 'admin', label: 'Администрирование', short: 'Админ', icon: 'admin', group: 'system', Component: AdminScreen },
]

/** Подпись стадии для подсказок и верхней панели. */
export const STAGE_HINT: Record<1 | 2, string> = {
  2: 'Стадия 2 — что выпускать (устойчивый портфель)',
  1: 'Стадия 1 — как выпускать (расписание)',
}

export function getScreen(id: string): ScreenDef | undefined {
  return SCREENS.find((s) => s.id === id)
}
