/**
 * Карточка выбранного объекта схемы (X2 P-27, P-28, P-30, P-32): название (в «Редактировании» —
 * поле, сохраняется по Enter/уходу фокуса), статус одним словарём, загрузка по плану со ссылками,
 * оборудование из Справочников, «Состав» цеха/завода таблицей. «Удалить» — только в меню ⋯ с
 * подтверждением, отдельно от «Войти внутрь».
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Chip, IconButton, Menu, type MenuItem, type Tone } from '../../ui/kit'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { countText } from '../../explain/format'
import type { Machine, Operation, WorkCenterType } from '../../lib/api'
import type { SceneNode } from './graph/sceneModel'
import { statusWord } from './graph/status'
import { SHOP_MODELS } from './Building'
import { MachineCard } from './MachineCard'
import { NodeLoad } from './NodeLoad'
import { SceneObjectsTable, type ObjectRow } from './SceneObjectsTable'
import { ORG_UNITS_HREF } from './nsiLinks'
import { hasRealGeo } from './worldmap2d/cities'
import type { SceneOpsState } from './useSceneOps'
import type { StageStatus } from './types'

const STATUS_TONE: Record<StageStatus, Tone> = { running: 'running', setup: 'setup', idle: 'idle', down: 'down' }
const EYEBROW: Record<SceneNode['refType'], string> = { factory: 'Предприятие', shop: 'Цех', machine: 'Станок' }
const MACHINE_FORMS = ['станок', 'станка', 'станков'] as const

interface NodeInspectorProps {
  node: SceneNode
  editing: boolean
  /** Дети узла (состав цеха/завода) для таблицы «Состав». */
  composition: ReadonlyArray<ObjectRow>
  canEnter: boolean
  machines: Machine[]
  wcTypes: WorkCenterType[]
  operations: Operation[]
  ops: SceneOpsState
  deleting: boolean
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => Promise<boolean>
  onEnter: (id: string) => void
  onOpenChild: (row: ObjectRow, enter: boolean) => void
  onClose: () => void
  onChangeShopKind: (orgUnitId: string, kind: string) => void
  onChangeMachineType: (machineId: string, wcTypeId: string) => void
}

export function NodeInspector({
  node, editing, composition, canEnter, machines, wcTypes, operations, ops, deleting,
  onRename, onDelete, onEnter, onOpenChild, onClose, onChangeShopKind, onChangeMachineType,
}: NodeInspectorProps) {
  const [draft, setDraft] = useState(node.title)
  const [confirm, setConfirm] = useState(false)
  /** Esc отменяет правку имени: следующий blur не сохраняет. */
  const cancelled = useRef(false)
  useEffect(() => { setDraft(node.title) }, [node.id, node.title])

  const isMachine = node.refType === 'machine'
  const nodeOps = ops.byNode.get(node.id)
  const machine = isMachine ? machines.find((m) => m.id === node.id) ?? null : null
  const renamable = isMachine || Boolean(node.orgUnitId)
  const deletable = editing && (isMachine || (node.refType === 'shop' && Boolean(node.orgUnitId)))

  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return }
    if (draft.trim() && draft.trim() !== node.title) onRename(node.id, draft)
    else setDraft(node.title)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; setDraft(node.title); e.currentTarget.blur() }
  }

  const menu: MenuItem[] = deletable
    ? [{ id: 'delete', label: 'Удалить…', icon: 'close', danger: true, onSelect: () => setConfirm(true) }]
    : []
  const consequence = isMachine
    ? 'Станок будет удалён из справочника «Оборудование». Построенные планы останутся; новый план его не учтёт.'
    : `Цех будет удалён из справочника «Подразделения»; ${countText(nodeOps?.machines ?? 0, MACHINE_FORMS)} ${(nodeOps?.machines ?? 0) === 1 ? 'перейдёт' : 'перейдут'} в «Без цеха».`

  return (
    <section className="editor-panel__section editor-panel__inspector" aria-label="Объект схемы">
      <header className="editor-panel__inspector-head">
        <div className="editor-panel__heading">
          <div className="editor-panel__eyebrow text-caps">{EYEBROW[node.refType]}</div>
          {editing && renamable ? (
            <input className="editor-panel__title-input" value={draft} aria-label="Название — сохраняется по Enter"
                   onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
          ) : (
            <h2 className="editor-panel__title">{node.title}</h2>
          )}
          {node.subtitle && <p className="editor-panel__subtitle">{node.subtitle}</p>}
        </div>
        {menu.length > 0 && <Menu items={menu} label="Ещё действия" size="sm" />}
        <IconButton icon="close" variant="ghost" size="sm" onClick={onClose} title="Закрыть (Esc)" />
      </header>

      {/* У станка статус — в карточке оборудования (один чип), у цеха/завода — сводка по станкам. */}
      {!isMachine && (
        <div className="editor-panel__status">
          <Chip tone={STATUS_TONE[node.status]}>{statusWord(node.refType, node.status)}</Chip>
          {nodeOps && <span className="editor-panel__count num">{countText(nodeOps.machines, MACHINE_FORMS)}</span>}
        </div>
      )}

      <NodeLoad node={node} ops={nodeOps} source={ops.source} unavailable={Boolean(ops.error)} />

      {node.refType === 'factory' && !hasRealGeo(node) && (
        <p className="editor-panel__tip">
          Расположение не задано — укажите в <a className="ep-link" href={ORG_UNITS_HREF}>Справочниках › Подразделения</a>.
        </p>
      )}

      {node.refType === 'shop' && (
        <div className="ep-block">
          <div className="editor-panel__label text-caps">Модель здания</div>
          {editing && node.orgUnitId ? (
            <select className="ep-register__select" value={node.kind} aria-label="Модель здания"
                    onChange={(e) => onChangeShopKind(node.orgUnitId as string, e.target.value)}>
              {SHOP_MODELS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
            </select>
          ) : (
            <p className="editor-panel__value">{SHOP_MODELS.find((m) => m.kind === node.kind)?.label ?? 'По названию цеха'}</p>
          )}
        </div>
      )}

      {isMachine && node.kpis.length > 0 && (
        <div className="ep-block">
          <div className="editor-panel__label text-caps">Характеристики типа</div>
          <dl className="editor-panel__kpis">
            {node.kpis.map((kpi) => (
              <div className="kpi" key={kpi.label}>
                <dt className="kpi__label">{kpi.label}</dt>
                <dd className="kpi__value">{kpi.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {isMachine && (
        machine
          ? <MachineCard machine={machine} wcTypes={wcTypes} operations={operations} editing={editing} onChangeType={onChangeMachineType} />
          : <p className="editor-panel__tip">Станка нет в справочнике «Оборудование» — обновите схему.</p>
      )}

      {!isMachine && composition.length > 0 && (
        <div className="ep-block">
          <div className="editor-panel__label text-caps">Состав ({composition.length})</div>
          <SceneObjectsTable rows={composition} selectedId={null} caption={`Состав: ${node.title}`}
                             onSelect={(r) => onOpenChild(r, false)} onEnter={(r) => onOpenChild(r, true)} />
        </div>
      )}

      {canEnter && (
        <div className="editor-panel__actions">
          <IconButton icon="enter" onClick={() => onEnter(node.id)} title="Войти внутрь (2×ЛКМ)">Войти внутрь</IconButton>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={isMachine ? 'Удалить станок?' : 'Удалить цех?'}
          objectName={node.title}
          consequence={consequence}
          confirmLabel="Удалить"
          danger
          busy={deleting}
          onCancel={() => setConfirm(false)}
          onConfirm={() => { void onDelete(node.id).then(() => setConfirm(false)) }}
        />
      )}
    </section>
  )
}
