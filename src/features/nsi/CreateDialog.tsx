import { Modal } from '../../shell/Modal'
import { RoutingSchemeEditor } from './RoutingSchemeEditor'
import { WorkCenterTypeForm } from './forms/WorkCenterTypeForm'
import { MachineForm }        from './forms/MachineForm'
import { ProductForm }        from './forms/ProductForm'
import { OperationForm }      from './forms/OperationForm'
import { WorkerForm }         from './forms/WorkerForm'

export type EditCtx = { id: string; row: Record<string, unknown> } | undefined

const TITLES: Record<string, [string, string]> = {
  workcentertype: ['Новый тип оборудования', 'Тип оборудования'],
  machine:        ['Новая единица оборудования', 'Оборудование'],
  product:        ['Новое изделие / материал', 'Изделие'],
  routing:        ['Новая техкарта', 'Техкарта'],
  operation:      ['Новая операция', 'Операция'],
  worker:         ['Новый рабочий', 'Рабочий'],
}

interface CreateDialogProps {
  registryId: string
  edit?: EditCtx
  onClose: () => void
}

export function CreateDialog({ registryId, edit, onClose }: CreateDialogProps) {
  const [createT, editT] = TITLES[registryId] ?? ['Создать запись', 'Запись']
  const title = edit ? `Редактирование — ${editT}` : createT

  if (registryId === 'routing') {
    return (
      <Modal title={title} size="full" onClose={onClose}>
        <RoutingSchemeEditor edit={edit} onSave={onClose} onCancel={onClose} />
      </Modal>
    )
  }

  const form = (() => {
    switch (registryId) {
      case 'workcentertype': return <WorkCenterTypeForm edit={edit} onSuccess={onClose} />
      case 'machine':        return <MachineForm        edit={edit} onSuccess={onClose} />
      case 'product':        return <ProductForm        edit={edit} onSuccess={onClose} />
      case 'operation':      return <OperationForm      edit={edit} onSuccess={onClose} />
      case 'worker':         return <WorkerForm         edit={edit} onSuccess={onClose} />
      default: return <p style={{ color: 'var(--text-muted)' }}>Форма не найдена.</p>
    }
  })()

  return (
    <Modal title={title} size="lg" onClose={onClose}>
      {form}
    </Modal>
  )
}
