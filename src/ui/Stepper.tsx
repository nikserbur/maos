/**
 * Вертикальный степпер мастера (UX-V2 §4.1): номер, название, глиф состояния шага (те же,
 * что на карте: ● готово · ▲ внимание · ○ по умолчанию · ◌ не задано). Все шаги доступны
 * после первого; текущий отмечен маркером акцента (выбор), цвет блока — только на чипе [n]; незавершённые приглушены.
 */
import type { CSSProperties } from 'react'
import './fields.css'

export type StepState = 'done' | 'warn' | 'default' | 'empty' | 'running'

export interface StepDef<T extends string = string> {
  id: T
  n: number
  title: string
  /** «[1]» — номер блока карты, которому соответствует шаг. */
  block?: string
  blockColor?: string
  state: StepState
  hint?: string
  disabled?: boolean
}

interface StepperProps<T extends string> {
  steps: ReadonlyArray<StepDef<T>>
  current: T
  onSelect: (id: T) => void
  label?: string
}

const GLYPH: Record<StepState, string> = { done: '●', warn: '▲', default: '○', empty: '◌', running: '◐' }
const STATE_LABEL: Record<StepState, string> = { done: 'готово', warn: 'внимание', default: 'по умолчанию', empty: 'не задано', running: 'считается' }

export function Stepper<T extends string>({ steps, current, onSelect, label = 'Шаги' }: StepperProps<T>) {
  return (
    <nav className="pf-stepper" aria-label={label}>
      <p className="pf-stepper__title text-caps">{label}</p>
      <ol className="pf-stepper__list">
        {steps.map((s) => {
          const on = s.id === current
          return (
            <li key={s.id} className={`pf-step pf-step--${s.state}${on ? ' is-current' : ''}${s.disabled ? ' is-disabled' : ''}`}
                style={s.blockColor ? ({ '--step-color': s.blockColor } as CSSProperties) : undefined}>
              <button type="button" className="pf-step__btn" disabled={s.disabled} aria-current={on ? 'step' : undefined}
                      title={s.hint ?? STATE_LABEL[s.state]} onClick={() => onSelect(s.id)}>
                <span className="pf-step__n mono">{s.n}</span>
                <span className="pf-step__title">{s.title}</span>
                {s.block && <span className="pf-step__block mono">{s.block}</span>}
                <span className={`pf-step__glyph pf-step__glyph--${s.state}`} aria-label={STATE_LABEL[s.state]}>{GLYPH[s.state]}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
