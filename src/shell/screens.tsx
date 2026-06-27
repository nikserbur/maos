import type { ComponentType } from 'react'
import PlantScene from '../features/plant-scene'
import { NsiScreen } from '../features/nsi/NsiScreen'
import { Placeholder } from './Placeholder'

export interface ScreenDef {
  id: string
  label: string
  icon: string
  Component: ComponentType
}

function PlanScreen() {
  return (
    <Placeholder
      title="Производственный план"
      caption="Выбор изделий и даты выпуска (производственная программа) → построение плана-графика."
    />
  )
}

function OptimizationScreen() {
  return (
    <Placeholder
      title="Оптимизация"
      caption="Оптимальная загрузка оборудования и рабочих ради пропускной способности; критерий время/стоимость/риск."
    />
  )
}

function ScenariosScreen() {
  return (
    <Placeholder
      title="Сценарии"
      caption="What-if: оверрайды, клонирование и сравнение сценариев бок о бок."
    />
  )
}

function AdminScreen() {
  return (
    <Placeholder
      title="Администрирование"
      caption="Пользователи, роли и права доступа, журнал действий (Action layer)."
    />
  )
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
