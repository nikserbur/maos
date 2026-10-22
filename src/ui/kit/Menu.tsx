/**
 * Меню действий «⋯» единого кита (X1 §3 п. 3): редкие и опасные действия («Удалить»)
 * убираются из ряда кнопок рядом с «Сохранено». Клавиатура: ↓/Enter/Space открывает и ставит
 * фокус на первый пункт, ↑/↓ и Home/End ходят по пунктам, Esc и Tab закрывают, фокус
 * возвращается на кнопку; клик снаружи закрывает. Иконка — SVG, не глиф в тексте.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from '../../shell/icons'
import './menu.css'

export interface MenuItem {
  id: string
  label: ReactNode
  icon?: IconName
  onSelect: () => void
  /** Опасное действие — красный тон, визуально отделено. */
  danger?: boolean
  disabled?: boolean
  /** Подпись-подсказка под пунктом. */
  hint?: string
}

interface MenuProps {
  items: ReadonlyArray<MenuItem>
  /** Доступное имя кнопки, например «Ещё действия». */
  label: string
  /** Подпись кнопки; без неё — квадратная кнопка с тремя точками. */
  children?: ReactNode
  align?: 'start' | 'end'
  size?: 'sm' | 'md'
}

export function Menu({ items, label, children, align = 'end', size = 'md' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  const focusItem = (index: number) => {
    const nodes = itemNodes()
    if (!nodes.length) return
    const i = ((index % nodes.length) + nodes.length) % nodes.length
    nodes[i].focus()
  }
  const itemNodes = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])

  // Открыли — фокус на первый пункт; клик снаружи и Esc закрывают.
  useEffect(() => {
    if (!open) return
    focusItem(0)
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])

  const onButtonKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
  }
  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = itemNodes()
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement)
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusItem(at + 1); break
      case 'ArrowUp': e.preventDefault(); focusItem(at - 1); break
      case 'Home': e.preventDefault(); focusItem(0); break
      case 'End': e.preventDefault(); focusItem(nodes.length - 1); break
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break
      case 'Tab': close(false); break
    }
  }
  const select = (item: MenuItem) => { close(true); item.onSelect() }

  const btnCls = ['btn', children ? '' : 'btn--icon', size === 'sm' ? 'btn--sm' : '', open ? 'is-open' : ''].filter(Boolean).join(' ')
  return (
    <div className={`dk-menu dk-menu--${align}`} ref={rootRef}>
      <button ref={buttonRef} type="button" className={btnCls} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined}
              aria-label={children ? undefined : label} title={children ? undefined : label}
              onClick={() => setOpen((v) => !v)} onKeyDown={onButtonKeyDown}>
        <DotsIcon />
        {children}
      </button>
      {open && (
        <div ref={listRef} id={listId} role="menu" aria-label={label} className="dk-menu__list" onKeyDown={onListKeyDown}>
          {items.map((it) => (
            <button key={it.id} type="button" role="menuitem" disabled={it.disabled} title={it.hint}
                    className={`dk-menu__item${it.danger ? ' dk-menu__item--danger' : ''}`} onClick={() => select(it)}>
              {it.icon && <Icon name={it.icon} size={14} />}
              <span className="dk-menu__label">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}
