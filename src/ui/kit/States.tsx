/**
 * Состояния экранов: skeleton-загрузка, пустое состояние «Кандинский» (схема из src/diagrams или
 * малая композиция ● ■ ▲), баннер ошибки с «Повторить». Цвет никогда не единственный сигнал.
 */
import { Component, type CSSProperties, type ReactNode } from 'react'
import { Backdrop } from '../../brand/Backdrop'
import { getDiagram, type DiagramId } from '../../diagrams'
import { Icon } from '../../shell/icons'
import './kit.css'

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
interface SkeletonProps {
  h?: number | string
  w?: number | string
  radius?: string
  className?: string
}

/** Размер — данные компонента (ширина/высота плашки), поэтому через style. */
export function Skeleton({ h = 14, w, radius, className }: SkeletonProps) {
  const style: CSSProperties = { height: h, width: w, borderRadius: radius }
  return <span className={`dk-skel${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />
}

const ROW_WIDTHS = ['38%', '22%', '16%', '12%', '18%', '10%']

/** Скелет таблицы: N строк с колонками разной ширины. */
export function SkeletonRows({ rows = 4, cols = 4, label = 'Загрузка…' }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div className="dk-skel-stack" role="status" aria-live="polite" aria-busy="true">
      <span className="dk-vh">{label}</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="dk-skel-row">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} w={ROW_WIDTHS[(c + r) % ROW_WIDTHS.length]} h={c === 0 ? 14 : 12} />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Баннер ошибки ────────────────────────────────────────────────────────── */
type ErrorTone = 'down' | 'setup' | 'bad' | 'warn'

interface ErrorBannerProps {
  title?: ReactNode
  message?: ReactNode
  children?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
  /** down/bad — сбой; setup/warn — подсказка, что сделать. */
  tone?: ErrorTone
  onDismiss?: () => void
}

/** Баннер ошибки: ■/▲ + заголовок + подробности + «Повторить» (+ закрыть). */
export function ErrorBanner({
  title, message, children, onRetry, retryLabel = 'Повторить', retrying = false, tone = 'down', onDismiss,
}: ErrorBannerProps) {
  const warn = tone === 'setup' || tone === 'warn'
  return (
    <div className={`dk-err${warn ? ' dk-err--setup' : ''} dk-rise`} role={warn ? 'status' : 'alert'}>
      <span className={`${warn ? 'glyph-setup' : 'glyph-down'} dk-err__glyph`} aria-hidden="true" />
      <div className="dk-err__text">
        {title && <div className="dk-err__title">{title}</div>}
        {message && <div className="dk-err__detail">{message}</div>}
        {children}
      </div>
      {onRetry && (
        <button type="button" className="btn btn--sm" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Повторяем…' : retryLabel}
        </button>
      )}
      {onDismiss && (
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onDismiss} aria-label="Скрыть">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}

/** Прежнее имя из «Плана». */
export const InlineError = ErrorBanner

/** Сообщение ошибки из unknown (fetch/JSON). */
export function errorText(e: unknown, fallback = 'Сервер недоступен или вернул ошибку'): string {
  if (e instanceof Error && e.message) return e.message
  return fallback
}

/* ── Пустое состояние ─────────────────────────────────────────────────────── */
export type MarkVariant = 'table' | 'chart' | 'flow' | 'search' | 'log'

interface EmptyStateProps {
  title: string
  children?: ReactNode
  /** Синоним children (кит НСИ). */
  text?: ReactNode
  /** Схема из src/diagrams (compact); иначе — малая композиция с предметным штрихом. */
  diagram?: DiagramId
  variant?: MarkVariant
  action?: ReactNode
  size?: 'md' | 'sm'
}

export function EmptyState({ title, children, text, diagram, variant = 'table', action, size = 'md' }: EmptyStateProps) {
  const meta = getDiagram(diagram)
  const body = children ?? text
  return (
    <div className={`dk-empty dk-empty--${size} dk-rise`}>
      <Backdrop variant="empty" />
      <div className="dk-empty__art">
        {meta ? (
          <DiagramGuard fallback={<KandinskyMark variant={variant} />}>
            <meta.Component compact />
          </DiagramGuard>
        ) : (
          <KandinskyMark variant={variant} />
        )}
      </div>
      <div className="dk-empty__body">
        <p className="dk-empty__title">{title}</p>
        {body && <div className="dk-empty__text">{body}</div>}
        {action && <div className="dk-empty__action">{action}</div>}
      </div>
    </div>
  )
}

/**
 * Малая композиция словаря A6 (● система · ■ ресурс · ▲ цель · линия потока) на токенах темы;
 * вариант добавляет один «предметный» штрих.
 */
export function KandinskyMark({ variant = 'table', className }: { variant?: MarkVariant; className?: string }) {
  return (
    <svg className={className ?? 'dk-empty__mark'} viewBox="0 0 120 80" role="img" aria-label="Абстрактная композиция: круг, треугольник, квадрат">
      <line x1="6" y1="74" x2="114" y2="8" className="dk-kand__line" />
      <circle cx="40" cy="38" r="22" className="dk-kand__u" />
      <circle cx="40" cy="38" r="26" className="dk-kand__ring" />
      <rect x="76" y="12" width="13" height="13" className="dk-kand__r" transform="rotate(-8 82.5 18.5)" />
      <polygon points="70,66 96,66 83,43" className="dk-kand__o" />
      <circle cx="101" cy="50" r="1.8" className="dk-kand__b" />
      <circle cx="16" cy="18" r="1.4" className="dk-kand__b" />
      {variant === 'table' && (
        <g className="dk-kand__ink" strokeWidth="2" strokeLinecap="round">
          <line x1="29" y1="31" x2="51" y2="31" /><line x1="29" y1="38" x2="47" y2="38" /><line x1="29" y1="45" x2="50" y2="45" />
        </g>
      )}
      {variant === 'chart' && (
        <g className="dk-kand__bone">
          <rect x="29" y="40" width="5" height="9" rx="1" /><rect x="37" y="32" width="5" height="17" rx="1" /><rect x="45" y="27" width="5" height="22" rx="1" />
        </g>
      )}
      {variant === 'flow' && <path d="M 22 60 C 40 60, 52 20, 76 20" className="dk-kand__flow" />}
      {variant === 'search' && (
        <g className="dk-kand__ink" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="38" cy="36" r="8" /><line x1="44" y1="42" x2="51" y2="49" />
        </g>
      )}
      {variant === 'log' && (
        <g className="dk-kand__bone">
          <circle cx="30" cy="31" r="2" /><rect x="35" y="30" width="15" height="2.2" rx="1" />
          <circle cx="30" cy="38" r="2" /><rect x="35" y="37" width="11" height="2.2" rx="1" />
          <circle cx="30" cy="45" r="2" /><rect x="35" y="44" width="14" height="2.2" rx="1" />
        </g>
      )}
    </svg>
  )
}

/** Сбой чужой схемы не роняет пустое состояние. */
class DiagramGuard extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
