/**
 * Срок как дата + часы в подписи (UX-V2 §6.2 `DateHoursInput`, решение владельца §8 п. 2):
 * пользователь выбирает дату, в контракт уходит `due_hours` от начала горизонта.
 * Подпись: «720 ч · через 1 месяц»; старт — из сценария или запасной (подписан).
 */
import { dueDateFromHours, dueRelativeText, hoursFromDueDate, parseIsoDate, toIsoDate } from '../features/plan/wizard/dates'
import './fields.css'

interface DateHoursInputProps {
  /** Начало горизонта (полночь UTC). */
  start: Date
  dueHours: number
  onChange: (dueHours: number) => void
  disabled?: boolean
  label?: string
  compact?: boolean
}

export function DateHoursInput({ start, dueHours, onChange, disabled, label = 'Срок', compact = false }: DateHoursInputProps) {
  const date = toIsoDate(dueDateFromHours(start, dueHours))
  return (
    <span className={`pf-datehours${compact ? ' pf-datehours--compact' : ''}`}>
      <input
        className="pf-datehours__date"
        type="date"
        aria-label={label}
        value={date}
        min={toIsoDate(start)}
        disabled={disabled}
        onChange={(e) => { const d = parseIsoDate(e.target.value); if (d) onChange(hoursFromDueDate(start, d)) }}
      />
      <span className="pf-datehours__hours mono" title="Техническое поле контракта: календарные часы от начала горизонта">
        {Math.round(dueHours)} ч · {dueRelativeText(dueHours)}
      </span>
    </span>
  )
}
