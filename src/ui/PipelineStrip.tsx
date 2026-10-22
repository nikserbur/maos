/**
 * Полоса методологии (UX-V2 §2.4): 8 ячеек-блоков с состоянием для текущего контекста
 * (активный сценарий + последний прогон), 36 px, липнет под верхней панелью. Клик —
 * переход на узел карты; блоки текущего экрана подсвечены. На узких экранах — только
 * номера и глифы. Состояние — из `useMethodMapState()` (deriveState, без бэкенда).
 */
import type { CSSProperties } from 'react'
import { BLOCKS } from '../features/method-map/blocks'
import { liveOf } from '../features/method-map/deriveState'
import { STATE_META } from '../features/method-map/stateMeta'
import { StateGlyph } from '../features/method-map/StateGlyph'
import type { BlockId } from '../features/method-map/types'
import { useMethodMapState } from '../features/method-map/useMethodMapState'
import './pipeline.css'

interface PipelineStripProps {
  /** Блоки, которые реализует текущий экран (подсвечиваются). */
  activeBlocks?: readonly BlockId[]
}

export function PipelineStrip({ activeBlocks = [] }: PipelineStripProps) {
  const { state, scenario } = useMethodMapState()
  return (
    <nav className="pstrip" aria-label="Полоса методологии: состояние восьми блоков">
      <ol className="pstrip__cells">
        {BLOCKS.map((b) => {
          const l = liveOf(state, b.id)
          const current = activeBlocks.includes(b.id)
          const text = l.badge ?? STATE_META[l.state].label
          return (
            <li key={b.id} className={`pstrip__cell is-${l.state}${current ? ' is-current' : ''}`} style={{ '--block': b.colorVar } as CSSProperties}>
              <a
                href={`#/map/${b.id}`}
                className="pstrip__link"
                aria-current={current ? 'location' : undefined}
                title={`[${b.n}] ${b.title} — ${STATE_META[l.state].label}${l.badge ? `: ${l.badge}` : ''}${l.reason ? ` · ${l.reason}` : ''}`}
              >
                <span className="pstrip__n mono">{b.n}</span>
                <span className="pstrip__name">{b.short}</span>
                <StateGlyph state={l.state} />
                <span className="pstrip__badge">{text}</span>
              </a>
            </li>
          )
        })}
      </ol>
      <a className="pstrip__map" href="#/map" title={scenario ? `Контекст: сценарий «${scenario.name}»` : 'Карта методологии'}>
        Карта ↗
      </a>
    </nav>
  )
}
