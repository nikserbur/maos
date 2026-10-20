import type { ReactNode } from 'react'
import './kit.css'

interface ScreenHeaderProps {
  title: string
  subtitle?: ReactNode
  /** Надстрочник caps над заголовком (раздел, стадия). */
  eyebrow?: string
  /** Основные действия экрана — справа. */
  actions?: ReactNode
}

/** Шапка экрана: дисплейный заголовок, строка пояснения, действия, волосяная бренд-линия. */
export function ScreenHeader({ title, subtitle, eyebrow, actions }: ScreenHeaderProps) {
  return (
    <header className="sk-head sk-rise">
      <div className="sk-head__text">
        {eyebrow && <p className="text-caps sk-head__eyebrow">{eyebrow}</p>}
        <h1 className="sk-head__title">{title}</h1>
        {subtitle && <p className="sk-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="sk-head__actions">{actions}</div>}
      <span className="sk-head__rule" aria-hidden="true" />
    </header>
  )
}
