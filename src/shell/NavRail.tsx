import { Fragment } from 'react'
import { SCREENS, STAGE_HINT, type NavGroup } from './screens'
import { Icon } from './icons'

interface NavRailProps {
  activeId: string
  onSelect: (id: string) => void
}

/** Левая рельса: иконка + короткая подпись, группы по потоку данных, бейджи стадий. */
export function NavRail({ activeId, onSelect }: NavRailProps) {
  let group: NavGroup | undefined
  return (
    <nav className="rail" aria-label="Основная навигация">
      {SCREENS.map((screen, index) => {
        const active = screen.id === activeId
        const nextGroup = screen.group ?? group
        const separated = index > 0 && nextGroup !== group
        group = nextGroup
        const hint = screen.stage ? `${screen.label} · ${STAGE_HINT[screen.stage]}` : screen.label
        return (
          <Fragment key={screen.id}>
            {separated && <span className="rail__sep" role="separator" />}
            <a
              href={`#/${screen.id}`}
              className={active ? 'rail__item rail__item--active' : 'rail__item'}
              title={hint}
              aria-label={hint}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                event.preventDefault()
                onSelect(screen.id)
              }}
            >
              <span className="rail__icon">
                <Icon name={screen.icon} />
                {screen.stage && (
                  <span className={`rail__badge rail__badge--s${screen.stage}`} aria-hidden="true">
                    {screen.stage}
                  </span>
                )}
              </span>
              <span className="rail__label" aria-hidden="true">{screen.short ?? screen.label}</span>
            </a>
          </Fragment>
        )
      })}
    </nav>
  )
}
