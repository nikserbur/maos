import { STATUS_META } from './types'
import type { SceneNode } from './graph/sceneModel'

interface InspectorProps {
  node: SceneNode
  editing: boolean
  hasChildren: boolean
  onClose: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onEnter: (id: string) => void
}

/** Инспектор выбранного узла: показатели + правки (имя, удаление, drill-down). */
export function Inspector({
  node,
  editing,
  hasChildren,
  onClose,
  onRename,
  onDelete,
  onEnter,
}: InspectorProps) {
  const meta = STATUS_META[node.status]

  return (
    <aside className="inspector" aria-label="Инспектор узла">
      <header className="inspector__head">
        <div className="inspector__heading">
          <div className="inspector__eyebrow">Узел схемы</div>
          {editing ? (
            <input
              className="inspector__title-input"
              value={node.title}
              onChange={(e) => onRename(node.id, e.target.value)}
              aria-label="Название узла"
            />
          ) : (
            <h2 className="inspector__title">{node.title}</h2>
          )}
          <div className="inspector__subtitle">{node.subtitle}</div>
        </div>
        <button className="inspector__close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </header>

      <div className="inspector__status">
        <span className="inspector__status-dot" style={{ background: meta.color }} />
        <span>{meta.label}</span>
      </div>

      {node.kpis.length > 0 && (
        <>
          <div className="inspector__section-label">Показатели</div>
          <dl className="inspector__kpis">
            {node.kpis.map((kpi) => (
              <div className="kpi" key={kpi.label}>
                <dt className="kpi__label">{kpi.label}</dt>
                <dd className="kpi__value mono">{kpi.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="inspector__actions">
        {hasChildren && (
          <button className="btn" onClick={() => onEnter(node.id)}>
            Войти в подсхему ↘
          </button>
        )}
        {editing && (
          <button className="btn btn--danger" onClick={() => onDelete(node.id)}>
            Удалить узел
          </button>
        )}
      </div>

      <p className="inspector__hint">
        {editing
          ? 'Правка: тяните стрелки gizmo для перемещения; «Соединить» — связь между узлами.'
          : 'Двойной клик по узлу — войти в подсхему. Нажмите ↔ на объекте для соединения.'}
      </p>
    </aside>
  )
}
