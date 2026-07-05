import { lazy, type ComponentType } from 'react'

/* Ленивые экраны: каждый — отдельный чанк. three.js (~1 МБ) грузится только при
 * открытии «Схемы предприятия», а не в стартовом бандле до логина. */
const PlantScene = lazy(() => import('../features/plant-scene'))
const NsiScreen = lazy(() => import('../features/nsi/NsiScreen').then((m) => ({ default: m.NsiScreen })))
const OptimizationScreen = lazy(() => import('../features/optimization/OptimizationScreen').then((m) => ({ default: m.OptimizationScreen })))
const ScenariosHub = lazy(() => import('../features/scenarios/ScenariosHub').then((m) => ({ default: m.ScenariosHub })))
const PlanScreen = lazy(() => import('../features/plan/PlanScreen').then((m) => ({ default: m.PlanScreen })))
const AdminScreen = lazy(() => import('../features/admin/AdminScreen').then((m) => ({ default: m.AdminScreen })))

export interface ScreenDef {
  id: string
  label: string
  icon: string
  Component: ComponentType
}

/**
 * Реестр экранов. Разбивка следует фундаментальной модели (docs/CONCEPT.md §8):
 * Схема → Справочники → План → Оптимизация → Сценарии → Администрирование.
 */
export const SCREENS: ScreenDef[] = [
  { id: 'scheme', label: 'Схема предприятия', icon: 'scheme', Component: PlantScene },
  { id: 'nsi', label: 'Справочники', icon: 'nsi', Component: NsiScreen },
  { id: 'plan', label: 'План', icon: 'plan', Component: PlanScreen },
  { id: 'optimization', label: 'Оптимизация', icon: 'optimization', Component: OptimizationScreen },
  { id: 'scenarios', label: 'Сценарии', icon: 'scenarios', Component: ScenariosHub },
  { id: 'admin', label: 'Администрирование', icon: 'admin', Component: AdminScreen },
]
