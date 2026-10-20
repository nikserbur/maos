/**
 * Мелкие примитивы экрана «План»: сегментный переключатель / табы-пилюли со скользящим
 * индикатором (clip-path), чип статуса с глифом, баннер ошибки с «Повторить», skeleton.
 */
import {
  useCallback, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import { Icon } from '../../shell/icons'
import { TONE_GLYPH, type Tone } from './types'

/* ── Сегментный переключатель ───────────────────────────────────────────── */

export interface SegOption<T extends string> {
  id: T
  label: ReactNode
  count?: number
  disabled?: boolean
  title?: string
}

interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SegOption<T>>
  onChange: (id: T) => void
  label: string
  /** radio — выбор режима (radiogroup), nav — навигация по секциям (aria-current). */
  mode?: 'radio' | 'nav'
  size?: 'md' | 'lg'
}

const SEG_PAD = 3

export function Segmented<T extends string>({ value, options, onChange, label, mode = 'radio', size = 'md' }: SegmentedProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef(new Map<T, HTMLButtonElement>())
  const [clip, setClip] = useState<{ l: number; r: number } | null>(null)

  const measure = useCallback(() => {
    const root = rootRef.current
    const btn = btnRefs.current.get(value)
    if (!root || !btn) { setClip(null); return }
    const inner = root.clientWidth - SEG_PAD * 2
    const l = btn.offsetLeft - SEG_PAD
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
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'radio' || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    e.preventDefault()
    const at = enabled.findIndex((o) => o.id === value)
    const next = enabled[(at + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length]
    if (!next) return
    onChange(next.id)
    btnRefs.current.get(next.id)?.focus()
  }

  const indStyle = clip ? ({ '--l': `${clip.l}px`, '--r': `${clip.r}px` } as CSSProperties) : undefined
  return (
    <div ref={rootRef} className={`pl-seg${size === 'lg' ? ' pl-seg--lg' : ''}`}
         role={mode === 'radio' ? 'radiogroup' : undefined} aria-label={label} onKeyDown={onKey}>
      {clip && <span className="pl-seg__ind" style={indStyle} aria-hidden="true" />}
      {options.map((o) => {
        const on = o.id === value
        const a11y = mode === 'radio'
          ? { role: 'radio' as const, 'aria-checked': on, tabIndex: on ? 0 : -1 }
          : { 'aria-current': on ? ('true' as const) : undefined }
        return (
          <button key={o.id} type="button" className="pl-seg__btn" disabled={o.disabled} title={o.title}
                  ref={(el) => { if (el) btnRefs.current.set(o.id, el); else btnRefs.current.delete(o.id) }}
                  onClick={() => onChange(o.id)} {...a11y}>
            {o.label}
            {o.count !== undefined && <span className="pl-seg__count">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ── Чип статуса: цвет --status-* + глиф ────────────────────────────────── */

export function Chip({ tone, children, title }: { tone?: Tone | 'accent'; children: ReactNode; title?: string }) {
  const cls = tone && tone !== 'idle' ? ` pl-chip--${tone}` : ''
  const glyph = tone && tone !== 'accent' ? TONE_GLYPH[tone] : ''
  return <span className={`pl-chip${cls}`} title={title}>{glyph && <span className={glyph} aria-hidden="true" />}{children}</span>
}

/* ── Ошибка с повтором ──────────────────────────────────────────────────── */

interface InlineErrorProps {
  title: string
  message?: string | null
  onRetry?: () => void
  retryLabel?: string
  /** warn — подсказка (что сделать), bad — сбой запроса. */
  tone?: 'bad' | 'warn'
  onDismiss?: () => void
}

export function InlineError({ title, message, onRetry, retryLabel = 'Повторить', tone = 'bad', onDismiss }: InlineErrorProps) {
  return (
    <div className={`pl-alert${tone === 'warn' ? ' pl-alert--warn' : ''}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <span className={`pl-alert__glyph ${tone === 'warn' ? 'glyph-setup' : 'glyph-down'}`} aria-hidden="true" />
      <div className="pl-alert__body">
        <div className="pl-alert__title">{title}</div>
        {message && <div className="pl-alert__text">{message}</div>}
      </div>
      {onRetry && <button type="button" className="btn btn--sm" onClick={onRetry}>{retryLabel}</button>}
      {onDismiss && (
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onDismiss} aria-label="Скрыть">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */

export function SkeletonRows({ rows = 3, label = 'Загрузка' }: { rows?: number; label?: string }) {
  return (
    <div className="pl-skel-stack" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="pl-skel pl-skel--row" />)}
    </div>
  )
}

/* ── Заголовок секции ────────────────────────────────────────────────────── */

interface SectionProps {
  id: string
  title: ReactNode
  meta?: ReactNode
  tools?: ReactNode
  children: ReactNode
}

export function Section({ id, title, meta, tools, children }: SectionProps) {
  return (
    <section id={id} className="pl-sec pl-rise" aria-labelledby={`${id}-t`}>
      <div className="pl-sec__hd">
        <div>
          <h2 className="pl-sec__title" id={`${id}-t`}>{title}</h2>
          {meta && <div className="pl-sec__meta">{meta}</div>}
        </div>
        {tools && <div className="pl-sec__tools">{tools}</div>}
      </div>
      {children}
    </section>
  )
}
