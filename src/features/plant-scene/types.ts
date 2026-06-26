/**
 * Доменные типы 3D-схемы предприятия.
 * Сейчас данные статичны (см. layout.ts). Позже эти же структуры
 * будут наполняться из доменного ядра / БД (фазы НСИ и планировщика).
 */

export type ObjectKind =
  | 'feedstock'
  | 'cleaningarea'
  | 'dryer'
  | 'boiler'
  | 'finecleaning'
  | 'briquettes'
  | 'pileizer'
  | 'transformer'
  | 'wirehouse'
  | 'sale'
  | 'marketing'

export type StageStatus = 'running' | 'setup' | 'idle' | 'down'

export interface StageKpi {
  label: string
  value: string
}

export interface PlantStage {
  /** Стабильный id узла схемы. */
  id: string
  kind: ObjectKind
  title: string
  subtitle: string
  /** Положение центра на полу: [x, z]. Высота берётся из модели. */
  position: [number, number]
  /** Поворот вокруг вертикали, радианы. */
  rotationY?: number
  /** Множитель масштаба модели (исходные пропорции сохранены). */
  scale: number
  status: StageStatus
  kpis: StageKpi[]
}

export type FlowKind = 'material' | 'energy'

export interface FlowLink {
  from: string
  to: string
  kind: FlowKind
}

export interface StatusMeta {
  label: string
  color: string
}

/** Цвета статусов совпадают с intent-токенами дизайн-системы. */
export const STATUS_META: Record<StageStatus, StatusMeta> = {
  running: { label: 'В работе', color: '#238551' },
  setup: { label: 'Наладка', color: '#c87619' },
  idle: { label: 'Простой', color: '#8f99a8' },
  down: { label: 'Авария', color: '#cd4246' },
}
