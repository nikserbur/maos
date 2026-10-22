/**
 * Подтверждение необратимого действия (удаление, перезапись) поверх `Modal`:
 * заголовок, текст, «Отмена» и кнопка действия (опасный тон — для удаления).
 * Заменяет `window.confirm` и удаление без подтверждения (UX-V2 U9).
 */
import type { ReactNode } from 'react'
import { Modal } from '../shell/Modal'
import './dialogs.css'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, children, confirmLabel = 'Подтвердить', danger = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Выполняем…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="dlg__text">{children}</div>
    </Modal>
  )
}
