/**
 * Таблица-двойник сцены (X2 P-32): объекты уровня или состав цеха/завода — имя (статус глифом и
 * словом — второй строкой, чтобы узкий инспектор не прокручивался вбок), загрузка по плану (по убыванию,
 * ▲ от 85 %), пик очереди. Клик или Space — выбрать и
 * подсветить в 3D; Enter или двойной клик — войти внутрь (у контейнеров). Топ-10 + «Показать все N».
 */
import type { KeyboardEvent, MouseEvent } from 'react'
import { DataTable, type DataColumn } from '../../ui/kit'
import { num } from '../../explain/format'
import { STATUS_META } from './types'
import type { SceneNode } from './graph/sceneModel'
import { statusWord } from './graph/status'
import { OVERLOAD, type NodeOps } from './sceneOps'

export interface ObjectRow {
  node: SceneNode
  ops: NodeOps | undefined
  /** Есть вложенный уровень (Enter/2×клик входят внутрь). */
  enterable: boolean
}

const LIMIT = 10

const COLUMNS: ReadonlyArray<DataColumn<ObjectRow>> = [
  { key: 'name', title: 'Объект и статус', rowHeader: true, primary: true, get: (r) => r.node.title,
    render: (r) => (
      <span className="sot-name" data-node-id={r.node.id}>
        <span>{r.node.title}</span>
        <span className={`sot-status ${STATUS_META[r.node.status].glyphClass}`}>{statusWord(r.node.refType, r.node.status)}</span>
      </span>
    ) },
  { key: 'util', title: 'Загрузка, %', num: true, get: (r) => r.ops?.util ?? null, hint: 'По последнему плану; у цеха — максимум по станкам',
    render: (r) => {
      const u = r.ops?.util ?? null
      if (u === null) return <span className="sot-muted" title="Не рассчитано: плана ещё нет">—</span>
      return u >= OVERLOAD ? <span className="sot-hot">{num(u * 100, 0)} <span className="glyph-setup" role="img" aria-label="перегрузка" /></span> : num(u * 100, 0)
    } },
  { key: 'queue', title: 'Очередь, партий', num: true, get: (r) => r.ops?.queuePeak ?? null, hint: 'Пик очереди за план — наибольшее число партий',
    render: (r) => (r.ops?.queuePeak === null || r.ops?.queuePeak === undefined ? <span className="sot-muted">—</span> : num(r.ops.queuePeak, 0)) },
]

interface SceneObjectsTableProps {
  rows: ReadonlyArray<ObjectRow>
  selectedId: string | null
  caption: string
  onSelect: (row: ObjectRow) => void
  onEnter: (row: ObjectRow) => void
}

/** Строка по событию внутри таблицы (атрибут data-node-id в ячейке имени). */
function rowOf(target: EventTarget | null, rows: ReadonlyArray<ObjectRow>): ObjectRow | undefined {
  const tr = (target as HTMLElement | null)?.closest?.('tr')
  const id = tr?.querySelector('[data-node-id]')?.getAttribute('data-node-id')
  return id ? rows.find((r) => r.node.id === id) : undefined
}

export function SceneObjectsTable({ rows, selectedId, caption, onSelect, onEnter }: SceneObjectsTableProps) {
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const row = rowOf(e.target, rows)
    if (row?.enterable) onEnter(row)
  }
  // Enter у контейнера — войти (перехватываем до DataTable: там Enter = клик); Space — выбрать.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'TR') return
    const row = rowOf(e.target, rows)
    if (!row?.enterable) return
    e.preventDefault()
    e.stopPropagation()
    onEnter(row)
  }
  return (
    <div className="sot" onDoubleClick={onDoubleClick} onKeyDownCapture={onKeyDownCapture}>
      <DataTable columns={COLUMNS} rows={rows} rowKey={(r) => r.node.id} tight caption={caption}
                 defaultSort={{ key: 'util', dir: 'desc' }} limit={LIMIT} onRowClick={onSelect}
                 rowClassName={(r) => (r.node.id === selectedId ? 'is-selected' : undefined)}
                 rowTitle={(r) => (r.enterable ? 'Клик — выбрать, Enter или 2×клик — войти внутрь' : 'Клик — карточка объекта')}
                 empty="Объектов на этом уровне нет" />
    </div>
  )
}
