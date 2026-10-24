/**
 * Состояния экранов — один механизм (X2 «честные состояния»): загрузка (skeleton появляется через
 * 150 мс и держится ≥ 300 мс, высота строк — как у итоговых), пустое состояние трёх видов (первое
 * использование · ничего не найдено · недоступно), ошибка простыми словами с «Подробнее» (сырой текст)
 * и «Повторить». Цвет никогда не единственный сигнал.
 */
import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

/** Скелет таблицы: N строк высотой итоговой строки (`rowH`, по умолчанию 32 px — плотные реестры); появляется через 150 мс. */
export function SkeletonRows({ rows = 4, cols = 4, label = 'Загрузка…', rowH }: { rows?: number; cols?: number; label?: string; rowH?: number }) {
  const rowStyle: CSSProperties | undefined = rowH ? { height: rowH } : undefined
  return (
    <div className="dk-skel-stack" role="status" aria-live="polite" aria-busy="true">
      <span className="dk-vh">{label}</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="dk-skel-row" style={rowStyle}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} w={ROW_WIDTHS[(c + r) % ROW_WIDTHS.length]} h={c === 0 ? 14 : 12} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Флаг загрузки без мигания: включается через `delay` мс (быстрые ответы скелета не показывают) и,
 * раз показавшись, держится не меньше `minHold` мс.
 */
export function useDelayedFlag(flag: boolean, delay = 150, minHold = 300): boolean {
  const [shown, setShown] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    if (flag && !shown) {
      const t = window.setTimeout(() => { since.current = Date.now(); setShown(true) }, delay)
      return () => window.clearTimeout(t)
    }
    if (!flag && shown) {
      const left = Math.max(0, minHold - (Date.now() - since.current))
      const t = window.setTimeout(() => setShown(false), left)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [flag, shown, delay, minHold])
  return shown
}

/* ── Баннер ошибки ────────────────────────────────────────────────────────── */
type ErrorTone = 'down' | 'setup' | 'bad' | 'warn'

interface ErrorBannerProps {
  title?: ReactNode
  message?: ReactNode
  /** Исходная ошибка: заголовок — errorText(error), сырой текст — под «Подробнее». */
  error?: unknown
  /** Сырой текст для «Подробнее» (если не передан `error`). */
  detail?: string
  children?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
  /** down/bad — сбой; setup/warn — подсказка, что сделать. */
  tone?: ErrorTone
  onDismiss?: () => void
}

/** Баннер ошибки: ✕/▲ + что случилось простыми словами + что делать («Повторить») + «Подробнее». */
export function ErrorBanner({
  title, message, error, detail, children, onRetry, retryLabel = 'Повторить', retrying = false, tone = 'down', onDismiss,
}: ErrorBannerProps) {
  const warn = tone === 'setup' || tone === 'warn'
  const head = title ?? (error !== undefined ? errorText(error) : undefined)
  const raw = detail ?? (error !== undefined ? errorDetail(error) : '')
  const showRaw = raw && raw !== head && raw !== message
  return (
    <div className={`dk-err${warn ? ' dk-err--setup' : ''} dk-rise`} role={warn ? 'status' : 'alert'}>
      <span className={`${warn ? 'glyph-setup' : 'glyph-x'} dk-err__glyph`} aria-hidden="true" />
      <div className="dk-err__text">
        {head && <div className="dk-err__title">{head}</div>}
        {message && <div className="dk-err__detail">{message}</div>}
        {children}
        {showRaw && (
          <details className="dk-err__more">
            <summary>Подробнее</summary>
            <pre className="dk-err__raw mono">{raw}</pre>
          </details>
        )}
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

/** Сырой текст ошибки (для «Подробнее»): сообщение и код ответа, без перевода. */
export function errorDetail(e: unknown): string {
  const status = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : NaN
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return Number.isFinite(status) && !msg.includes(String(status)) ? `${msg} (HTTP ${status})` : msg
}

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|err_connection|econnrefused|fetch failed/i
const HAS_CYRILLIC = /[а-яё]/i

/**
 * Ошибка простыми словами: что случилось и что делать. Сырой текст («Failed to fetch», «HTTP 401»)
 * пользователю не показывается — он остаётся в «Подробнее» (errorDetail). Русское сообщение
 * сервера («Неверный логин или пароль») сохраняется как есть.
 */
export function errorText(e: unknown, fallback = 'Не удалось выполнить действие — повторите'): string {
  const status = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : NaN
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const code = Number.isFinite(status) ? status : Number(/^HTTP (\d{3})/.exec(raw)?.[1] ?? NaN)
  if (NETWORK.test(raw)) return 'Сервер недоступен — проверьте, что запущен maos-server'
  if (code === 401) return /логин|пароль/i.test(raw) ? 'Неверный логин или пароль' : 'Сессия истекла — войдите снова'
  if (code === 403) return /заблок/i.test(raw) ? raw : 'Нет прав на это действие'
  if (code === 404 || /not found/i.test(raw)) return 'Объект не найден'
  if (code >= 500 && code < 600) return HAS_CYRILLIC.test(raw) ? raw : 'Ошибка сервера — повторите'
  if (/unexpected token|json|empty response/i.test(raw)) return 'Сервер вернул неожиданный ответ — повторите'
  if (raw && HAS_CYRILLIC.test(raw)) return raw
  return fallback
}

/* ── Пустое состояние ─────────────────────────────────────────────────────── */
export type MarkVariant = 'table' | 'chart' | 'flow' | 'search' | 'log'

/** Вид пустоты: первое использование (что сделать) · ничего не найдено (сбросить фильтры) · недоступно (почему). */
export type EmptyKind = 'first-use' | 'no-results' | 'unavailable'

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
  kind?: EmptyKind
  /** «Сбросить фильтры» у kind='no-results'. */
  onReset?: () => void
  /** Тихий вариант без атмосферы (внутри таблиц и карточек). */
  quiet?: boolean
}

export function EmptyState({ title, children, text, diagram, variant, action, size = 'md', kind, onReset, quiet = false }: EmptyStateProps) {
  const meta = getDiagram(diagram)
  const body = children ?? text
  const mark = variant ?? (kind === 'no-results' ? 'search' : 'table')
  const reset = kind === 'no-results' && onReset
    ? <button type="button" className="btn" onClick={onReset}>Сбросить фильтры</button>
    : null
  const cls = ['dk-empty', `dk-empty--${size}`, kind ? `dk-empty--${kind}` : '', quiet ? 'dk-empty--quiet' : '', 'dk-rise'].filter(Boolean).join(' ')
  return (
    <div className={cls} role={kind === 'unavailable' ? 'status' : undefined}>
      {!quiet && <Backdrop variant="empty" />}
      <div className="dk-empty__art">
        {meta ? (
          <DiagramGuard fallback={<KandinskyMark variant={mark} />}>
            <meta.Component compact />
          </DiagramGuard>
        ) : (
          <KandinskyMark variant={mark} />
        )}
      </div>
      <div className="dk-empty__body">
        <p className="dk-empty__title">{title}</p>
        {body && <div className="dk-empty__text">{body}</div>}
        {(action || reset) && <div className="dk-empty__action">{action}{reset}</div>}
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
