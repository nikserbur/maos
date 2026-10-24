/**
 * «Сбросить пароль…» (X2 P-143): новый пароль задаёт администратор и сообщает пользователю лично.
 * Кнопка не выключается заранее — проверка при нажатии, сообщение под полем (aria-invalid/describedby).
 */
import { useId, useRef, useState, type FormEvent } from 'react'
import { Modal } from '../../shell/Modal'
import { num } from '../../explain/format'
import { ErrorBanner } from '../../ui/kit'
import '../../ui/dialogs.css'

export const MIN_PASSWORD = 8

export const passwordProblem = (pw: string): string | null =>
  pw.length >= MIN_PASSWORD ? null : `Пароль — не короче ${num(MIN_PASSWORD, 0)} символов`

interface PasswordDialogProps {
  login: string
  busy: boolean
  error: unknown
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordDialog({ login, busy, error, onSubmit, onCancel }: PasswordDialogProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pw, setPw] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const p = passwordProblem(pw)
    setProblem(p)
    if (p) { inputRef.current?.focus(); return }
    onSubmit(pw)
  }

  return (
    <Modal
      title={`Сбросить пароль ${login}?`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="submit" form={`${id}-form`} className="btn btn--danger" aria-busy={busy || undefined}>
            {busy ? 'Сохраняем…' : 'Сбросить пароль'}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="dlg__form" onSubmit={submit} noValidate>
        <p className="dlg__text">Старый пароль перестанет действовать. Сообщите новый пользователю лично — в журнал он не попадёт.</p>
        {error !== null && error !== undefined && <ErrorBanner error={error} />}
        <label className="form__field" htmlFor={`${id}-pw`}>
          <span className="form__label">Новый пароль</span>
          <input ref={inputRef} id={`${id}-pw`} className="form__input" type="password" autoComplete="new-password" autoFocus value={pw}
                 aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-err` : `${id}-hint`}
                 onChange={(e) => { setPw(e.target.value); if (problem) setProblem(passwordProblem(e.target.value)) }}
                 onBlur={() => { if (pw) setProblem(passwordProblem(pw)) }} />
          {problem
            ? <span className="adm__field-err glyph-down" id={`${id}-err`}>{problem}</span>
            : <span className="form__hint" id={`${id}-hint`}>Не короче {num(MIN_PASSWORD, 0)} символов; на сервере хранится только хэш.</span>}
        </label>
      </form>
    </Modal>
  )
}
