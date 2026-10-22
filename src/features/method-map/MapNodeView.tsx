/**
 * Узел-блок на канвасе L0: номер в моно и цвет блока, название, глиф состояния,
 * бейдж контекста (две строки), подвал «n подблоков · k в плане». Развёрнутый блок
 * (↓ / двойной клик) показывает подблоки списком внутри контейнера (L1 без раскладки).
 * Фокусируемый `role="button"`; клавиши обрабатывает канвас.
 */
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import type { BlockMeta } from './blocks'
import type { Rect } from './mapLayout'
import { STATE_META } from './stateMeta'
import { StateGlyph, stateDescription } from './StateGlyph'
import type { MapNode, NodeLive } from './types'

interface MapNodeViewProps {
  rect: Rect
  meta: BlockMeta
  live: NodeLive
  subs: readonly MapNode[]
  subLive: (id: string) => NodeLive
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onToggle: (block: string) => void
  onHover: (id: string | null) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>, id: string) => void
}

export function MapNodeView({ rect, meta, live, subs, subLive, selectedId, hoveredId, onSelect, onToggle, onHover, onKeyDown }: MapNodeViewProps) {
  const planned = subs.filter((s) => subLive(s.id).state === 'planned').length
  const selected = selectedId === meta.id
  const descId = `mm-desc-${meta.id}`
  const cls = [
    'mm-node', `is-${live.state}`,
    selected ? 'is-selected' : '', hoveredId === meta.id ? 'is-hover' : '', rect.expanded ? 'is-expanded' : '',
  ].filter(Boolean).join(' ')

  const onDouble = (e: MouseEvent) => {
    e.preventDefault()
    onToggle(meta.id)
  }

  return (
    <div
      className={cls}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, '--block': meta.colorVar } as CSSProperties}
      role="button"
      tabIndex={0}
      data-node={meta.id}
      aria-pressed={selected}
      aria-expanded={rect.expanded}
      aria-label={`Блок ${meta.n}: ${meta.title}`}
      aria-describedby={descId}
      onClick={() => onSelect(meta.id)}
      onDoubleClick={onDouble}
      onKeyDown={(e) => onKeyDown(e, meta.id)}
      onMouseEnter={() => onHover(meta.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(meta.id)}
      onBlur={() => onHover(null)}
    >
      <header className="mm-node__head">
        <span className="mm-node__n mono">{String(meta.n).padStart(2, '0')}</span>
        <span className="mm-node__title text-caps">{meta.title}</span>
        <StateGlyph state={live.state} className="mm-node__state" />
      </header>
      <p className="mm-node__badge">{live.badge ?? STATE_META[live.state].label}</p>
      {live.detail && <p className="mm-node__detail">{live.detail}</p>}
      {live.reason && live.state !== 'planned' && <p className="mm-node__reason">{live.reason}</p>}
      <footer className="mm-node__foot">
        <span>{subs.length} подбл.{planned ? ` · ${planned} в плане` : ''}</span>
        <button
          type="button"
          className="mm-node__expand"
          tabIndex={-1}
          aria-hidden="true"
          title={rect.expanded ? 'Свернуть (↑)' : 'Развернуть подблоки (↓)'}
          onClick={(e) => { e.stopPropagation(); onToggle(meta.id) }}
        >
          {rect.expanded ? '▴' : '▾'}
        </button>
      </footer>
      <span id={descId} className="mm-sr">{stateDescription(live.state, live.badge, live.reason)}</span>
      {rect.expanded && (
        <ul className="mm-node__subs" aria-label={`Подблоки блока ${meta.n}`}>
          {subs.map((s) => {
            const sl = subLive(s.id)
            const on = selectedId === s.id
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`mm-sub is-${sl.state}${on ? ' is-selected' : ''}`}
                  data-node={s.id}
                  aria-pressed={on}
                  title={sl.badge ? `${s.title} — ${sl.badge}` : s.title}
                  onClick={(e) => { e.stopPropagation(); onSelect(s.id) }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => onKeyDown(e, s.id)}
                >
                  <StateGlyph state={sl.state} />
                  <span className="mm-sub__title">{s.title}</span>
                  {s.stage && s.stage !== 'done' && <span className="mm-sub__stage mono">{s.stage}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
