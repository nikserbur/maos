/**
 * Где «живёт» каждый блок методологии (X2 «конвейер виден и связан»): клик по ячейке полосы
 * ведёт на экран-владелец блока, а не на карту. Ячейки блоков текущего экрана ведут на узел карты
 * (экран уже открыт — объяснение важнее). [8] LLM — открывает MENTAT.
 */
import type { BlockId } from '../features/method-map/types'
import { overlayActions } from './overlays'

export type BlockHome =
  | { kind: 'route'; screen: string; anchor?: string; label: string }
  | { kind: 'action'; run: () => void; label: string }

export const BLOCK_HOME: Readonly<Record<BlockId, BlockHome>> = {
  external: { kind: 'route', screen: 'scenarios', anchor: 'conditions', label: 'Сценарии › Условия' },
  distributions: { kind: 'route', screen: 'scenarios', anchor: 'distributions', label: 'Сценарии › Распределения' },
  internal: { kind: 'route', screen: 'nsi', label: 'Справочники' },
  decisions: { kind: 'route', screen: 'optimization', label: 'Портфель' },
  criteria: { kind: 'route', screen: 'plan', label: 'План' },
  agents: { kind: 'route', screen: 'agents', label: 'Агенты' },
  monitoring: { kind: 'route', screen: 'monitoring', label: 'Мониторинг' },
  llm: { kind: 'action', run: () => overlayActions.openMentat(), label: 'MENTAT' },
}

/** Адрес ячейки: блок текущего экрана → узел карты; иначе — экран-владелец (у [8] — `null`, это действие). */
export function blockHref(block: BlockId, current: boolean): string | null {
  if (current) return `#/map/${block}`
  const home = BLOCK_HOME[block]
  if (home.kind === 'action') return null
  return `#/${home.screen}${home.anchor ? `/${home.anchor}` : ''}`
}
