import type { ComponentType } from 'react'
import PlantScene from '../features/plant-scene'
import { Placeholder } from './Placeholder'

export interface ScreenDef {
  id: string
  label: string
  icon: string
  Component: ComponentType
}

function MonitoringScreen() {
  return (
    <Placeholder
      title="Мониторинг"
      caption="Состояние оборудования и линий, узкие места и отклонения в реальном времени."
    />
  )
}

function PlanScreen() {
  return (
    <Placeholder
      title="План производства"
      caption="Гантт, загрузка ресурсов и критический путь по результатам планировщика."
    />
  )
}

function OptimizationScreen() {
  return (
    <Placeholder
      title="Оптимизация"
      caption="Поиск порядка операций по целевой функции время/стоимость/риск, сравнение прогонов."
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

/** Реестр экранов приложения для рельсы навигации. */
export const SCREENS: ScreenDef[] = [
  { id: 'scheme', label: 'Схема предприятия', icon: 'scheme', Component: PlantScene },
  { id: 'monitoring', label: 'Мониторинг', icon: 'monitoring', Component: MonitoringScreen },
  { id: 'plan', label: 'План', icon: 'plan', Component: PlanScreen },
  { id: 'optimization', label: 'Оптимизация', icon: 'optimization', Component: OptimizationScreen },
  { id: 'scenarios', label: 'Сценарии', icon: 'scenarios', Component: ScenariosScreen },
  { id: 'admin', label: 'Администрирование', icon: 'admin', Component: AdminScreen },
]
