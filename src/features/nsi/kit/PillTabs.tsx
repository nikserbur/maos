import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from '../../../shell/icons'
import './kit.css'

export interface PillTab<T extends string> {
  id: T
  label: string
  icon?: IconName
  /** Короткая метка справа (счётчик и т. п.). */
  badge?: ReactNode
}

interface PillTabsProps<T extends string> {
  tabs: ReadonlyArray<PillTab<T>>
  value: T
  onChange: (id: T) => void
  ariaLabel: string
  /** Префикс id для связи tab ↔ tabpanel (`${idBase}-tab-<id>` / `${idBase}-panel-<id>`). */
  idBase?: string
}

interface IndicatorBox { x: number; w: number }

/**
 * Табы-«таблетки» со скользящим индикатором: анимируется только transform
 * (ширина ставится мгновенно), стрелки ←/→, Home/End переключают вкладку.
 */
export function PillTabs<T extends string>({ tabs, value, onChange, ariaLabel, idBase }: PillTabsProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const btnRefs = useRef(new Map<T, HTMLButtonElement>())
  const [box, setBox] = useState<IndicatorBox | null>(null)
  const [animate, setAnimate] = useState(false)

  const measure = useCallback(() => {
    const btn = btnRefs.current.get(value)
    if (!btn) return
    setBox({ x: btn.offsetLeft, w: btn.offsetWidth })
  }, [value])

  useLayoutEffect(() => {
    measure()
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(list)
    return () => ro.disconnect()
  }, [measure])

  // Анимацию включаем после первого измерения — иначе индикатор «приезжает» из нуля.
  useLayoutEffect(() => {
    if (box && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true))
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [box, animate])

  const focusTab = (id: T) => {
    onChange(id)
    btnRefs.current.get(id)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === value)
    if (at < 0) return
    let next = -1
    if (e.key === 'ArrowRight') next = (at + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    focusTab(tabs[next].id)
  }

  const indClass = `sk-tabs__ind${box ? ' sk-tabs__ind--ready' : ''}${animate ? ' sk-tabs__ind--anim' : ''}`

  return (
    <div ref={listRef} className="sk-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      <span
        className={indClass}
        aria-hidden="true"
        style={box ? { width: box.w, transform: `translateX(${box.x}px)` } : undefined}
      />
      {tabs.map((t) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) btnRefs.current.set(t.id, el)
              else btnRefs.current.delete(t.id)
            }}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${t.id}` : undefined}
            aria-controls={idBase ? `${idBase}-panel-${t.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="sk-tab"
            onClick={() => onChange(t.id)}
          >
            {t.icon && <Icon name={t.icon} size={15} />}
            {t.label}
            {t.badge}
          </button>
        )
      })}
    </div>
  )
}
