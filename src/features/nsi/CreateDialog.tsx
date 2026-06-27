import { Modal } from '../../shell/Modal'
import { RoutingSchemeEditor } from './RoutingSchemeEditor'
import { WorkCenterTypeForm } from './forms/WorkCenterTypeForm'
import { MachineForm }        from './forms/MachineForm'
import { ProductForm }        from './forms/ProductForm'
import { OperationForm }      from './forms/OperationForm'
import { WorkerForm }         from './forms/WorkerForm'

const TITLES: Record<string, string> = {
  workcentertype: 'Новый тип оборудования',
  machine:        'Новая единица оборудования',
  product:        'Новое изделие / материал',
  routing:        'Новая техкарта',
  operation:      'Новая операция',
  worker:         'Новый рабочий',
}

interface CreateDialogProps {
  registryId: string
  onClose: () => void
}

export function CreateDialog({ registryId, onClose }: CreateDialogProps) {
  const title = TITLES[registryId] ?? 'Создать запись'

  if (registryId === 'routing') {
    return (
      <Modal title={title} size="full" onClose={onClose}>
        <RoutingSchemeEditor onSave={onClose} onCancel={onClose} />
      </Modal>
    )
  }

  const form = (() => {
    switch (registryId) {
      case 'workcentertype': return <WorkCenterTypeForm onSuccess={onClose} />
      case 'machine':        return <MachineForm        onSuccess={onClose} />
      case 'product':        return <ProductForm        onSuccess={onClose} />
      case 'operation':      return <OperationForm      onSuccess={onClose} />
      case 'worker':         return <WorkerForm         onSuccess={onClose} />
      default: return <p style={{ color: 'var(--text-muted)' }}>Форма не найдена.</p>
    }
  })()

  return (
    <Modal title={title} size="lg" onClose={onClose}>
      {form}
    </Modal>
  )
}
