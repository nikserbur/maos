import { useState } from 'react'
import { Modal } from '../../shell/Modal'
import { api } from '../../lib/api'
import type { RegistryDef } from './registries'

type AnyRow = Record<string, unknown>

// Реестры с поддержкой обновления (generic CRUD PUT на бэкенде).
const UPDATERS: Record<string, (id: string, d: Record<string, string>) => Promise<unknown>> = {
  workcentertype: (id, d) => api.workCenterTypes.update(id, d),
  machine:        (id, d) => api.machines.update(id, d),
  product:        (id, d) => api.products.update(id, d),
  operation:      (id, d) => api.operations.update(id, d),
  worker:         (id, d) => api.workers.update(id, d),
}

interface EditDialogProps {
  registry: RegistryDef
  row: AnyRow
  onClose: () => void
  onSaved: () => void
}

/** Редактирование записи реестра: поля колонок → PUT /api/<table>/:id. */
export function EditDialog({ registry, row, onClose, onSaved }: EditDialogProps) {
  const id = String(row.id ?? '')
  const updater = UPDATERS[registry.id]
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(registry.columns.map((c) => [c.key, row[c.key] == null ? '' : String(row[c.key])])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }))

  const save = async () => {
    if (!updater) { setError('Этот реестр пока не поддерживает редактирование.'); return }
    setSaving(true); setError(null)
    try {
      // Отправляем только редактируемые колонки (без вычисляемых id/created_at).
      const patch: Record<string, string> = {}
      for (const c of registry.columns) if (c.key !== 'id' && c.key !== 'created_at') patch[c.key] = values[c.key] ?? ''
      await updater(id, patch)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  return (
    <Modal title={`Редактирование — ${registry.title}`} size="lg" onClose={onClose}>
      <div className="form">
        {error && <div className="form__error">{error}</div>}
        {!updater && (
          <p className="form__hint">Реестр «{registry.title}» доступен только для просмотра и создания.</p>
        )}
        {registry.columns.filter((c) => c.key !== 'id' && c.key !== 'created_at').map((c) => (
          <div className="form__field" key={c.key}>
            <label className="form__label">{c.title}</label>
            <input className="form__input" value={values[c.key] ?? ''}
                   disabled={!updater}
                   onChange={(e) => set(c.key, e.target.value)} />
          </div>
        ))}
        <div className="form__actions">
          <button className="btn btn--primary" onClick={save} disabled={saving || !updater}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
