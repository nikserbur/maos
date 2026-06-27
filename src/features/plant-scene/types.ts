/**
 * Доменные типы 3D-схемы предприятия.
 * Данные наполняются из НСИ и планировщика (фазы 3–5); сейчас используются
 * как статичный демо-слой (layout.ts).
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
  id: string
  kind: ObjectKind
  title: string
  subtitle: string
  /** Положение центра: [x, z]. */
  position: [number, number]
  rotationY?: number
  scale: number
  status: StageStatus
  kpis: StageKpi[]
}

/** Физическая связь между узлами схемы (конвейер, трубопровод и т.п.). */
export interface FlowLink {
  from: string
  to: string
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
