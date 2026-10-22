/**
 * Добавление объектов со схемы (режим редактирования): на площадке — цех (org_unit),
 * внутри цеха — станок выбранного типа (сразу в НСИ). Двухуровневая иерархия:
 * станок всегда в цехе, цех не внутри цеха.
 */
import { useState } from 'react'
import { IconButton } from '../../ui/kit'
import { SHOP_MODELS } from './Building'
import type { WorkCenterType } from '../../lib/api'

interface AddShopProps {
  onCreateShop: (name: string, kind?: string) => void
}

export function AddShop({ onCreateShop }: AddShopProps) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')   // '' = авто по названию
  const submit = () => {
    if (!name.trim()) return
    onCreateShop(name.trim(), kind)
    setName('')
  }
  return (
    <div className="editor-panel__section ep-stack">
      <div className="editor-panel__label text-caps">Площадка · новый цех</div>
      <input className="ep-register__input" value={name} aria-label="Название цеха"
             onChange={(e) => setName(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
             placeholder="Название цеха (напр. «Сборочный цех»)" />
      <select className="ep-register__select" value={kind} aria-label="Модель здания"
              onChange={(e) => setKind(e.target.value)} title="3D-модель здания цеха на площадке">
        <option value="">Модель здания — авто по названию</option>
        {SHOP_MODELS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
      </select>
      <IconButton icon="plus" variant="primary" onClick={submit} disabled={!name.trim()}>Добавить цех</IconButton>
      <p className="editor-panel__tip">
        Создайте цех, затем войдите в него (2×ЛКМ) и добавляйте станки — оборудование
        размещается только <b>внутри цеха</b>.
      </p>
    </div>
  )
}

interface AddMachineProps {
  shopName: string
  wcTypes: WorkCenterType[]
  /** Станок создаётся СРАЗУ в НСИ (авто-имя «Тип №N», контекст цеха). */
  onAddMachine: (wcTypeId: string) => void
}

export function AddMachine({ shopName, wcTypes, onAddMachine }: AddMachineProps) {
  const [wcType, setWcType] = useState('')
  return (
    <div className="editor-panel__section ep-stack">
      <div className="editor-panel__label text-caps">Цех · {shopName}</div>
      {wcTypes.length === 0 ? (
        <p className="editor-panel__tip editor-panel__tip--warn">
          <span className="glyph-setup" aria-hidden="true" />
          Типов оборудования нет — сначала создайте тип в <b>Справочники → Типы оборудования</b>,
          затем добавляйте станки.
        </p>
      ) : (
        <>
          <select className="ep-register__select" value={wcType} aria-label="Тип оборудования"
                  onChange={(e) => setWcType(e.target.value)}>
            <option value="">— тип оборудования —</option>
            {wcTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <IconButton icon="plus" variant="primary" onClick={() => onAddMachine(wcType)} disabled={!wcType}>
            Добавить станок
          </IconButton>
          <p className="editor-panel__tip">
            Станок <b>сразу создаётся в НСИ</b> (имя «Тип №N», статус «В работе») и встаёт
            в линию цеха. 3D-модель — по типу оборудования; gizmo перемещает, кнопка связи
            на ярлыке соединяет дорожкой.
          </p>
        </>
      )}
    </div>
  )
}
