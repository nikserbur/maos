/**
 * Шапка экрана единого кита: eyebrow · дисплейный заголовок · чипы блоков карты · подзаголовок ·
 * действия справа · бренд-волосяная линия. Одна высота на всех экранах (X1 §10 2.1).
 */
import type { CSSProperties, ReactNode } from 'react'
import { BlockChips } from '../BlockChip'
import type { BlockId } from '../../features/method-map/types'
import './kit.css'

/** Ступенчатое появление секции: style={rise(2)} (задержка 2 × 40 мс). */
export function rise(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

interface ScreenHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Блоки карты методологии, которые реализует экран — чипы «[n] Название ↗» (UX-V2 §2.6). */
  blocks?: readonly BlockId[]
  className?: string
}

export function ScreenHeader({ eyebrow, title, subtitle, actions, blocks, className }: ScreenHeaderProps) {
  return (
    <header className={`dk-head dk-rise${className ? ` ${className}` : ''}`}>
      <div className="dk-head__text">
        {eyebrow && <p className="dk-head__eyebrow text-caps">{eyebrow}</p>}
        <h1 className="dk-head__title">
          {title}
          {blocks && blocks.length > 0 && <span className="dk-head__blocks"><BlockChips blocks={blocks} /></span>}
        </h1>
        {subtitle && <p className="dk-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="dk-head__actions">{actions}</div>}
      <span className="dk-head__rule" aria-hidden="true" />
    </header>
  )
}

interface SectionProps {
  id: string
  title: ReactNode
  meta?: ReactNode
  tools?: ReactNode
  children: ReactNode
}

/** Секция экрана с заголовком h2, метой и инструментами справа (оглавление ссылается на id). */
export function Section({ id, title, meta, tools, children }: SectionProps) {
  return (
    <section id={id} className="dk-sec dk-rise" aria-labelledby={`${id}-t`}>
      <div className="dk-sec__hd">
        <div>
          <h2 className="dk-sec__title" id={`${id}-t`}>{title}</h2>
          {meta && <div className="dk-sec__meta">{meta}</div>}
        </div>
        {tools && <div className="dk-sec__tools">{tools}</div>}
      </div>
      {children}
    </section>
  )
}
