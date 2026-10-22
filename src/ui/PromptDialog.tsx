/**
 * Ввод названия (и необязательного описания) в модальном окне — вместо `window.prompt`
 * (UX-V2 U9): создание сценария, производственного плана, пресета эвристики.
 * Enter — подтвердить, Esc — отмена; пустое имя не принимается.
 */
import { useId, useState, type FormEvent } from 'react'
import { Modal } from '../shell/Modal'
import './dialogs.css'

interface PromptDialogProps {
  title: string
  label: string
  defaultValue?: string
  placeholder?: string
  /** Показать второе поле «Описание». */
  withDescription?: boolean
  submitLabel?: string
  hint?: string
  busy?: boolean
  onSubmit: (name: string, description: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title, label, defaultValue = '', placeholder, withDescription = false, submitLabel = 'Создать', hint, busy = false, onSubmit, onCancel,
}: PromptDialogProps) {
  const [name, setName] = useState(defaultValue)
  const [description, setDescription] = useState('')
  const formId = useId()
  const valid = name.trim().length > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    onSubmit(name.trim(), description.trim())
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={!valid || busy}>
            {busy ? 'Сохраняем…' : submitLabel}
          </button>
        </>
      }
    >
      <form id={formId} className="dlg__form" onSubmit={submit}>
        <label className="form__label dlg__field">
          <span>{label}</span>
          <input
            className="form__input"
            value={name}
            placeholder={placeholder}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </label>
        {withDescription && (
          <label className="form__label dlg__field">
            <span>Описание</span>
            <textarea className="form__textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
        )}
        {hint && <p className="dlg__hint">{hint}</p>}
      </form>
    </Modal>
  )
}
