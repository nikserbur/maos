/**
 * Инспектор без выбора (X2 P-32): «Объекты уровня (N)» — таблица-двойник сцены (выбор подсвечивает
 * объект в 3D, Enter/2×клик — внутрь). Пустой уровень — первое использование со следующим шагом.
 */
import { EmptyState, SkeletonRows } from '../../ui/kit'
import { SceneObjectsTable, type ObjectRow } from './SceneObjectsTable'

export type SceneLevel = 'world' | 'site' | 'shop'

const CAPTION: Record<SceneLevel, string> = {
  world: 'Предприятия и склады',
  site: 'Цеха площадки',
  shop: 'Станки цеха',
}

const FIRST_USE: Record<SceneLevel, { title: string; text: string }> = {
  world: { title: 'Предприятий пока нет', text: 'Создайте подразделение в Справочниках — оно появится здесь.' },
  site: { title: 'Цехов пока нет', text: 'Включите «Редактирование» и добавьте цех — станки размещаются внутри цеха.' },
  shop: { title: 'Станков пока нет', text: 'Включите «Редактирование» и добавьте станок выбранного типа оборудования.' },
}

/** Состояние данных схемы: загрузка, недоступно (сервер), готово. */
export type SceneDataStatus = 'loading' | 'unavailable' | 'ready'

interface InspectorEmptyProps {
  level: SceneLevel
  status: SceneDataStatus
  rows: ReadonlyArray<ObjectRow>
  selectedId: string | null
  onSelect: (row: ObjectRow) => void
  onEnter: (row: ObjectRow) => void
}

export function InspectorEmpty({ level, status, rows, selectedId, onSelect, onEnter }: InspectorEmptyProps) {
  if (status === 'loading') return <div className="ep-empty"><SkeletonRows rows={6} cols={3} label="Загрузка объектов схемы" /></div>
  if (status === 'unavailable') {
    return (
      <div className="ep-empty">
        <EmptyState size="sm" quiet kind="unavailable" title="Объекты не загрузились">Сервер недоступен — «Повторить» на схеме слева.</EmptyState>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="ep-empty">
        <EmptyState size="sm" variant="flow" kind="first-use" title={FIRST_USE[level].title}>{FIRST_USE[level].text}</EmptyState>
      </div>
    )
  }
  return (
    <section className="editor-panel__section ep-objects" aria-label="Объекты уровня">
      <h2 className="ep-objects__title">Объекты уровня <span className="ep-objects__n num">({rows.length})</span></h2>
      <p className="editor-panel__tip">Выберите строку или объект в сцене; Enter или 2×клик — внутрь.</p>
      <SceneObjectsTable rows={rows} selectedId={selectedId} caption={CAPTION[level]} onSelect={onSelect} onEnter={onEnter} />
    </section>
  )
}
