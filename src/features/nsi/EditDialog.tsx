import { useState, useEffect } from 'react'
import { Modal } from '../../shell/Modal'
import { api, type WorkCenterType, type Product, type OrgUnit } from '../../lib/api'
import { PALETTE, KIND_META } from '../plant-scene/graph/sceneModel'
import type { RegistryDef } from './registries'

type AnyRow = Record<string, unknown>

// Диспетчер обновления реестра. Параметр намеренно широкий (generic-диалог
// строит патч из колонок реестра, типы конкретных api-методов разные).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Updater = (id: string, d: any) => Promise<unknown>
const UPDATERS: Record<string, Updater> = {
  workcentertype: (id, d) => api.workCenterTypes.update(id, d),
  machine:        (id, d) => api.machines.update(id, d),
  product:        (id, d) => api.products.update(id, d),
  operation:      (id, d) => api.operations.update(id, d),
  worker:         (id, d) => api.workers.update(id, d),
}

const OP_TYPES = [
  ['machining', 'Механообработка'], ['welding', 'Сварка'], ['assembly', 'Сборка'],
  ['coating', 'Покрытие'], ['heat', 'Термообработка'], ['control', 'Контроль качества'],
  ['transport', 'Транспортировка'], ['finishing', 'Финишная'],
] as const
const STATUSES = [['active', 'В работе'], ['maintenance', 'ТО'], ['decommissioned', 'Выведено']] as const
const BOOL_COLS = new Set(['purchased', 'sellable', 'interchangeable', 'setup_required'])

interface EditDialogProps {
  registry: RegistryDef
  row: AnyRow
  wcTypes: WorkCenterType[]
  products: Product[]
  onClose: () => void
  onSaved: () => void
}

/** Редактирование записи реестра: выбор из реестра — выпадающими списками. */
export function EditDialog({ registry, row, wcTypes, products, onClose, onSaved }: EditDialogProps) {
  const id = String(row.id ?? '')
  const updater = UPDATERS[registry.id]
  const editable = registry.columns.filter((c) => c.key !== 'id' && c.key !== 'created_at')

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((c) => [c.key, row[c.key] == null ? '' : String(row[c.key])])),
  )
  // Множественная привязка типов оборудования к операции (по ID).
  const [wcIds, setWcIds] = useState<string[]>(() => {
    const names = String(row.wc_types ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    return wcTypes.filter((t) => names.includes(t.name)).map((t) => t.id)
  })
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([])
  useEffect(() => { api.orgUnits.list().then(setOrgUnits).catch(() => {}) }, [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }))
  const toggleWc = (tid: string) =>
    setWcIds((p) => (p.includes(tid) ? p.filter((x) => x !== tid) : [...p, tid]))

  const save = async () => {
    if (!updater) { setError('Этот реестр пока не поддерживает редактирование.'); return }
    setSaving(true); setError(null)
    try {
      const patch: Record<string, unknown> = {}
      for (const c of editable) if (c.key !== 'wc_types') patch[c.key] = values[c.key] ?? ''
      if (registry.id === 'operation') {                 // множественная привязка по ID
        patch.wc_type_ids = wcIds
        patch.wc_types = wcIds.map((tid) => wcTypes.find((t) => t.id === tid)?.name).filter(Boolean).join(',')
      }
      await updater(id, patch)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  const field = (key: string, title: string) => {
    const v = values[key] ?? ''
    // Множественный выбор типов оборудования для операции.
    if (key === 'wc_types' && registry.id === 'operation') {
      return (
        <div className="form__field" key={key}>
          <label className="form__label">Допустимые типы оборудования (множественно)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
            {wcTypes.map((t) => (
              <label key={t.id} className="form__check" style={{ margin: 0 }}>
                <input type="checkbox" checked={wcIds.includes(t.id)} onChange={() => toggleWc(t.id)} />
                {t.name}
              </label>
            ))}
            {wcTypes.length === 0 && <span className="form__hint">Нет типов оборудования.</span>}
          </div>
        </div>
      )
    }
    let control
    if (key === 'wc_type_id')
      control = (
        <select className="form__select" value={v} onChange={(e) => set(key, e.target.value)}>
          <option value="">— тип оборудования —</option>
          {wcTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )
    else if (key === 'parent_id')
      control = (
        <select className="form__select" value={v} onChange={(e) => set(key, e.target.value)}>
          <option value="">— верхний уровень —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
      )
    else if (key === 'org_unit')
      control = (
        <select className="form__select" value={v} onChange={(e) => set(key, e.target.value)}>
          <option value="">— подразделение —</option>
          {orgUnits.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
        </select>
      )
    else if (key === 'op_type')
      control = (
        <select className="form__select" value={v} onChange={(e) => set(key, e.target.value)}>
          <option value="">— тип операции —</option>
          {OP_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )
    else if (key === 'status')
      control = (
        <select className="form__select" value={v} onChange={(e) => set(key, e.target.value)}>
          {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )
    else if (key === 'kind')
      control = (
        <select className="form__select" value={v} onChange={(e) => set(key, e.target.value)}>
          {PALETTE.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
        </select>
      )
    else if (BOOL_COLS.has(key))
      control = (
        <select className="form__select" value={v === '1' || v === 'true' ? '1' : '0'} onChange={(e) => set(key, e.target.value)}>
          <option value="1">Да</option><option value="0">Нет</option>
        </select>
      )
    else
      control = <input className="form__input" value={v} onChange={(e) => set(key, e.target.value)} disabled={!updater} />

    return (
      <div className="form__field" key={key}>
        <label className="form__label">{title}</label>
        {control}
      </div>
    )
  }

  return (
    <Modal title={`Редактирование — ${registry.title}`} size="lg" onClose={onClose}>
      <div className="form">
        {error && <div className="form__error">{error}</div>}
        {!updater && <p className="form__hint">Реестр «{registry.title}» доступен только для просмотра и создания.</p>}
        {editable.map((c) => field(c.key, c.title))}
        <div className="form__actions">
          <button className="btn btn--primary" onClick={save} disabled={saving || !updater}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
