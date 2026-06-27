import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string
  size?: 'md' | 'lg' | 'full'
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Модальный диалог с порталом, backdrop-ом и Escape-закрытием. */
export function Modal({ title, size = 'md', onClose, children, footer }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-overlay" onPointerDown={onClose} role="presentation">
      <div
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="modal__hd">
          <h2 className="modal__title">{title}</h2>
          <button className="modal__x btn" onClick={onClose} aria-label="Закрыть">✕</button>
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
