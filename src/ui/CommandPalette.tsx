/**
 * Командная палитра (UX-V2 §6.2 `CommandPalette`, G4): Cmd/Ctrl+K в любом месте приложения —
 * экраны, узлы карты, прогоны плана, действия. Поиск и ранжирование — чистый commandIndex.ts;
 * клавиатура — ↑/↓ (Home/End), Enter, Esc; шаблон combobox + listbox (aria-activedescendant).
 * Портал поверх оболочки; фокус возвращается туда, откуда палитру открыли.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { GROUP_LABEL, groupCommands, searchCommands, type CommandItem } from '../shell/commandIndex'
import { Icon } from '../shell/icons'
import './palette.css'

interface Props {
  items: readonly CommandItem[]
  onClose: () => void
}

const LIMIT = 14

export function CommandPalette({ items, onClose }: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const results = useMemo(() => searchCommands(items, q, LIMIT), [items, q])
  const groups = useMemo(() => groupCommands(results), [results])
  const flat = groups.flatMap((g) => g.items)

  useEffect(() => {
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => restore?.focus({ preventScroll: true })
  }, [])
  useEffect(() => { setActive(0) }, [q])

  const run = (it: CommandItem | undefined) => {
    if (!it) return
    onClose()
    if (it.run) it.run()
    else if (it.href) window.location.hash = it.href
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = flat.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (n ? (i + 1) % n : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (n ? (i - 1 + n) % n : 0)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, n - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  const optId = (i: number) => `${listId}-o${i}`
  let idx = -1

  return createPortal(
    <div className="cp-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Командная палитра">
        <div className="cp-field">
          <Icon name="search" size={16} />
          <input ref={inputRef} className="cp-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Экран, узел карты, прогон или действие…" role="combobox" aria-expanded="true" aria-controls={listId}
            aria-activedescendant={flat.length ? optId(active) : undefined} aria-autocomplete="list" />
          <kbd className="cp-kbd">Esc</kbd>
        </div>
        <div className="cp-list" id={listId} role="listbox" aria-label="Результаты">
          {groups.map((g) => (
            <div key={g.group} role="group" aria-label={GROUP_LABEL[g.group]} className="cp-group">
              <p className="cp-group__t text-caps" aria-hidden="true">{GROUP_LABEL[g.group]}</p>
              {g.items.map((it) => {
                idx += 1
                const i = idx
                return (
                  <div key={it.id} id={optId(i)} role="option" aria-selected={i === active} className={`cp-opt${i === active ? ' is-active' : ''}`}
                    onMouseMove={() => setActive(i)} onClick={() => run(it)}>
                    <span className="cp-opt__t">{it.title}</span>
                    {it.hint && <span className="cp-opt__h">{it.hint}</span>}
                  </div>
                )
              })}
            </div>
          ))}
          {flat.length === 0 && <p className="cp-empty">Ничего не нашлось. Попробуйте «план», «CVaR», «агент», «тема».</p>}
        </div>
        <p className="cp-foot mono" aria-hidden="true"><kbd className="cp-kbd">↑</kbd><kbd className="cp-kbd">↓</kbd> выбор · <kbd className="cp-kbd">Enter</kbd> открыть · <kbd className="cp-kbd">⌘K</kbd> / <kbd className="cp-kbd">Ctrl K</kbd> закрыть</p>
      </div>
    </div>,
    document.body,
  )
}
