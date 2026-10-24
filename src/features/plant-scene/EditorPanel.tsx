/**
 * Правая колонка схемы (360 px): ошибка записи с «Повторить», добавление цеха/станка в
 * «Редактировании», карточка выбранного объекта (NodeInspector) или таблица объектов уровня
 * (InspectorEmpty). Переключатель режимов — над канвасом (SceneModeBar).
 */
import { ErrorBanner } from '../../ui/kit'
import { Icon } from '../../shell/icons'
import type { SceneNode } from './graph/sceneModel'
import { AddMachine, AddShop } from './EditorAdd'
import { InspectorEmpty, type SceneDataStatus, type SceneLevel } from './InspectorEmpty'
import { NodeInspector } from './NodeInspector'
import type { ObjectRow } from './SceneObjectsTable'
import type { SceneData } from './useSceneData'
import type { SceneOpsState } from './useSceneOps'
import type { SceneWrites } from './useSceneWrites'
import './editor-panel.css'

interface EditorPanelProps {
  editing: boolean
  connecting: boolean
  level: SceneLevel
  status: SceneDataStatus
  selectedNode: SceneNode | null
  /** Объекты уровня (таблица без выбора). */
  levelRows: ReadonlyArray<ObjectRow>
  /** Состав выбранного цеха/завода. */
  childRows: ReadonlyArray<ObjectRow>
  canEnter: boolean
  currentShopName: string | null
  data: SceneData
  ops: SceneOpsState
  writes: SceneWrites
  onSelectRow: (row: ObjectRow) => void
  onEnterRow: (row: ObjectRow) => void
  onOpenChild: (row: ObjectRow, enter: boolean) => void
  onEnter: (id: string) => void
  onClose: () => void
}

export function EditorPanel({
  editing, connecting, level, status, selectedNode, levelRows, childRows, canEnter, currentShopName, data, ops, writes,
  onSelectRow, onEnterRow, onOpenChild, onEnter, onClose,
}: EditorPanelProps) {
  return (
    <aside className="editor-panel" aria-label="Инспектор схемы">
      {connecting && (
        <div className="editor-panel__connecting" role="status">
          <Icon name="swap" size={14} />
          Связь: нажмите на целевой объект · Esc — отмена
        </div>
      )}

      {writes.failure && (
        <div className="editor-panel__section">
          <ErrorBanner title={writes.failure.title} error={writes.failure.error} message={undefined}
                       onRetry={writes.failure.retry} onDismiss={writes.dismiss} />
        </div>
      )}

      {/* Добавление — по уровню: на площадке цех, внутри цеха — станок. */}
      {editing && level === 'site' && <AddShop busy={writes.busy === 'add-shop'} onCreateShop={writes.createShop} />}
      {editing && level === 'shop' && currentShopName && (
        <AddMachine shopName={currentShopName} wcTypes={data.wcTypes} busy={writes.busy === 'add-machine'} onAddMachine={writes.addMachine} />
      )}

      {selectedNode ? (
        <NodeInspector
          key={selectedNode.id}
          node={selectedNode}
          editing={editing}
          composition={childRows}
          canEnter={canEnter}
          machines={data.machines}
          wcTypes={data.wcTypes}
          operations={data.operations}
          ops={ops}
          deleting={writes.busy === 'delete'}
          onRename={writes.rename}
          onDelete={writes.remove}
          onEnter={onEnter}
          onOpenChild={onOpenChild}
          onClose={onClose}
          onChangeShopKind={writes.changeShopKind}
          onChangeMachineType={writes.changeMachineType}
        />
      ) : (
        <InspectorEmpty level={level} status={status} rows={levelRows} selectedId={null} onSelect={onSelectRow} onEnter={onEnterRow} />
      )}
    </aside>
  )
}
