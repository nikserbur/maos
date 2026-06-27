import type { Crumb } from './graph/graphReducer'

interface BreadcrumbsProps {
  path: Crumb[]
  onNavigate: (index: number) => void
}

/** Навигация по уровням иерархии схемы (drill-down). */
export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  if (path.length <= 1) return null

  return (
    <nav className="breadcrumbs" aria-label="Уровни схемы">
      {path.map((crumb, index) => {
        const last = index === path.length - 1
        return (
          <span className="breadcrumbs__item" key={`${crumb.id ?? 'root'}-${index}`}>
            <button
              className="breadcrumbs__btn"
              onClick={() => onNavigate(index)}
              disabled={last}
            >
              {crumb.title}
            </button>
            {!last && <span className="breadcrumbs__sep">›</span>}
          </span>
        )
      })}
    </nav>
  )
}
