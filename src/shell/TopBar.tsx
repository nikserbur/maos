import { Lockup } from '../brand/Logo'
import { Backdrop } from '../brand/Backdrop'
import { Breadcrumbs } from '../ui/kit'
import { AccountMenu } from './AccountMenu'
import { isMacPlatform, shortcutText } from './commandIndex'
import { useCrumbTitles } from './crumbs'
import { Icon } from './icons'
import { DEFAULT_SCREEN_ID, useHashRoute } from './router'
import { buildCrumbs } from './screens'
import { setTheme, useTheme } from './theme'
import { overlayActions, useOverlays } from './overlays'

/**
 * Глобальная верхняя панель: локап PESCADITO, крошки маршрута («Справочники › Техкарты › ТК-12 Вал» —
 * каноническое имя экрана из screens.tsx и имя объекта, которое сообщил экран), поиск (Cmd/Ctrl+K),
 * MENTAT (Cmd/Ctrl+J), тема и меню учётной записи.
 */
export function TopBar() {
  const theme = useTheme()
  const nextLabel = theme === 'light' ? 'Тёмная тема' : 'Светлая тема'
  const overlays = useOverlays()
  const { screenId, anchor } = useHashRoute()
  useCrumbTitles()
  const mac = isMacPlatform()

  return (
    <header className="topbar">
      <Backdrop variant="shell" />
      <a className="topbar__brand" href={`#/${DEFAULT_SCREEN_ID}`} aria-label="PESCADITO — на главный экран">
        <Lockup height={26} title="" />
      </a>
      <span className="topbar__divider" aria-hidden="true" />
      <Breadcrumbs className="topbar__crumbs" items={buildCrumbs(screenId, anchor)} />
      <span className="topbar__spacer" />
      <button type="button" className="btn btn--ghost topbar__cmd" onClick={overlayActions.openPalette} title="Командная палитра: экраны, сценарии, справочники, прогоны, действия"
        aria-haspopup="dialog" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}>
        <Icon name="search" size={14} />
        <span className="topbar__cmd-label">Найти</span>
        <kbd className="topbar__kbd">{shortcutText('mod+k', mac)}</kbd>
      </button>
      <button type="button" className="btn btn--ghost topbar__mentat" onClick={overlayActions.toggleMentat} aria-pressed={overlays.mentat}
        aria-keyshortcuts={mac ? 'Meta+J' : 'Control+J'} title={`MENTAT: почему так — объяснение по графу расчёта (${shortcutText('mod+j', mac)})`}>
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
      <AccountMenu />
    </header>
  )
}
