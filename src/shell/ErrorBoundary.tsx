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
      <div style={{ padding: 32, maxWidth: 720 }}>
        <div style={{
          padding: '18px 20px',
          background: 'rgba(205,66,70,.10)',
          border: '1px solid rgba(205,66,70,.4)',
          borderRadius: 'var(--radius-lg, 12px)',
          color: 'var(--text)',
        }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Экран не удалось отобразить</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
            Внутренняя ошибка модуля. Остальное приложение работает — переключитесь на
            другой раздел или повторите.
          </p>
          <pre style={{
            margin: '0 0 12px', padding: 10, fontSize: 12, overflowX: 'auto',
            background: 'var(--bg-app, #111)', borderRadius: 'var(--radius, 8px)',
            color: '#f2b8b5', whiteSpace: 'pre-wrap',
          }}>{error.message}</pre>
          <button className="btn" onClick={this.handleReset}>Повторить</button>
        </div>
      </div>
    )
  }
}
