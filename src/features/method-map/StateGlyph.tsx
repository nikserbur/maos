/**
 * Глиф состояния узла (UX-V2 §3.4): ● оценено/калибровано · ■ вручную/норматив/ошибка ·
 * ▲ устарело · ○ по умолчанию · ◌ не задано/в плане. Рисуется CSS (map.css), цвет —
 * токены состояния; подпись — для чипов и aria.
 */
import type { ReactNode } from 'react'
import { STATE_META } from './stateMeta'
import type { NodeState } from './types'

export function StateGlyph({ state, className }: { state: NodeState; className?: string }) {
  return <span className={`mm-glyph ${STATE_META[state].glyphClass}${className ? ` ${className}` : ''}`} aria-hidden="true" />
}

export function StateChip({ state, children }: { state: NodeState; children?: ReactNode }) {
  const meta = STATE_META[state]
  return (
    <span className={`mm-chip mm-chip--${state}`} title={meta.hint}>
      <StateGlyph state={state} />
      <span className="mm-chip__label">{children ?? meta.label}</span>
    </span>
  )
}

/** Текст для aria-describedby узла: «оценено · CVaR −1,2 млн ₽». */
export function stateDescription(state: NodeState, badge?: string, reason?: string): string {
  return [STATE_META[state].label, badge, reason].filter(Boolean).join(' · ')
}
