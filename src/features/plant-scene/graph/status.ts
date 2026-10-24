/**
 * Статус контейнера схемы (цех, завод) — худший статус потомков (X2 P-27), а не зашитое «В работе».
 * Тяжесть: ■ авария > ▲ ТО / ремонт > ● в работе > ○ выведен. Пустой контейнер и контейнер только
 * из выведенных станков — ○ (слово для контейнера — «нет станков в работе»).
 */
import { STATUS_META, type StageStatus } from '../types'

const SEVERITY: Readonly<Record<StageStatus, number>> = { idle: 0, running: 1, setup: 2, down: 3 }

/** Худший статус из списка; пустой список — ○. */
export function aggregateStatus(children: ReadonlyArray<StageStatus>): StageStatus {
  let worst: StageStatus = 'idle'
  for (const s of children) if (SEVERITY[s] > SEVERITY[worst]) worst = s
  return worst
}

interface StatusNode {
  id: string
  parentId: string | null
  status: StageStatus
}

/**
 * Свернуть статусы снизу вверх: у каждого узла с потомками статус = aggregateStatus(потомков),
 * листья сохраняют свой. Возвращает новый массив (исходные узлы не меняются).
 */
export function rollupStatus<T extends StatusNode>(nodes: ReadonlyArray<T>): T[] {
  const children = new Map<string, T[]>()
  for (const n of nodes) {
    if (n.parentId === null) continue
    const list = children.get(n.parentId) ?? []
    children.set(n.parentId, [...list, n])
  }
  const memo = new Map<string, StageStatus>()
  const visiting = new Set<string>()
  const statusOf = (n: T): StageStatus => {
    const known = memo.get(n.id)
    if (known) return known
    const kids = children.get(n.id)
    if (!kids || visiting.has(n.id)) return n.status
    visiting.add(n.id)
    const s = aggregateStatus(kids.map(statusOf))
    visiting.delete(n.id)
    memo.set(n.id, s)
    return s
  }
  return nodes.map((n) => (children.has(n.id) ? { ...n, status: statusOf(n) } : n))
}

/** Слово статуса узла: у станка — словарь справочника, у цеха/завода — сводка по станкам. */
export function statusWord(refType: 'factory' | 'shop' | 'machine', status: StageStatus): string {
  if (refType !== 'machine' && status === 'idle') return 'Нет станков в работе'
  return STATUS_META[status].label
}
