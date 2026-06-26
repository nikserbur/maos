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

/** Типы связей между узлами схемы. */
export type FlowKind = 'material' | 'energy' | 'gas'

export interface FlowLink {
  from: string
  to: string
  kind: FlowKind
}

export interface FlowMeta {
  label: string
  color: string
}

/** Подписи и цвета типов потоков (единый источник для сцены и легенды). */
export const FLOW_META: Record<FlowKind, FlowMeta> = {
  material: { label: 'Материальный', color: '#2d72d2' },
  energy: { label: 'Энергетический', color: '#c87619' },
  gas: { label: 'Газовый', color: '#2bb3a3' },
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
