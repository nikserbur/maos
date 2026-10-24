/**
 * Карточки выбора (пресеты сценариев, методы планирования): одна из N, когда каждому варианту
 * нужна фраза пояснения. radiogroup с roving tabindex и стрелками (APG radio), выбранная —
 * акцентная кромка + ✓; недоступная — пунктир и видимая причина (связана aria-describedby).
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from '../../shell/icons'
import { rovingNext } from './rovingKeys'
import './kit.css'

export interface ChoiceCardOption<T extends string> {
  id: T
  title: ReactNode
  /** Одна-две строки: что это и когда выбирать. */
  description?: ReactNode
  /** Мелкая моноширинная строка: «повтор 2020-03 … 2020-08». */
  meta?: ReactNode
  icon?: IconName
  disabled?: boolean
  /** Почему недоступно — видно на карточке. */
  reason?: ReactNode
}

interface ChoiceCardsProps<T extends string> {
  options: ReadonlyArray<ChoiceCardOption<T>>
  value: T | null
  onChange: (id: T) => void
  /** Доступное имя группы (или видимая подпись через `labelledBy`). */
  label: string
  labelledBy?: string
  /** Минимальная ширина карточки в сетке: sm 168 px · md 200 px · lg 260 px. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ChoiceCards<T extends string>({ options, value, onChange, label, labelledBy, size = 'md', className }: ChoiceCardsProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const enabled = options.filter((o) => !o.disabled)
  const focusId = value !== null && enabled.some((o) => o.id === value) ? value : enabled[0]?.id

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = (document.activeElement as HTMLElement | null)?.dataset.choice
    const next = rovingNext(e.key, enabled.findIndex((o) => o.id === current), enabled.length)
    if (next < 0 || !enabled[next]) return
    e.preventDefault()
    onChange(enabled[next].id)
    const el = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-choice]') ?? []).find((n) => n.dataset.choice === enabled[next].id)
    el?.focus()
  }

  return (
    <div ref={rootRef} className={['dk-cards', `dk-cards--${size}`, className ?? ''].filter(Boolean).join(' ')} role="radiogroup"
         aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.id === value
        const reasonId = o.disabled && o.reason ? `${uid}-${o.id}-r` : undefined
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} aria-disabled={o.disabled || undefined}
                  aria-describedby={reasonId} tabIndex={o.id === focusId ? 0 : -1} data-choice={o.id}
                  className={`dk-card-opt${on ? ' is-on' : ''}${o.disabled ? ' is-disabled' : ''}`}
                  onClick={() => { if (!o.disabled) onChange(o.id) }}>
            <span className="dk-card-opt__head">
              {o.icon && <Icon name={o.icon} size={16} />}
              <span className="dk-card-opt__title">{o.title}</span>
              {on && <span className="dk-card-opt__check" aria-hidden="true">✓</span>}
            </span>
            {o.description && <span className="dk-card-opt__desc">{o.description}</span>}
            {o.meta && <span className="dk-card-opt__meta">{o.meta}</span>}
            {reasonId && <span className="dk-card-opt__reason" id={reasonId}>{o.reason}</span>}
          </button>
        )
      })}
    </div>
  )
}
