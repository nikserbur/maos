/**
 * Сигналы «Мониторинга» карточками (владелец: «список подчёркнутых ссылок — невзрачно», «все карточки
 * одного веса»): важность — залитая пилюля своего тона (✕ требует решения · ▲ внимание · ◆ к сведению)
 * и полоса того же тона; заголовок ✕ и ▲ крупнее; позиции — сеткой «имя полностью | изменение справа»;
 * последствие для плана или денег, мета-строка и настоящие кнопки. Первые 5 — сразу, остальное —
 * «Ещё N сигналов». Требующие решения — во всю ширину, остальные — в две колонки на широком экране.
 * Сигналы «○ не рассчитано» — не карточки: одна компактная строка после карточек (`MissingLine`) и чип
 * в главной карточке (`MissingChip`).
 */
import { useId, useState } from 'react'
import { countText } from '../../explain/format'
import { SEVERITY } from './monitorModel'
import { SIGNALS_SHOWN, type Signal, type SignalAction } from './monitorSignals'
import './monitor.css'

const POSITIONS = ['позиция', 'позиции', 'позиций'] as const
const SIGNALS = ['сигнал', 'сигнала', 'сигналов'] as const

const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`

function ActionButton({ a, first, onAction, size = 'sm' }: { a: SignalAction; first: boolean; onAction: (a: SignalAction) => void; size?: 'sm' | 'link' }) {
  const cls = size === 'link' ? 'mon-missing__act' : first ? 'btn btn--sm' : 'btn btn--ghost btn--sm'
  if (a.kind === 'href') return <a className={cls} href={a.href}>{a.label}</a>
  return <button type="button" className={cls} onClick={() => onAction(a)}>{a.label}</button>
}

export function AlertCard({ s, onAction }: { s: Signal; onAction: (a: SignalAction) => void }) {
  const id = useId()
  const sev = SEVERITY[s.severity]
  return (
    <article className={`mon-alert mon-alert--${s.severity}`} aria-labelledby={id}>
      <p className="mon-alert__sev"><span className="mon-alert__glyph" aria-hidden="true">{sev.glyph}</span>{sev.word}</p>
      <h3 className="mon-alert__title" id={id}>{s.title}</h3>
      {s.items && s.items.length > 0 && (
        <ul className="mon-alert__items">
          {s.items.map((it) => (
            <li key={it.name} className="mon-alert__item">
              <span className="mon-alert__name">{it.name}</span>
              {it.value && <span className="mon-alert__val num">{it.value}</span>}
            </li>
          ))}
          {s.more ? <li className="mon-alert__more">и ещё {countText(s.more, POSITIONS)}</li> : null}
        </ul>
      )}
      {s.consequence && <p className="mon-alert__why">{sentence(s.consequence)}</p>}
      {s.meta && s.meta.length > 0 && <p className="mon-alert__meta">{s.meta.join(' · ')}</p>}
      {s.actions.length > 0 && (
        <div className="mon-alert__actions">
          {s.actions.map((a, i) => <ActionButton key={a.label} a={a} first={i === 0} onAction={onAction} />)}
        </div>
      )}
    </article>
  )
}

interface MissingProps {
  signals: readonly Signal[]
  onAction: (a: SignalAction) => void
}

/** Строка «○ Не рассчитано: касса → Рассчитать кассу · план → Построить план» после карточек. */
export function MissingLine({ signals, onAction }: MissingProps) {
  const missing = signals.filter((s) => s.severity === 'missing')
  if (missing.length === 0) return null
  return (
    <p className="mon-missing" id="mon-missing">
      <span className="mon-missing__glyph" aria-hidden="true">{SEVERITY.missing.glyph}</span>
      <span className="mon-missing__lead">Не рассчитано:</span>
      {missing.map((s, i) => (
        <span key={s.key} className="mon-missing__item" title={s.consequence ? sentence(s.consequence) : undefined}>
          {i > 0 && <span className="mon-missing__sep" aria-hidden="true">·</span>}
          {s.short}
          {s.actions[0] && <ActionButton a={s.actions[0]} first onAction={onAction} size="link" />}
        </span>
      ))}
    </p>
  )
}

/**
 * Чип полноты в главной карточке: один пропуск — его имя и действие («○ Не рассчитано: касса →
 * Рассчитать кассу»); несколько — перечень и переход к строке под сигналами.
 */
export function MissingChip({ signals, onAction }: MissingProps) {
  const missing = signals.filter((s) => s.severity === 'missing')
  if (missing.length === 0) return null
  const one = missing.length === 1 ? missing[0] : null
  return (
    <span className="mon-status__gap">
      <span aria-hidden="true">{SEVERITY.missing.glyph}</span>
      Не рассчитано: {missing.map((s) => s.short).join(', ')}
      {one?.actions[0]
        ? <ActionButton a={one.actions[0]} first onAction={onAction} size="link" />
        : !one && <a className="mon-missing__act" href="#mon-missing">что сделать ↓</a>}
    </span>
  )
}

interface AlertListProps {
  signals: readonly Signal[]
  onAction: (a: SignalAction) => void
  shown?: number
}

/** Список сигналов: карточки ✕ ▲ ◆, затем строка «не рассчитано»; тревог нет — честное «в пределах порогов». */
export function AlertList({ signals, onAction, shown = SIGNALS_SHOWN }: AlertListProps) {
  const [all, setAll] = useState(false)
  const cards = signals.filter((s) => s.severity !== 'missing')
  if (signals.length === 0) {
    return <p className="mon-allclear"><span aria-hidden="true">●</span> Сигналов нет: план, касса и прогноз в пределах порогов.</p>
  }
  const visible = all ? cards : cards.slice(0, shown)
  const hidden = cards.length - shown
  return (
    <div className="mon-alerts">
      {cards.length === 0
        ? <p className="mon-allclear"><span aria-hidden="true">●</span> По рассчитанному — в пределах порогов.</p>
        : (
          <ul className="mon-alerts__list">
            {visible.map((s) => <li key={s.key} className={`mon-alerts__item mon-alerts__item--${s.severity}`}><AlertCard s={s} onAction={onAction} /></li>)}
          </ul>
        )}
      {hidden > 0 && (
        <button type="button" className="btn btn--ghost btn--sm mon-alerts__toggle" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Ещё ${countText(hidden, SIGNALS)}`}
        </button>
      )}
      <MissingLine signals={signals} onAction={onAction} />
    </div>
  )
}
