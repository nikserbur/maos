import { Lockup } from '../brand/Logo'
import { Backdrop } from '../brand/Backdrop'
import { Icon } from './icons'
import { DEFAULT_SCREEN_ID } from './router'
import { STAGE_HINT } from './screens'
import { setTheme, useTheme } from './theme'

interface TopBarProps {
  title: string
  stage?: 1 | 2
}

/** Глобальная верхняя панель: локап AUREUS, активный экран, переключатель темы. */
export function TopBar({ title, stage }: TopBarProps) {
  const theme = useTheme()
  const nextLabel = theme === 'light' ? 'Тёмная тема' : 'Светлая тема'

  return (
    <header className="topbar">
      <Backdrop variant="shell" />
      <a className="topbar__brand" href={`#/${DEFAULT_SCREEN_ID}`} aria-label="AUREUS — на главный экран">
        <Lockup height={26} title="" />
      </a>
      <span className="topbar__divider" aria-hidden="true" />
      <span className="topbar__screen">{title}</span>
      {stage && (
        <span className={`topbar__stage topbar__stage--s${stage}`} title={STAGE_HINT[stage]}>
          Стадия {stage}
        </span>
      )}
      <span className="topbar__spacer" />
      <button
        type="button"
        className="btn btn--ghost btn--icon topbar__theme"
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        title={nextLabel}
        aria-label={nextLabel}
      >
        <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
      </button>
    </header>
  )
}
