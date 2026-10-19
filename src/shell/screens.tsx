import { lazy, type ComponentType } from 'react'

/* Ленивые экраны: каждый — отдельный чанк. three.js (~1 МБ) грузится только при
 * открытии «Схемы предприятия», а не в стартовом бандле до логина. */
const PlantScene = lazy(() => import('../features/plant-scene'))
const NsiScreen = lazy(() => import('../features/nsi/NsiScreen').then((m) => ({ default: m.NsiScreen })))
const OptimizationScreen = lazy(() => import('../features/optimization/OptimizationScreen').then((m) => ({ default: m.OptimizationScreen })))
const ScenariosHub = lazy(() => import('../features/scenarios/ScenariosHub').then((m) => ({ default: m.ScenariosHub })))
const PlanScreen = lazy(() => import('../features/plan/PlanScreen').then((m) => ({ default: m.PlanScreen })))
const AnalyticsScreen = lazy(() => import('../features/analytics/AnalyticsScreen').then((m) => ({ default: m.AnalyticsScreen })))
const AdminScreen = lazy(() => import('../features/admin/AdminScreen').then((m) => ({ default: m.AdminScreen })))
const WorkflowBuilder = lazy(() => import('../features/workflow-builder/WorkflowBuilder').then((m) => ({ default: m.WorkflowBuilder })))

/** Группы рельсы по потоку данных: модель → решение → анализ → система. */
export type NavGroup = 'model' | 'decide' | 'insight' | 'system'

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
  Component: ComponentType
}

/**
 * Реестр экранов в порядке потока данных (AUDIT §4.5):
 * Схема → Справочники → [Граф процесса] → Сценарии → Оптимизация (Стадия 2) →
 * План (Стадия 1) → Аналитика → [Методика] → AI-воркфлоу → Администрирование.
 * `process` (group 'model', после nsi) и `methodology` (group 'insight', после analytics)
 * регистрирует интегратор.
 */
export const SCREENS: ScreenDef[] = [
  { id: 'scheme', label: 'Схема предприятия', short: 'Схема', icon: 'scheme', group: 'model', Component: PlantScene },
  { id: 'nsi', label: 'Справочники', short: 'Справочники', icon: 'nsi', group: 'model', Component: NsiScreen },
  { id: 'scenarios', label: 'Сценарии', short: 'Сценарии', icon: 'scenarios', group: 'decide', Component: ScenariosHub },
  { id: 'optimization', label: 'Оптимизация', short: 'Оптимизация', icon: 'optimization', group: 'decide', stage: 2, Component: OptimizationScreen },
  { id: 'plan', label: 'План', short: 'План', icon: 'plan', group: 'decide', stage: 1, Component: PlanScreen },
  { id: 'analytics', label: 'Аналитика', short: 'Аналитика', icon: 'analytics', group: 'insight', Component: AnalyticsScreen },
  { id: 'aiflow', label: 'AI-воркфлоу (конструктор)', short: 'AI', icon: 'workflow', group: 'system', Component: WorkflowBuilder },
  { id: 'admin', label: 'Администрирование', short: 'Админ', icon: 'admin', group: 'system', Component: AdminScreen },
]

/** Подпись стадии для подсказок и верхней панели. */
export const STAGE_HINT: Record<1 | 2, string> = {
  2: 'Стадия 2 — что выпускать (устойчивый портфель)',
  1: 'Стадия 1 — как выпускать (расписание)',
}
