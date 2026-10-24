import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './icons'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Меняется при смене экрана → boundary сбрасывается (см. key в AppShell). */
  label?: string
  /**
   * screen — экран целиком (по умолчанию); panel — боковая панель (MENTAT): сохраняет колонку 480 px
   * с «Закрыть»; inline — полоса/палитра: строка без карточки.
   */
  variant?: 'screen' | 'panel' | 'inline'
  /** Закрыть панель (variant='panel'). */
  onClose?: () => void
  /** Текст простыми словами вместо общего. */
  message?: string
}
interface ErrorBoundaryState {
  error: Error | null
}

const DEFAULT_TEXT: Record<NonNullable<ErrorBoundaryProps['variant']>, string> = {
  screen: 'Внутренняя ошибка модуля. Остальное приложение работает — переключитесь на другой раздел или повторите.',
  panel: 'MENTAT не смог собрать контекст этого экрана — закройте панель или повторите.',
  inline: 'Этот блок не удалось показать — остальное работает.',
}

/**
 * Предохранитель (X2 «у каждой панели свой предохранитель»): ловит ошибку рендера одного экрана,
 * панели или полосы и показывает понятный текст с «Повторить», не роняя остальное приложение.
 * Сырой текст ошибки — только под «Подробнее»; без красного моноширинного текста.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Оставляем след в консоли для диагностики (dev-режим).
    console.error(`[ErrorBoundary] ${this.props.label ?? 'блок'} упал:`, error, info.componentStack)
  }

  private handleReset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const variant = this.props.variant ?? 'screen'
    const text = this.props.message ?? DEFAULT_TEXT[variant]
    const details = error.message ? (
      <details className="screen-error__more">
        <summary>Подробнее</summary>
        <pre className="screen-error__msg mono">{error.message}</pre>
      </details>
    ) : null

    if (variant === 'panel') {
      return (
        <aside className="shell-panel-error" role="alert" aria-labelledby="shell-panel-error-t">
          <header className="shell-panel-error__hd">
            <h2 className="shell-panel-error__title" id="shell-panel-error-t">{this.props.label ?? 'Панель'}</h2>
            {this.props.onClose && (
              <button type="button" className="btn btn--ghost btn--icon" onClick={this.props.onClose} aria-label="Закрыть панель" title="Закрыть (Esc)">
                <Icon name="close" size={16} />
              </button>
            )}
          </header>
          <p className="screen-error__text glyph-x">{text}</p>
          {details}
          <div className="screen-error__actions">
            <button type="button" className="btn" onClick={this.handleReset}>Повторить</button>
            {this.props.onClose && <button type="button" className="btn btn--ghost" onClick={this.props.onClose}>Закрыть</button>}
          </div>
        </aside>
      )
    }

    if (variant === 'inline') {
      return (
        <div className="screen-error screen-error--inline" role="alert">
          <span className="screen-error__text glyph-x">{text}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={this.handleReset}>Повторить</button>
        </div>
      )
    }

    return (
      <div className="screen-error" role="alert">
        <div className="screen-error__card">
          <h2 className="screen-error__title">{this.props.label ? `«${this.props.label}» не удалось показать` : 'Экран не удалось показать'}</h2>
          <p className="screen-error__text glyph-x">{text}</p>
          {details}
          <div className="screen-error__actions">
            <button type="button" className="btn" onClick={this.handleReset}>Повторить</button>
          </div>
        </div>
      </div>
    )
  }
}
