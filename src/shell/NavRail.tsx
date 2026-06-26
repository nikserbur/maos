import { SCREENS } from './screens'
import { Icon } from './icons'

interface NavRailProps {
  activeId: string
  onSelect: (id: string) => void
}

/** Левая рельса навигации между экранами приложения. */
export function NavRail({ activeId, onSelect }: NavRailProps) {
  return (
    <nav className="rail" aria-label="Основная навигация">
      {SCREENS.map((screen) => {
        const active = screen.id === activeId
        return (
          <button
            key={screen.id}
            type="button"
            className={active ? 'rail__item rail__item--active' : 'rail__item'}
            title={screen.label}
            aria-label={screen.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(screen.id)}
          >
            <Icon name={screen.icon} />
          </button>
        )
      })}
    </nav>
  )
}
