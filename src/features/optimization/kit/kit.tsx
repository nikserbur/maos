/**
 * Общий набор UI экранов группы «Решения» (Сценарии · Оптимизация · Прогноз):
 * шапка экрана, сегментный переключатель / табы-пилюли, переключатель, чип статуса,
 * скелетоны, пустое состояние в языке Кандинского, баннер ошибки, ступенчатое появление.
 * Стили — kit.css (префикс dk-), только токены темы.
 */
import {
  Component,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Backdrop } from '../../../brand/Backdrop'
import { getDiagram, type DiagramId } from '../../../diagrams'
import { Icon } from '../../../shell/icons'
import './kit.css'

/** Ступенчатое появление секции: style={rise(2)} (задержка 2 × 40 мс). */
export function rise(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

/* ── Шапка экрана ────────────────────────────────────────────────────────── */
interface ScreenHeaderProps {
  eyebrow?: ReactNode
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

export function ScreenHeader({ eyebrow, title, subtitle, actions }: ScreenHeaderProps) {
  return (
    <header className="dk-head dk-rise">
      <div className="dk-head__text">
        {eyebrow && <p className="dk-head__eyebrow text-caps">{eyebrow}</p>}
        <h1 className="dk-head__title">{title}</h1>
        {subtitle && <p className="dk-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="dk-head__actions">{actions}</div>}
      <span className="dk-head__rule" aria-hidden="true" />
    </header>
  )
}

/* ── Сегментный переключатель / табы-пилюли ─────────────────────────────── */
export interface SegOption<T extends string> {
  id: T
  label: ReactNode
  title?: string
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegOption<T>>
  value: T
  onChange: (id: T) => void
  label: string
  /** radio — выбор режима (radiogroup); tab — переключение разделов (tablist). */
  kind?: 'radio' | 'tab'
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented<T extends string>({
  options, value, onChange, label, kind = 'radio', size = 'md', className,
}: SegmentedProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const index = Math.max(0, options.findIndex((o) => o.id === value))
  const style = { '--n': options.length, '--k': index } as CSSProperties

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = options[(index + step + options.length) % options.length]
    onChange(next.id)
    const btn = rootRef.current?.querySelector<HTMLButtonElement>(`[data-seg="${next.id}"]`)
    btn?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={`dk-seg dk-seg--${size}${className ? ` ${className}` : ''}`}
      role={kind === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      style={style}
      onKeyDown={onKeyDown}
    >
      <span className="dk-seg__thumb" aria-hidden="true" />
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            data-seg={o.id}
            className={`dk-seg__opt${on ? ' is-on' : ''}`}
            role={kind === 'tab' ? 'tab' : 'radio'}
            aria-checked={kind === 'radio' ? on : undefined}
            aria-selected={kind === 'tab' ? on : undefined}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Переключатель ───────────────────────────────────────────────────────── */
interface SwitchProps {
  checked: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  hint?: string
}

export function Switch({ checked, onChange, children, hint }: SwitchProps) {
  return (
    <label className="dk-switch" title={hint}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dk-switch__track" aria-hidden="true"><span className="dk-switch__knob" /></span>
      <span className="dk-switch__label">{children}</span>
    </label>
  )
}

/* ── Чип статуса: цвет + глиф (● ▲ ○ ■ ◆) ───────────────────────────────── */
export type Tone = 'running' | 'setup' | 'idle' | 'down' | 'info'

export function StatusChip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`dk-chip dk-chip--${tone}`} title={title}>
      <span className={`glyph-${tone}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/* ── Скелетоны ───────────────────────────────────────────────────────────── */
export function Skeleton({ h = 14, w, className }: { h?: number; w?: number | string; className?: string }) {
  return <span className={`dk-skel${className ? ` ${className}` : ''}`} style={{ height: h, width: w }} aria-hidden="true" />
}

/* ── Баннер ошибки ───────────────────────────────────────────────────────── */
interface ErrorBannerProps {
  children: ReactNode
  onRetry?: () => void
  tone?: 'down' | 'setup'
}

export function ErrorBanner({ children, onRetry, tone = 'down' }: ErrorBannerProps) {
  return (
    <div className={`dk-err dk-err--${tone} dk-rise`} role="alert">
      <span className={`glyph-${tone} dk-err__glyph`} aria-hidden="true" />
      <div className="dk-err__text">{children}</div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  )
}

/* ── Пустое состояние (Кандинский) ───────────────────────────────────────── */
interface EmptyStateProps {
  title: string
  children?: ReactNode
  /** Схема из src/diagrams (compact); если ещё не зарегистрирована — геометрическая композиция. */
  diagram?: DiagramId
  action?: ReactNode
  size?: 'md' | 'sm'
}

export function EmptyState({ title, children, diagram, action, size = 'md' }: EmptyStateProps) {
  const meta = getDiagram(diagram)
  return (
    <div className={`dk-empty dk-empty--${size} dk-rise`}>
      <Backdrop variant="empty" />
      <div className="dk-empty__art">
        {meta ? (
          <DiagramGuard fallback={<KandinskyMark />}>
            <meta.Component compact />
          </DiagramGuard>
        ) : (
          <KandinskyMark />
        )}
      </div>
      <div className="dk-empty__body">
        <p className="dk-empty__title">{title}</p>
        {children && <div className="dk-empty__text">{children}</div>}
        {action && <div className="dk-empty__action">{action}</div>}
      </div>
    </div>
  )
}

/** Композиция «точка — линия — плоскость»: ● система, ▲ цель, ■ риск. */
function KandinskyMark() {
  return (
    <svg className="dk-kand" viewBox="0 0 240 132" role="img" aria-label="Абстрактная композиция: круг, треугольник, квадрат">
      <line className="dk-kand__line" x1="18" y1="118" x2="222" y2="20" />
      <line className="dk-kand__line dk-kand__line--thin" x1="40" y1="30" x2="196" y2="112" />
      <circle className="dk-kand__u" cx="84" cy="70" r="34" />
      <circle className="dk-kand__ring" cx="84" cy="70" r="46" />
      <path className="dk-kand__o" d="M168 26 196 76h-56z" />
      <rect className="dk-kand__r" x="150" y="88" width="22" height="22" />
      <circle className="dk-kand__b" cx="124" cy="52" r="3.5" />
      <circle className="dk-kand__b" cx="206" cy="104" r="2.5" />
      <circle className="dk-kand__b" cx="36" cy="44" r="2" />
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

/* ── Мелочи ──────────────────────────────────────────────────────────────── */
/** Кнопка с иконкой и подписью (иконки вместо эмодзи). */
export function IconButton({
  icon, children, onClick, disabled, variant, title,
}: {
  icon: string
  children?: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger' | 'ghost'
  title?: string
}) {
  const cls = `btn${variant ? ` btn--${variant}` : ''}${children ? '' : ' btn--icon'}`
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title} aria-label={children ? undefined : title}>
      <Icon name={icon} size={14} />
      {children}
    </button>
  )
}
