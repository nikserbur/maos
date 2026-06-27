/**
 * Доменные типы 3D-схемы предприятия.
 * Граф строится из реестров НСИ (machines + work_center_types + flows)
 * функцией buildGraphFromDb — статичного хардкода больше нет.
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
