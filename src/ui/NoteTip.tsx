/**
 * «i» без записи в реестре метрик: свободное пояснение к полю (X1 §3.1 — заметки полей
 * уходят в «i»). Та же кнопка и тот же поповер, что у `InfoTip`: Esc, клик снаружи,
 * возврат фокуса. Для метрик реестра используйте `InfoTip` (там формула и метод).
 */
import { useCallback, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { Placement } from '@floating-ui/react-dom'
import { InfoTipPopover } from './InfoTip'
import './infotip.css'

export interface NoteTipProps {
  /** Заголовок поповера — обычно подпись поля. */
  title: string
  children: ReactNode
  placement?: Placement
}

export function NoteTip({ title, children, placement = 'bottom-start' }: NoteTipProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popId = useId()
  const titleId = `${popId}-title`
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])
  const onTriggerClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // «i» стоит внутри label/карточки — клик не должен уходить родителю.
    e.preventDefault()
    e.stopPropagation()
    if (open) close(true)
    else setOpen(true)
  }
  return (
    <>
      <button ref={triggerRef} type="button" className="infotip" aria-label={`Пояснение: ${title}`} aria-haspopup="dialog"
              aria-expanded={open} aria-controls={open ? popId : undefined} onClick={onTriggerClick}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}>
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <InfoTipPopover anchor={triggerRef.current} placement={placement} popId={popId} titleId={titleId} onClose={close}>
          <div className="infotip-pop__panel">
            <header className="infotip-pop__head">
              <h3 id={titleId} className="infotip-pop__title">{title}</h3>
              <button type="button" className="infotip-pop__close" aria-label="Закрыть" onClick={() => close(true)}>
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                  <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                </svg>
              </button>
            </header>
            <div className="infotip-pop__text">{children}</div>
          </div>
        </InfoTipPopover>
      )}
    </>
  )
}
