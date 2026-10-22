/**
 * Карта на узких экранах (< 960 px, UX-V2 §3.12): вертикальный список блоков —
 * аккордеон с теми же бейджами и состояниями; рёбра — текстом «→ в [4] Решения».
 */
import type { CSSProperties } from 'react'
import { BLOCKS, blockTag } from './blocks'
import { L0_EDGES } from './edges'
import { liveOf } from './deriveState'
import { getNode, subblocksOf } from './registry'
import { STATE_META } from './stateMeta'
import { StateGlyph } from './StateGlyph'
import type { MethodMapState } from './types'

interface MapListProps {
  live: MethodMapState
  selectedId: string | null
  onSelect: (id: string) => void
}

export function MapList({ live, selectedId, onSelect }: MapListProps) {
  return (
    <div className="mm-list-view" role="list" aria-label="Блоки методологии">
      {BLOCKS.map((b) => {
        const l = liveOf(live, b.id)
        const out = L0_EDGES.filter((e) => e.from === b.id && e.to !== b.id)
        return (
          <details key={b.id} className={`mm-acc is-${l.state}`} style={{ '--block': b.colorVar } as CSSProperties} role="listitem" open={selectedId !== null && getNode(selectedId)?.block === b.id}>
            <summary className="mm-acc__sum">
              <span className="mm-node__n mono">{String(b.n).padStart(2, '0')}</span>
              <span className="mm-acc__title">{b.title}</span>
              <StateGlyph state={l.state} />
              <span className="mm-acc__badge">{l.badge ?? STATE_META[l.state].label}</span>
            </summary>
            <div className="mm-acc__body">
              <button type="button" className="mm-row" onClick={() => onSelect(b.id)}>
                <span className="mm-row__title">Панель блока {blockTag(b.id)}</span>
              </button>
              <ul className="mm-list">
                {subblocksOf(b.id).map((s) => {
                  const sl = liveOf(live, s.id)
                  return (
                    <li key={s.id}>
                      <button type="button" className={`mm-row${selectedId === s.id ? ' is-selected' : ''}`} onClick={() => onSelect(s.id)}>
                        <StateGlyph state={sl.state} />
                        <span className="mm-row__title">{s.title}</span>
                        {sl.badge && <span className="mm-row__badge">{sl.badge}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {out.length > 0 && (
                <p className="mm-acc__edges">
                  {out.map((e) => `${e.kind === 'feedback' ? '⇠' : '→'} в ${blockTag(e.to as typeof b.id)} (${e.label})`).join(' · ')}
                </p>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
