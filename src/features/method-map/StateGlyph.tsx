/**
 * Глиф состояния узла — единый словарь src/ui/stateVocabulary.ts (X2 P-124): ● по данным · ◆ норматив ·
 * ■ вручную · ○ по умолчанию · ▲ устарело/синтетика · ✕ ошибка · ◌ не задано; «в плане» — без глифа
 * (пунктирная карточка и чип «в плане · волна N»). Рисуется CSS (styles/glyphs.css), цвет — только на
 * глифе; слово — для чипов и aria.
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
