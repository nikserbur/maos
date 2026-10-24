/**
 * Добавление объектов со схемы (режим «Редактирование»): на площадке — цех (подразделение),
 * внутри цеха — станок выбранного типа (сразу в Справочники, с «Отменить»). Кнопки не
 * выключаются заранее (X2 P-41): без данных нажатие объясняет, что ввести; выключены только на
 * время запроса («Добавляем…»). Пояснения — в «i» у подписи раздела.
 */
import { useState } from 'react'
import { IconButton } from '../../ui/kit'
import { NoteTip } from '../../ui/NoteTip'
import { SHOP_MODELS } from './Building'
import type { WorkCenterType } from '../../lib/api'

interface AddShopProps {
  busy: boolean
  onCreateShop: (name: string, kind: string) => Promise<boolean>
}

export function AddShop({ busy, onCreateShop }: AddShopProps) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')   // '' = авто по названию
  const [hint, setHint] = useState<string | null>(null)
  const submit = async () => {
    if (!name.trim()) { setHint('Введите название цеха'); return }
    setHint(null)
    if (await onCreateShop(name.trim(), kind)) setName('')
  }
  return (
    <div className="editor-panel__section ep-stack">
      <div className="editor-panel__label ep-label-row text-caps">
        Новый цех
        <NoteTip title="Новый цех">
          Цех создаётся в справочнике «Подразделения» этого предприятия. Затем войдите в него (2×ЛКМ)
          и добавляйте станки — оборудование размещается только внутри цеха.
        </NoteTip>
      </div>
      <input className="ep-register__input" value={name} aria-label="Название цеха" aria-invalid={hint ? true : undefined}
             aria-describedby={hint ? 'ep-add-shop-hint' : undefined}
             onChange={(e) => { setName(e.target.value); if (hint) setHint(null) }}
             onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
             placeholder="Например, «Сборочный цех»" />
      {hint && <p id="ep-add-shop-hint" className="ep-field-error glyph-setup" role="alert">{hint}</p>}
      <select className="ep-register__select" value={kind} aria-label="Модель здания"
              onChange={(e) => setKind(e.target.value)}>
        <option value="">Модель здания — по названию</option>
        {SHOP_MODELS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
      </select>
      <IconButton icon="plus" variant="primary" onClick={() => { void submit() }} disabled={busy}>
        {busy ? 'Добавляем…' : 'Добавить цех'}
      </IconButton>
    </div>
  )
}

interface AddMachineProps {
  shopName: string
  wcTypes: WorkCenterType[]
  busy: boolean
  /** Станок создаётся сразу в Справочниках (авто-имя «Тип №N», контекст цеха). */
  onAddMachine: (wcTypeId: string) => Promise<boolean>
}

export function AddMachine({ shopName, wcTypes, busy, onAddMachine }: AddMachineProps) {
  const [wcType, setWcType] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const submit = () => {
    if (!wcType) { setHint('Выберите тип оборудования'); return }
    setHint(null)
    void onAddMachine(wcType)
  }
  return (
    <div className="editor-panel__section ep-stack">
      <div className="editor-panel__label ep-label-row text-caps">
        Новый станок · {shopName}
        <NoteTip title="Новый станок">
          Станок сразу создаётся в справочнике «Оборудование» (имя «Тип №N», статус «В работе») и встаёт
          в линию цеха. 3D-модель — по типу оборудования; в сцене его можно передвинуть и соединить дорожкой.
        </NoteTip>
      </div>
      {wcTypes.length === 0 ? (
        <p className="editor-panel__tip editor-panel__tip--warn">
          <span className="glyph-setup" aria-hidden="true" />
          <span>Типов оборудования нет — создайте тип в <a className="ep-link" href="#/nsi/workcentertype">Справочниках › Типы оборудования</a>.</span>
        </p>
      ) : (
        <>
          <select className="ep-register__select" value={wcType} aria-label="Тип оборудования" aria-invalid={hint ? true : undefined}
                  aria-describedby={hint ? 'ep-add-machine-hint' : undefined}
                  onChange={(e) => { setWcType(e.target.value); if (hint) setHint(null) }}>
            <option value="">— тип оборудования —</option>
            {wcTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {hint && <p id="ep-add-machine-hint" className="ep-field-error glyph-setup" role="alert">{hint}</p>}
          <IconButton icon="plus" variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Добавляем…' : 'Добавить станок'}
          </IconButton>
        </>
      )}
    </div>
  )
}
