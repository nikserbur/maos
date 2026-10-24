import { NAV_GROUP_LABEL, SCREENS, STAGE_HINT, type NavGroup, type ScreenDef } from './screens'
import { Icon } from './icons'

interface NavRailProps {
  activeId: string
  onSelect: (id: string) => void
}

interface RailGroup { id: NavGroup; screens: ScreenDef[] }

/** Экраны по группам рельсы в порядке реестра (группа без явной — как у предыдущего экрана). */
function railGroups(): RailGroup[] {
  const out: RailGroup[] = []
  let group: NavGroup = 'model'
  for (const s of SCREENS) {
    group = s.group ?? group
    const last = out[out.length - 1]
    if (last && last.id === group) last.screens.push(s)
    else out.push({ id: group, screens: [s] })
  }
  return out
}

/**
 * Левая рельса: иконка + подпись (сокращение канонического имени), группы по карте методологии
 * (UX-V2 §2.3) — каждая `role="group"` со своей подписью. Доступное имя пункта начинается с видимой
 * подписи (WCAG 2.5.3); стадия ①/② — описанием (aria-describedby), а не плашкой-счётчиком.
 */
export function NavRail({ activeId, onSelect }: NavRailProps) {
  return (
    <nav className="rail" aria-label="Основная навигация">
      {railGroups().map((g, gi) => (
        <div key={g.id} className="rail__grp" role="group" aria-labelledby={`rail-g-${g.id}`}>
          {gi > 0 && <span className="rail__sep" aria-hidden="true" />}
          <span className="rail__group" id={`rail-g-${g.id}`}>{NAV_GROUP_LABEL[g.id]}</span>
          {g.screens.map((screen) => {
            const active = screen.id === activeId
            const short = screen.short ?? screen.label
            const hint = screen.stage
              ? STAGE_HINT[screen.stage]
              : screen.soon ? `в разработке (${screen.soon})` : undefined
            const hintId = hint ? `rail-h-${screen.id}` : undefined
            return (
              <a
                key={screen.id}
                href={`#/${screen.id}`}
                className={`rail__item${active ? ' rail__item--active' : ''}${screen.soon ? ' rail__item--soon' : ''}`}
                title={hint ? `${screen.label} · ${hint}` : screen.label}
                aria-label={short === screen.label ? short : `${short} — ${screen.label}`}
                aria-describedby={hintId}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                  event.preventDefault()
                  onSelect(screen.id)
                }}
              >
                <span className="rail__icon" aria-hidden="true">
                  <Icon name={screen.icon} />
                  {screen.soon && <span className="rail__badge rail__badge--soon" />}
                </span>
                <span className="rail__label">{short}</span>
                {hint && <span className="dk-vh" id={hintId}>{hint}</span>}
              </a>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
