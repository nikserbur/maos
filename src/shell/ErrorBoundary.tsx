import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Меняется при смене экрана → boundary сбрасывается (см. key в AppShell). */
  label?: string
}
interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Экранный предохранитель: ловит ошибку рендера одного экрана и показывает
 * сообщение вместо того, чтобы обрушить всё приложение в пустой экран.
 * Раньше любой throw в экране размонтировал корень React → чёрный экран.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Оставляем след в консоли для диагностики (dev-режим).
    console.error('[ErrorBoundary] экран упал:', error, info.componentStack)
  }

  private handleReset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="screen-error" role="alert">
        <div className="screen-error__card">
          <h2 className="screen-error__title glyph-down">Экран не удалось отобразить</h2>
          <p className="screen-error__text">
            Внутренняя ошибка модуля. Остальное приложение работает — переключитесь на
            другой раздел или повторите.
          </p>
          <pre className="screen-error__msg mono">{error.message}</pre>
          <button type="button" className="btn" onClick={this.handleReset}>Повторить</button>
        </div>
      </div>
    )
  }
}
