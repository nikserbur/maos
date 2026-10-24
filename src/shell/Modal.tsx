import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { useEscapeLayer } from './overlays'

interface ModalProps {
  title: string
  size?: 'md' | 'lg' | 'full'
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Стек открытых модалок: ловушка фокуса работает только у верхней; Esc — общий стек слоёв (overlays.ts). */
const openStack: number[] = []
let nextModalId = 0

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  )
}

/** Tab/Shift+Tab циклически внутри диалога. */
function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  const items = focusables(root)
  if (items.length === 0) {
    event.preventDefault()
    root.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const current = document.activeElement
  const outside = !root.contains(current)
  if (event.shiftKey && (current === first || outside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (current === last || outside)) {
    event.preventDefault()
    first.focus()
  }
}

/** Модальный диалог: портал, затемнение (без blur над WebGL), Esc (стек слоёв), ловушка фокуса, возврат фокуса. */
export function Modal({ title, size = 'md', onClose, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Esc закрывает только самый внутренний слой (подсказка/меню внутри модалки — раньше неё).
  useEscapeLayer('modal', () => onCloseRef.current())

  useEffect(() => {
    const id = ++nextModalId
    openStack.push(id)
    const dialog = dialogRef.current
    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Начальный фокус: autoFocus внутри уже сработал → не трогаем; иначе первое поле тела.
    if (dialog && !dialog.contains(document.activeElement)) {
      const body = dialog.querySelector<HTMLElement>('.modal__bd')
      const target = (body && focusables(body)[0]) ?? dialog
      target.focus({ preventScroll: true })
    }

    const onKey = (event: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id || !dialog) return
      if (event.key === 'Tab') trapTab(event, dialog)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = openStack.indexOf(id)
      if (at >= 0) openStack.splice(at, 1)
      if (restoreTo && restoreTo.isConnected) restoreTo.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className="modal-overlay" onPointerDown={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="modal__hd">
          <h2 className="modal__title" id={titleId}>{title}</h2>
          <button type="button" className="modal__x btn btn--ghost btn--icon" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className={`modal__bd${size === 'full' ? ' modal__bd--flush' : ''}`}>
          {children}
        </div>
        {footer && <footer className="modal__ft">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
