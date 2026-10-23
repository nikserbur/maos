import { Lockup } from '../brand/Logo'
import { Backdrop } from '../brand/Backdrop'
import { Icon } from './icons'
import { DEFAULT_SCREEN_ID } from './router'
import { setTheme, useTheme } from './theme'
import { overlayActions, useOverlays } from './overlays'

interface TopBarProps {
  title: string
}

/**
 * Глобальная верхняя панель: локап PESCADITO, активный экран, переключатель темы.
 * Стадия ①/② показывается только бейджем на рельсе (X1 §6.9: дубликат в панели снят).
 */
export function TopBar({ title }: TopBarProps) {
  const theme = useTheme()
  const nextLabel = theme === 'light' ? 'Тёмная тема' : 'Светлая тема'
  const overlays = useOverlays()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <header className="topbar">
      <Backdrop variant="shell" />
      <a className="topbar__brand" href={`#/${DEFAULT_SCREEN_ID}`} aria-label="PESCADITO — на главный экран">
        <Lockup height={26} title="" />
      </a>
      <span className="topbar__divider" aria-hidden="true" />
      <span className="topbar__screen">{title}</span>
      <span className="topbar__spacer" />
      <button type="button" className="btn btn--ghost topbar__cmd" onClick={overlayActions.openPalette} title="Командная палитра: экраны, узлы, прогоны, действия"
        aria-haspopup="dialog" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}>
        <Icon name="search" size={14} />
        <span className="topbar__cmd-label">Найти</span>
        <kbd className="topbar__kbd">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <button type="button" className="btn btn--ghost topbar__mentat" onClick={overlayActions.toggleMentat} aria-pressed={overlays.mentat}
        title="MENTAT: почему так (заготовка — LLM подключится позже)">
        <Icon name="bulb" size={14} />
        <span className="topbar__cmd-label">MENTAT</span>
      </button>
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
