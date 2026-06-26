/**
 * Запасы и движения (ТЗ «Требования к запасам», docs/REQUIREMENTS.md §1).
 */
import type { Id } from './nsi'

export type StockKind = 'сырьё' | 'НЗП' | 'готовое'

export interface StockItem {
  itemId: Id
  locationId: Id
  kind: StockKind
  onHand: number
  unitId?: Id
  safetyStock?: number
  reorderPoint?: number
  reorderQty?: number
  leadTime?: number
}

export type StockMoveReason = 'закупка' | 'выпуск' | 'потребление'

export interface StockMove {
  date: string
  itemId: Id
  locationId: Id
  /** +приход / −расход. */
  delta: number
  reason: StockMoveReason
  /** Ссылка на работу плана/заказ. */
  refId?: Id
  stockAtEnd?: number
}
