/**
 * Правая панель схемы: контекстное добавление (цех/станок в режиме редактирования) и
 * инспектор выбранного узла; без выбора — содержательное пустое состояние (X1 §1 п. 2).
 * Переключатель режимов живёт над канвасом (SceneModeBar), здесь его нет (X1 §1 п. 6).
 */
import { Chip, IconButton, type Tone } from '../../ui/kit'
import { Icon } from '../../shell/icons'
import type { ObjectKind, StageStatus } from './types'
import { STATUS_META } from './types'
import type { SceneMode } from './graph/graphReducer'
import type { SceneNode } from './graph/sceneModel'
import { SHOP_MODELS } from './Building'
import { AddMachine, AddShop } from './EditorAdd'
import { InspectorEmpty } from './InspectorEmpty'
import { MachineCard } from './MachineCard'
import { RegisterForm, type MachineCreateData } from './RegisterForm'
import { type Machine, type WorkCenterType, type Operation } from '../../lib/api'
import './editor-panel.css'

/** Статусы узлов схемы совпадают с тонами чипов кита (running/setup/idle/down). */
const STATUS_TONE: Record<StageStatus, Tone> = { running: 'running', setup: 'setup', idle: 'idle', down: 'down' }

interface EditorPanelProps {
  mode: SceneMode
  connecting: boolean
  selectedNode: SceneNode | null
  hasChildren: boolean
  machines: Machine[]
  wcTypes: WorkCenterType[]
  operations: Operation[]
  atRoot: boolean
  level: 'world' | 'site' | 'shop'
  currentShopName: string | null
  onCreateShop: (name: string, kind?: string) => void
  onChangeShopKind: (orgUnitId: string, kind: string) => void
  /** Добавить станок выбранного типа: создаётся СРАЗУ в НСИ (авто-имя, контекст цеха). */
  onAddMachine: (wcTypeId: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onEnter: (id: string) => void
  onClose: () => void
  onLinkMachine: (nodeId: string, machineId: string | null) => void
  onCreateMachine: (nodeId: string, data: MachineCreateData) => Promise<void>
  onChangeMachineType: (machineId: string, wcTypeId: string) => void
  onChangeKind: (nodeId: string, kind: ObjectKind) => void
}

export function EditorPanel({
  mode, connecting, selectedNode, hasChildren, machines, wcTypes, operations, atRoot, level, currentShopName,
  onCreateShop, onChangeShopKind, onAddMachine, onRename, onDelete, onEnter, onClose, onLinkMachine,
  onCreateMachine, onChangeMachineType, onChangeKind,
}: EditorPanelProps) {
  const editing = mode === 'edit'
  const linkedMachine = selectedNode?.linkedMachineId
    ? machines.find((m) => m.id === selectedNode.linkedMachineId) ?? null
    : null

  return (
    <aside className="editor-panel" aria-label="Инспектор схемы">
      {connecting && (
        <div className="editor-panel__connecting" role="status">
          <Icon name="swap" size={14} />
          Связь: нажмите на целевой узел
        </div>
      )}

      {/* Добавление — контекстное: на площадке создаём ЦЕХ, внутри цеха — станок. */}
      {editing && atRoot && <AddShop onCreateShop={onCreateShop} />}
      {editing && !atRoot && currentShopName && (
        <AddMachine shopName={currentShopName} wcTypes={wcTypes} onAddMachine={onAddMachine} />
      )}

      {!selectedNode ? (
        <InspectorEmpty level={level} editing={editing} />
      ) : (
        <section className="editor-panel__section editor-panel__inspector dk-rise" aria-label="Объект схемы">
          <header className="editor-panel__inspector-head">
            <div className="editor-panel__heading">
              <div className="editor-panel__eyebrow text-caps">
                {selectedNode.refType === 'shop' ? 'Цех' : selectedNode.refType === 'factory' ? 'Завод' : 'Объект схемы'}
              </div>
              {editing ? (
                <input className="editor-panel__title-input" value={selectedNode.title}
                       onChange={(e) => onRename(selectedNode.id, e.target.value)} aria-label="Название" />
              ) : (
                <h2 className="editor-panel__title">{selectedNode.title}</h2>
              )}
              {selectedNode.subtitle && <p className="editor-panel__subtitle">{selectedNode.subtitle}</p>}
            </div>
            <IconButton icon="close" variant="ghost" size="sm" onClick={onClose} title="Закрыть" />
          </header>

          <div className="editor-panel__status">
            <Chip tone={STATUS_TONE[selectedNode.status]}>{STATUS_META[selectedNode.status].label}</Chip>
          </div>

          {selectedNode.kpis.length > 0 && (
            <>
              <div className="editor-panel__label text-caps">Показатели</div>
              <dl className="editor-panel__kpis">
                {selectedNode.kpis.map((kpi) => (
                  <div className="kpi" key={kpi.label}>
                    <dt className="kpi__label">{kpi.label}</dt>
                    <dd className="kpi__value num">{kpi.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {/* ── Цех: выбор 3D-модели здания (сохраняется в НСИ) ─────── */}
          {selectedNode.refType === 'shop' && (
            <>
              <div className="editor-panel__label text-caps">Модель здания</div>
              {editing ? (
                <div className="ep-stack">
                  <select className="ep-register__select" value={selectedNode.kind} aria-label="Модель здания"
                          onChange={(e) => selectedNode.orgUnitId && onChangeShopKind(selectedNode.orgUnitId, e.target.value)}>
                    {SHOP_MODELS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
                  </select>
                  <p className="editor-panel__tip">
                    Вид здания на площадке: ангары с трубами и без, шед, арочный свод, резервуары,
                    градирня, башни. Выбор сохраняется за цехом.
                  </p>
                </div>
              ) : (
                <p className="editor-panel__tip">
                  {SHOP_MODELS.find((m) => m.kind === selectedNode.kind)?.label ?? selectedNode.kind}
                  {' '}· включите «Редактирование», чтобы сменить модель.
                </p>
              )}
            </>
          )}

          {/* ── Оборудование (НСИ) — только для станков ─────────────── */}
          {selectedNode.refType !== 'shop' && selectedNode.refType !== 'factory' && (
            <>
              <div className="editor-panel__label text-caps">Оборудование (НСИ)</div>
              {linkedMachine ? (
                <MachineCard machine={linkedMachine} wcTypes={wcTypes} operations={operations} editing={editing}
                             onChangeType={onChangeMachineType} onUnlink={() => onLinkMachine(selectedNode.id, null)} />
              ) : editing ? (
                <RegisterForm node={selectedNode} wcTypes={wcTypes} currentShopName={currentShopName}
                              onCreate={onCreateMachine} onChangeKind={onChangeKind} />
              ) : (
                <p className="editor-panel__tip">
                  Не привязано. Включите «Редактирование», чтобы зарегистрировать объект в реестре.
                </p>
              )}
            </>
          )}

          <div className="editor-panel__actions">
            {hasChildren && (
              <IconButton icon="enter" onClick={() => onEnter(selectedNode.id)} title="Войти внутрь (2×ЛКМ)">
                Войти внутрь
              </IconButton>
            )}
            {editing && (
              <IconButton icon="close" variant="danger" onClick={() => onDelete(selectedNode.id)}>Удалить</IconButton>
            )}
          </div>
        </section>
      )}
    </aside>
  )
}
