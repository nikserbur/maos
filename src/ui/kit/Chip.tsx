/**
 * Чип статуса: цвет --status-* + глиф (● ▲ ○ ■ ◆), никогда цвет отдельно.
 * Один словарь тонов для всех экранов; синонимы good/warn/bad из «Плана» приводятся к
 * running/setup/down. accent — выделение без статуса (без глифа), без тона — нейтральный.
 */
import type { ReactNode } from 'react'
import './kit.css'

export type Tone = 'running' | 'setup' | 'idle' | 'down' | 'info'
export type ChipTone = Tone | 'good' | 'warn' | 'bad' | 'accent'

const SYNONYM: Record<ChipTone, Tone | 'accent'> = {
  running: 'running', setup: 'setup', idle: 'idle', down: 'down', info: 'info',
  good: 'running', warn: 'setup', bad: 'down', accent: 'accent',
}

/** Канонический тон (good → running и т. д.) — для класса и глифа. */
export function chipTone(tone: ChipTone): Tone | 'accent' {
  return SYNONYM[tone]
}

interface ChipProps {
  tone?: ChipTone
  children: ReactNode
  title?: string
  size?: 'md' | 'sm'
  className?: string
}

export function Chip({ tone, children, title, size = 'md', className }: ChipProps) {
  const t = tone ? chipTone(tone) : undefined
  const cls = ['dk-chip', t ? `dk-chip--${t}` : '', size === 'sm' ? 'dk-chip--sm' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <span className={cls} title={title}>
      {t && t !== 'accent' && <span className={`glyph-${t}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Чип со статусом (тон обязателен) — прежнее имя из кита «Портфеля». */
export function StatusChip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <Chip tone={tone} title={title}>{children}</Chip>
}

interface ChoiceChipProps {
  /** Состояние переключателя → `aria-pressed`. */
  pressed: boolean
  onToggle: () => void
  children: ReactNode
  title?: string
  disabled?: boolean
  className?: string
}

/** Чип-переключатель (выбор из набора): кнопка высотой ≥ 24 px, фокус — `--halo`. Не путать с `Chip` (только показ). */
export function ChoiceChip({ pressed, onToggle, children, title, disabled, className }: ChoiceChipProps) {
  const cls = ['dk-choice', pressed ? 'is-on' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} aria-pressed={pressed} title={title} disabled={disabled} onClick={onToggle}>
      {children}
    </button>
  )
}
