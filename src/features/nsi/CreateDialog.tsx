/**
 * Правка и создание записи НСИ в неблокирующей боковой панели кита (P-50) вместо модала: таблица
 * остаётся видна, строка подсвечена; подвал липкий — «Отмена» и «Сохранить изменения» / «Создать …»,
 * опасное действие («Уволить…») слева за разделителем, с подтверждением, называющим объект и последствие.
 * Несохранённое охраняют SidePanel (Esc, «Отмена») и useLeaveGuard (переход, F5). Своя граница ошибок.
 */
import { useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { SidePanel, errorText } from '../../ui/kit'
import { WorkCenterTypeForm } from './forms/WorkCenterTypeForm'
import { MachineForm }        from './forms/MachineForm'
import { ProductForm }        from './forms/ProductForm'
import { OperationForm }      from './forms/OperationForm'
import { WorkerForm }         from './forms/WorkerForm'
import type { EditCtx, FormBridge } from './forms/formBridge'

export type { EditCtx } from './forms/formBridge'

/** [заголовок новой записи, вид записи, подпись кнопки создания]. */
const TITLES: Record<string, [string, string, string]> = {
  workcentertype: ['Новый тип оборудования', 'Тип оборудования', 'Создать тип'],
  machine:        ['Новая единица оборудования', 'Оборудование', 'Создать станок'],
  product:        ['Новое изделие', 'Изделие', 'Создать изделие'],
  operation:      ['Новая операция', 'Операция', 'Создать операцию'],
  worker:         ['Новый сотрудник', 'Сотрудник', 'Добавить сотрудника'],
}

export const createLabelFor = (registryId: string): string => TITLES[registryId]?.[2] ?? 'Создать'

interface RecordPanelProps {
  registryId: string
  edit?: EditCtx
  /** Подпись создания (начальник цеха — «Нанять сотрудника»). */
  createLabel?: string
  onClose: () => void
  /** Запись сохранена (или уволена): обновить реестр и закрыть панель. */
  onSaved: (message?: string) => void
}

const recordName = (row: Record<string, unknown>): string => {
  const fio = [row.last_name, row.first_name].filter(Boolean).join(' ')
  return String(fio || row.name || row.code || '')
}

export function RecordPanel({ registryId, edit, createLabel, onClose, onSaved }: RecordPanelProps) {
  const submitRef = useRef<(() => void) | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [dismissError, setDismissError] = useState<unknown>(null)
  const bridge = useMemo<FormBridge>(() => ({ submitRef, onDirty: setDirty, onBusy: setBusy }), [])
  const [createT, editT, createL] = TITLES[registryId] ?? ['Новая запись', 'Запись', 'Создать']
  const name = edit ? recordName(edit.row) : ''
  const title = edit ? (name ? `${editT}: ${name}` : editT) : createT

  const props = { edit, onSuccess: onSaved, bridge }
  const form = (() => {
    switch (registryId) {
      case 'workcentertype': return <WorkCenterTypeForm {...props} />
      case 'machine':        return <MachineForm {...props} />
      case 'product':        return <ProductForm {...props} />
      case 'operation':      return <OperationForm {...props} />
      case 'worker':         return <WorkerForm {...props} />
      default: return <p className="nsi__form-missing">Для этого реестра нет формы.</p>
    }
  })()

  const dismiss = async () => {
    if (!edit) return
    setBusy(true)
    setDismissError(null)
    try {
      await api.workers.delete(edit.id)
      setDismissing(false)
      onSaved(`Сотрудник ${name} уволен`)
    } catch (e) {
      setDismissError(e)
    } finally {
      setBusy(false)
    }
  }

  const danger = registryId === 'worker' && edit
    ? <button type="button" className="btn btn--danger btn--sm" onClick={() => setDismissing(true)} disabled={busy}>Уволить…</button>
    : undefined

  return (
    <ErrorBoundary variant="panel" label={`${registryId}:${edit?.id ?? 'new'}`} onClose={onClose}
      message="Панель записи не открылась — закройте её и откройте запись снова">
      <SidePanel
        className="nsi-side"
        title={title}
        onClose={onClose}
        onSave={() => submitRef.current?.()}
        saveLabel={edit ? 'Сохранить изменения' : createLabel ?? createL}
        dirty={dirty}
        saving={busy}
        danger={danger}
      >
        {form}
      </SidePanel>
      {dismissing && edit && (
        <ConfirmDialog
          title="Уволить сотрудника?"
          objectName={`${name}, таб. № ${String(edit.row.tab_no ?? '')}`}
          consequence="Запись уйдёт из реестра «Рабочие», и новые планы его не назначат; построенные планы сохранятся. Действие попадёт в журнал."
          confirmLabel="Уволить"
          danger
          busy={busy}
          onCancel={() => { setDismissing(false); setDismissError(null) }}
          onConfirm={() => void dismiss()}
        >
          {dismissError ? <p className="form__error" role="alert">{errorText(dismissError, 'Не удалось уволить — повторите')}</p> : null}
        </ConfirmDialog>
      )}
    </ErrorBoundary>
  )
}
