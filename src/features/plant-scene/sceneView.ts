/**
 * Производные уровня схемы (чистые функции): уровень по текущему узлу, подпись счётчика после
 * крошек («36 станков», «Предприятия (3) · склады (1)»), станки под уровнем (легенда, симуляция).
 */
import { countText, num } from '../../explain/format'
import type { SceneGraph, SceneNode } from './graph/sceneModel'
import type { SceneLevel } from './InspectorEmpty'

const SHOP_FORMS = ['цех', 'цеха', 'цехов'] as const
const MACHINE_FORMS = ['станок', 'станка', 'станков'] as const

/** Уровень: нет родителя — мир; родитель-цех — цех; иначе — площадка завода. */
export function levelOf(current: SceneNode | null): SceneLevel {
  if (!current) return 'world'
  return current.refType === 'shop' ? 'shop' : 'site'
}

/** Счётчик уровня после крошек. */
export function levelCountText(level: SceneLevel, nodes: ReadonlyArray<SceneNode>): string {
  if (level === 'world') {
    const warehouses = nodes.filter((n) => n.kind === 'wirehouse').length
    const plants = nodes.length - warehouses
    return `Предприятия (${num(plants, 0)})${warehouses > 0 ? ` · склады (${num(warehouses, 0)})` : ''}`
  }
  return level === 'site' ? countText(nodes.length, SHOP_FORMS) : countText(nodes.length, MACHINE_FORMS)
}

/** Станки под узлом (сам станок, станки цеха, станки завода); null — вся схема. */
export function machinesUnder(graph: SceneGraph, rootId: string | null): SceneNode[] {
  const machines = graph.nodes.filter((n) => n.refType === 'machine')
  if (rootId === null) return machines
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]))
  const under = (id: string): boolean => {
    let cur: string | null | undefined = id
    for (let guard = 0; cur && guard < 8; guard++) {
      if (cur === rootId) return true
      cur = parent.get(cur)
    }
    return false
  }
  return machines.filter((m) => under(m.id))
}
