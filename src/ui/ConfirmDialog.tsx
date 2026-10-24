/**
 * Подтверждение необратимого действия (удаление, перезапись) поверх `Modal` (X2 «безопасная правка»):
 * заголовок называет объект («Удалить техкарту «ТК-12 Вал»?»), текст — последствие («Операции
 * маршрута будут удалены; прогоны плана останутся»), действия — в подвале модалки: «Отмена» и
 * кнопка действия (опасный тон — для удаления). Заменяет `window.confirm` (UX-V2 U9).
 */
import type { ReactNode } from 'react'
import { Modal } from '../shell/Modal'
import './dialogs.css'

interface ConfirmDialogProps {
  title: string
  /** Имя объекта действия — показывается в тексте («ТК-12 Вал»). Новые вызовы передают всегда. */
  objectName?: string
  /** Последствие простыми словами: что исчезнет и что останется. Новые вызовы передают всегда. */
  consequence?: ReactNode
  children?: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, objectName, consequence, children, confirmLabel = 'Подтвердить', danger = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined} autoFocus>
            {busy ? 'Выполняем…' : confirmLabel}
          </button>
        </>
      }
    >
      {objectName && <p className="dlg__object">«{objectName}»</p>}
      {consequence && <p className="dlg__text dlg__consequence">{consequence}</p>}
      {children && <div className="dlg__text">{children}</div>}
    </Modal>
  )
}
