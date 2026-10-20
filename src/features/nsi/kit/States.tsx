/**
 * Состояния экранов S3: skeleton-загрузка, пустое состояние «Кандинский»,
 * баннер ошибки с повтором (DESIGN-BAR §7). Цвет никогда не единственный
 * сигнал: ошибка = ■ + текст.
 */
import type { CSSProperties, ReactNode } from 'react'
import { Backdrop } from '../../../brand/Backdrop'
import './kit.css'

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
interface SkeletonProps {
  w?: number | string
  h?: number | string
  radius?: string
  className?: string
}

export function Skeleton({ w = '100%', h = 12, radius, className }: SkeletonProps) {
  const style: CSSProperties = { width: w, height: h, borderRadius: radius }
  return <span className={`sk-skel${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />
}

/** Скелет таблицы: шапка + N строк с колонками разной ширины. */
export function SkeletonRows({ rows = 6, cols = 4, label = 'Загрузка…' }: { rows?: number; cols?: number; label?: string }) {
  const widths = ['38%', '22%', '16%', '12%', '18%', '10%']
  return (
    <div className="sk-skel-stack" role="status" aria-live="polite">
      <span className="sk-visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="sk-skel-row">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} w={widths[(c + r) % widths.length]} h={c === 0 ? 14 : 12} />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Пустое состояние ─────────────────────────────────────────────────────── */
export type MarkVariant = 'table' | 'chart' | 'flow' | 'search' | 'log'

/**
 * Малая композиция словаря A6 (● система · ■ ресурс · ▲ цель · линия потока)
 * на токенах темы. Вариант добавляет один «предметный» штрих.
 */
export function KandinskyMark({ variant = 'table', className }: { variant?: MarkVariant; className?: string }) {
  return (
    <svg className={className ?? 'sk-empty__mark'} viewBox="0 0 120 80" aria-hidden="true" focusable="false">
      <line x1="6" y1="74" x2="114" y2="8" stroke="var(--text-muted)" strokeWidth="1" strokeOpacity="0.55" />
      <circle cx="40" cy="38" r="22" fill="var(--ultramarine)" fillOpacity="0.88" />
      <circle cx="40" cy="38" r="22" fill="none" stroke="var(--bone)" strokeOpacity="0.18" />
      <rect x="76" y="12" width="13" height="13" fill="var(--cinnabar)" transform="rotate(-8 82.5 18.5)" />
      <polygon points="70,66 96,66 83,43" fill="var(--ochre-fill)" fillOpacity="0.92" />
      <circle cx="101" cy="50" r="1.8" fill="var(--text-secondary)" />
      <circle cx="16" cy="18" r="1.4" fill="var(--text-secondary)" />
      {variant === 'table' && (
        <g stroke="var(--bone)" strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round">
          <line x1="29" y1="31" x2="51" y2="31" />
          <line x1="29" y1="38" x2="47" y2="38" />
          <line x1="29" y1="45" x2="50" y2="45" />
        </g>
      )}
      {variant === 'chart' && (
        <g fill="var(--bone)" fillOpacity="0.8">
          <rect x="29" y="40" width="5" height="9" rx="1" />
          <rect x="37" y="32" width="5" height="17" rx="1" />
          <rect x="45" y="27" width="5" height="22" rx="1" />
        </g>
      )}
      {variant === 'flow' && (
        <path d="M 22 60 C 40 60, 52 20, 76 20" fill="none" stroke="var(--verdigris)" strokeWidth="3" strokeLinecap="round" />
      )}
      {variant === 'search' && (
        <g fill="none" stroke="var(--bone)" strokeOpacity="0.85" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="38" cy="36" r="8" />
          <line x1="44" y1="42" x2="51" y2="49" />
        </g>
      )}
      {variant === 'log' && (
        <g fill="var(--bone)" fillOpacity="0.85">
          <circle cx="30" cy="31" r="2" /><rect x="35" y="30" width="15" height="2.2" rx="1" />
          <circle cx="30" cy="38" r="2" /><rect x="35" y="37" width="11" height="2.2" rx="1" />
          <circle cx="30" cy="45" r="2" /><rect x="35" y="44" width="14" height="2.2" rx="1" />
        </g>
      )}
    </svg>
  )
}

interface EmptyStateProps {
  title: string
  text?: ReactNode
  action?: ReactNode
  variant?: MarkVariant
  compact?: boolean
}

/** Пустое состояние: композиция «Кандинский» на статичной атмосфере + пояснение + CTA. */
export function EmptyState({ title, text, action, variant = 'table', compact = false }: EmptyStateProps) {
  return (
    <div className={`sk-empty${compact ? ' sk-empty--compact' : ''}`}>
      <Backdrop variant="empty" />
      <KandinskyMark variant={variant} />
      <p className="sk-empty__title">{title}</p>
      {text && <p className="sk-empty__text">{text}</p>}
      {action && <div className="sk-empty__cta">{action}</div>}
    </div>
  )
}

/* ── Ошибка ───────────────────────────────────────────────────────────────── */
interface ErrorBannerProps {
  title?: string
  message: string
  onRetry?: () => void
  retrying?: boolean
}

/** Баннер ошибки: ■ + что не получилось + подробности + «Повторить». */
export function ErrorBanner({ title = 'Не удалось загрузить данные', message, onRetry, retrying = false }: ErrorBannerProps) {
  return (
    <div className="sk-error sk-rise" role="alert">
      <span className="glyph-down" aria-hidden="true" />
      <p className="sk-error__msg">
        <b>{title}</b>
        <span className="sk-error__detail">{message}</span>
      </p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Повторяем…' : 'Повторить'}
        </button>
      )}
    </div>
  )
}

/** Сообщение ошибки из unknown (fetch/JSON). */
export function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  return 'Сервер недоступен или вернул ошибку'
}
