/**
 * Боковая панель редактирования (X2 «записи правятся в неблокирующей панели»): правая колонка
 * 360–400 px рядом со списком (список остаётся видимым), заголовок + «⋯», прокручиваемое тело,
 * липкий подвал: слева за разделителем — опасное действие, справа — «Отмена» и «Сохранить изменения».
 * Esc — через общий стек слоёв; фокус возвращается туда, откуда панель открыли (строка таблицы);
 * несохранённые изменения охраняет useLeaveGuard («Есть несохранённые изменения — уйти?»).
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useEscapeLayer } from '../../shell/overlays'
import { LEAVE_MESSAGE } from '../../shell/router'
import { useLeaveGuard } from '../../shell/useLeaveGuard'
import { Icon } from '../../shell/icons'
import { Menu, type MenuItem } from './Menu'
import './kit.css'

interface SidePanelProps {
  title: string
  onClose: () => void
  /** Сохранить; без него подвал не рисуется (панель просмотра). */
  onSave?: () => void
  saveLabel?: string
  cancelLabel?: string
  /** Есть несохранённые изменения: страж ухода, вопрос при Esc/«Отмена», пометка в подвале. */
  dirty?: boolean
  saving?: boolean
  /** Редкие действия заголовка «⋯». */
  menu?: ReadonlyArray<MenuItem>
  /** Опасная зона подвала (кнопка «Удалить…» с подтверждением) — слева, за разделителем. */
  danger?: ReactNode
  children: ReactNode
  className?: string
}

export function SidePanel({
  title, onClose, onSave, saveLabel = 'Сохранить изменения', cancelLabel = 'Отмена', dirty = false, saving = false,
  menu, danger, children, className,
}: SidePanelProps) {
  const titleId = useId()
  const headRef = useRef<HTMLHeadingElement>(null)
  useLeaveGuard(dirty)

  const close = () => {
    if (dirty && typeof window !== 'undefined' && !window.confirm(LEAVE_MESSAGE)) return
    onClose()
  }
  useEscapeLayer('panel', close)

  // Фокус — на заголовок при открытии; при закрытии — туда, откуда открыли (строка списка).
  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    headRef.current?.focus({ preventScroll: true })
    return () => { if (restore?.isConnected) restore.focus({ preventScroll: true }) }
  }, [])

  return (
    <aside className={`dk-side${className ? ` ${className}` : ''}`} aria-labelledby={titleId}>
      <header className="dk-side__hd">
        <h2 className="dk-side__title" id={titleId} ref={headRef} tabIndex={-1}>{title}</h2>
        {menu && menu.length > 0 && <Menu items={menu} label="Ещё действия" size="sm" />}
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={close} aria-label="Закрыть панель" title="Закрыть (Esc)">
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="dk-side__bd">{children}</div>
      {onSave && (
        <footer className="dk-side__ft">
          {danger && <div className="dk-side__danger">{danger}</div>}
          <span className="dk-side__spacer" />
          {dirty && <span className="dk-side__dirty">есть изменения</span>}
          <button type="button" className="btn" onClick={close} disabled={saving}>{cancelLabel}</button>
          <button type="button" className="btn btn--primary" onClick={onSave} aria-busy={saving || undefined}>
            {saving ? 'Сохраняем…' : saveLabel}
          </button>
        </footer>
      )}
    </aside>
  )
}
