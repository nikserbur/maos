/**
 * Сегментный переключатель / табы-пилюли со скользящим индикатором (clip-path, измеряется по
 * кнопке — работает и с равными колонками, и с подписями разной длины). Стрелки ←/→, Home/End.
 * kind: radio — выбор режима (radiogroup) · tab — разделы (tablist) · nav — навигация (aria-current).
 */
import {
  useCallback, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import { Icon, type IconName } from '../../shell/icons'
import './kit.css'

export interface SegOption<T extends string> {
  id: T
  label: ReactNode
  title?: string
  /** Счётчик справа от подписи (табы). */
  count?: number
  disabled?: boolean
  icon?: IconName
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegOption<T>>
  value: T
  onChange: (id: T) => void
  label: string
  kind?: 'radio' | 'tab' | 'nav'
  size?: 'sm' | 'md' | 'lg'
  /** Ширина по содержимому (иначе — равные колонки). */
  fit?: boolean
  /** Префикс id для связи tab ↔ tabpanel (`${idBase}-tab-<id>` / `${idBase}-panel-<id>`). */
  idBase?: string
  className?: string
}

const PAD = 3

export function Segmented<T extends string>({
  options, value, onChange, label, kind = 'radio', size = 'md', fit = false, idBase, className,
}: SegmentedProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef(new Map<T, HTMLButtonElement>())
  const [clip, setClip] = useState<{ l: number; r: number } | null>(null)

  const measure = useCallback(() => {
    const root = rootRef.current
    const btn = btnRefs.current.get(value)
    if (!root || !btn) { setClip(null); return }
    const inner = root.clientWidth - PAD * 2
    const l = btn.offsetLeft - PAD
    const r = inner - (l + btn.offsetWidth)
    setClip((prev) => (prev && prev.l === l && prev.r === r ? prev : { l, r }))
  }, [value])

  useLayoutEffect(() => {
    measure()
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [measure, options])

  const enabled = options.filter((o) => !o.disabled)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.findIndex((o) => o.id === value)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % enabled.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = enabled.length - 1
    if (next < 0 || !enabled[next]) return
    e.preventDefault()
    onChange(enabled[next].id)
    btnRefs.current.get(enabled[next].id)?.focus()
  }

  const role = kind === 'tab' ? 'tablist' : kind === 'radio' ? 'radiogroup' : undefined
  const indStyle = clip ? ({ '--l': `${clip.l}px`, '--r': `${clip.r}px` } as CSSProperties) : undefined
  const cls = ['dk-seg', `dk-seg--${size}`, fit ? 'dk-seg--fit' : '', className ?? ''].filter(Boolean).join(' ')

  return (
    <div ref={rootRef} className={cls} role={role} aria-label={label} onKeyDown={onKeyDown}>
      {clip && <span className="dk-seg__ind" style={indStyle} aria-hidden="true" />}
      {options.map((o) => {
        const on = o.id === value
        const a11y = kind === 'tab'
          ? { role: 'tab' as const, 'aria-selected': on, tabIndex: on ? 0 : -1,
              id: idBase ? `${idBase}-tab-${o.id}` : undefined, 'aria-controls': idBase ? `${idBase}-panel-${o.id}` : undefined }
          : kind === 'radio'
            ? { role: 'radio' as const, 'aria-checked': on, tabIndex: on ? 0 : -1 }
            : { 'aria-current': on ? ('true' as const) : undefined }
        return (
          <button
            key={o.id}
            type="button"
            data-seg={o.id}
            className={`dk-seg__opt${on ? ' is-on' : ''}`}
            disabled={o.disabled}
            title={o.title}
            ref={(el) => { if (el) btnRefs.current.set(o.id, el); else btnRefs.current.delete(o.id) }}
            onClick={() => onChange(o.id)}
            {...a11y}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            {o.label}
            {o.count !== undefined && <span className="dk-seg__count">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

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
  idBase?: string
}

/** Табы-«таблетки» разделов: тот же Segmented, kind="tab", крупный размер, ширина по содержимому. */
export function PillTabs<T extends string>({ tabs, value, onChange, ariaLabel, idBase }: PillTabsProps<T>) {
  const options = tabs.map((t) => ({ id: t.id, icon: t.icon, label: <>{t.label}{t.badge}</> }))
  return <Segmented options={options} value={value} onChange={onChange} label={ariaLabel} kind="tab" size="lg" fit idBase={idBase} />
}
