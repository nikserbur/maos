import type { ComponentType } from 'react'
import PlantScene from '../features/plant-scene'
import { NsiScreen } from '../features/nsi/NsiScreen'
import { OptimizationScreen } from '../features/optimization/OptimizationScreen'
import { ScenariosScreen } from '../features/scenarios/ScenariosScreen'
import { PlanScreen } from '../features/plan/PlanScreen'
import { AdminScreen } from '../features/admin/AdminScreen'

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
  { id: 'scenarios', label: 'Сценарии', icon: 'scenarios', Component: ScenariosScreen },
  { id: 'admin', label: 'Администрирование', icon: 'admin', Component: AdminScreen },
]
