/**
 * «i» — как считается число: поповер с формулой, живой подстановкой значений,
 * обозначениями, методом, оговорками, мини-схемой и ссылкой в «Методику».
 * Контракт: docs/AUDIT-2026-10.md §4.3.
 *
 *   <InfoTip id="plan.makespan" values={{ mean: 1123, det: 980, n: 600 }} />
 *   <MetricLabel id="plan.otd" values={{ otd: 0.93, n: 14, n_late: 1 }}>OTD</MetricLabel>
 *
 * Доли передаются долями (0.93 → «93 %»), деньги — в рублях, время — в часах (если в реестре не указано иное);
 * строковое значение подставляется как есть.
 */
import {
  Component,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/react-dom'
import { getDiagram } from '../diagrams'
import { methodologyHref } from '../explain/anchors'
import { bindFormulaParts, fmtValue, type FormatInput } from '../explain/format'
import { getMetric } from '../explain/metrics'
import type { MetricExplain } from '../explain/types'
import './infotip.css'

export type InfoTipValues = Readonly<Record<string, FormatInput>>

export interface InfoTipProps {
  /** Id метрики из реестра src/explain/metrics.ts (напр. `plan.makespan`). */
  id: string
  /** Живые значения для подстановки в формулу: ключи = `{key}` формулы. */
  values?: InfoTipValues
  /** Предпочтительное положение поповера (floating-ui), по умолчанию `bottom-start`. */
  placement?: Placement
  /** Доступное имя кнопки; по умолчанию «Как считается: <название>». */
  label?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function InfoTip({ id, values, placement = 'bottom-start', label }: InfoTipProps) {
  const entry = getMetric(id)
  if (!entry) {
    // Неизвестный id: в продакшене — ничего; в разработке — заметная пустая метка без консоли.
    return import.meta.env.DEV ? <span className="infotip infotip--missing" aria-hidden="true">i</span> : null
  }
  return <InfoTipControl entry={entry} values={values} placement={placement} label={label} />
}

interface ControlProps {
  entry: MetricExplain
  values?: InfoTipValues
  placement: Placement
  label?: string
}

function InfoTipControl({ entry, values, placement, label }: ControlProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const focusedRef = useRef(false)
  const popId = useId()
  const titleId = `${popId}-title`

  const { refs, floatingStyles, placement: actualPlacement, isPositioned } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const { setReference, setFloating } = refs

  const setTrigger = useCallback(
    (el: HTMLButtonElement | null) => {
      triggerRef.current = el
      setReference(el)
    },
    [setReference],
  )
  const setPanel = useCallback(
    (el: HTMLDivElement | null) => {
      panelRef.current = el
      setFloating(el)
    },
    [setFloating],
  )

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    focusedRef.current = false
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Фокус внутрь диалога — один раз за открытие, когда поповер уже спозиционирован (виден).
  useEffect(() => {
    if (open && isPositioned && !focusedRef.current) {
      focusedRef.current = true
      panelRef.current?.focus({ preventScroll: true })
    }
  }, [open, isPositioned])

  // Esc и клик снаружи. Esc перехватывается в фазе захвата, чтобы не закрыть заодно модальное окно.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null
      if (!target) return
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, close])

  const onTriggerClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // «i» часто стоит внутри кликабельной карточки KPI — не отдаём ей клик.
    e.preventDefault()
    e.stopPropagation()
    if (open) close(true)
    else setOpen(true)
  }

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  }

  // Фокус-ловушка: Tab/Shift+Tab циклически по ссылке и кнопке поповера.
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Портал не разрывает всплытие в дереве React — гасим его, чтобы не сработали обработчики карточки.
  const stop = (e: SyntheticEvent) => e.stopPropagation()

  const accessibleName = label ?? `Как считается: ${entry.title}`

  return (
    <>
      <button
        ref={setTrigger}
        type="button"
        className="infotip"
        aria-label={accessibleName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={setPanel}
            id={popId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="infotip-pop"
            data-placement={actualPlacement}
            style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
            onKeyDown={onPanelKeyDown}
            onClick={stop}
            onPointerDown={stop}
            onMouseDown={stop}
          >
            <InfoTipContent entry={entry} values={values} titleId={titleId} onClose={() => close(true)} onNavigate={() => close(false)} />
          </div>,
          document.body,
        )}
    </>
  )
}

interface ContentProps {
  entry: MetricExplain
  values?: InfoTipValues
  titleId: string
  onClose: () => void
  onNavigate: () => void
}

function InfoTipContent({ entry, values, titleId, onClose, onNavigate }: ContentProps) {
  const parts = bindFormulaParts(entry.formula, values, entry.variables)
  const diagram = getDiagram(entry.diagram)

  return (
    <div className="infotip-pop__panel">
      <header className="infotip-pop__head">
        <h3 id={titleId} className="infotip-pop__title">{entry.title}</h3>
        <button type="button" className="infotip-pop__close" aria-label="Закрыть" onClick={onClose}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </header>
      <p className="infotip-pop__short">{entry.short}</p>

      <section className="infotip-pop__sec">
        <p className="infotip-pop__label">Формула</p>
        <p className="infotip-pop__formula">
          {parts.map((p, i) =>
            p.kind === 'text' ? (
              <span key={i}>{p.text}</span>
            ) : (
              <span key={i} className={`infotip-pop__val num${p.known ? '' : ' infotip-pop__val--empty'}`}>
                {p.text}
              </span>
            ),
          )}
        </p>
      </section>

      {entry.variables.length > 0 && (
        <section className="infotip-pop__sec">
          <p className="infotip-pop__label">Обозначения</p>
          <dl className="infotip-pop__vars">
            {entry.variables.map((v) => {
              const raw = values?.[v.key]
              const hasValue = raw !== undefined && raw !== null && raw !== ''
              const unitText = v.unit && v.unit !== '—' ? `, ${v.unit}` : ''
              return (
                <div key={v.key} className="infotip-pop__var">
                  <dt>{v.label}{unitText}</dt>
                  <dd className={hasValue ? 'num' : 'is-empty'}>{hasValue ? fmtValue(raw, v.unit) : '—'}</dd>
                </div>
              )
            })}
          </dl>
        </section>
      )}

      <section className="infotip-pop__sec">
        <p className="infotip-pop__label">Метод</p>
        <p className="infotip-pop__text">{entry.method}</p>
      </section>

      {entry.caveats && entry.caveats.length > 0 && (
        <section className="infotip-pop__sec">
          <p className="infotip-pop__label">Оговорки</p>
          <ul className="infotip-pop__caveats">
            {entry.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </section>
      )}

      {diagram && (
        <figure className="infotip-pop__diagram">
          <DiagramBoundary>
            <diagram.Component compact />
          </DiagramBoundary>
          <figcaption>{diagram.title}</figcaption>
        </figure>
      )}

      {entry.learnMore && (
        <a className="infotip-pop__more" href={methodologyHref(entry.learnMore)} onClick={onNavigate}>
          Подробнее в «Методике» →
        </a>
      )}
    </div>
  )
}

/** Сбой схемы не должен ронять экран: поповер просто показывается без неё. */
class DiagramBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export interface MetricLabelProps extends InfoTipProps {
  children: ReactNode
  className?: string
}

/** Подпись показателя + «i» в одну строку: `<MetricLabel id="plan.otd" values={…}>OTD</MetricLabel>`. */
export function MetricLabel({ children, className, ...tip }: MetricLabelProps) {
  return (
    <span className={className ? `metric-label ${className}` : 'metric-label'}>
      {children}
      <InfoTip {...tip} />
    </span>
  )
}
