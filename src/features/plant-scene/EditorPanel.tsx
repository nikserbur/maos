import { useState, useEffect } from 'react'
import type { ObjectKind } from './types'
import { STATUS_META } from './types'
import type { SceneMode } from './graph/graphReducer'
import type { SceneNode } from './graph/sceneModel'
import { KIND_META, PALETTE } from './graph/sceneModel'
import { api, type Machine, type WorkCenterType, type Operation, type OrgUnit } from '../../lib/api'

interface MachineCreateData {
  name: string
  wcTypeId: string
  orgUnit: string
  status: string
  kind: ObjectKind
}

interface EditorPanelProps {
  mode: SceneMode
  connecting: boolean
  selectedNode: SceneNode | null
  hasChildren: boolean
  machines: Machine[]
  wcTypes: WorkCenterType[]
  operations: Operation[]
  onToggleMode: () => void
  onAddNode: (kind: ObjectKind) => void
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
  mode,
  connecting,
  selectedNode,
  hasChildren,
  machines,
  wcTypes,
  operations,
  onToggleMode,
  onAddNode,
  onRename,
  onDelete,
  onEnter,
  onClose,
  onLinkMachine,
  onCreateMachine,
  onChangeMachineType,
  onChangeKind,
}: EditorPanelProps) {
  const editing = mode === 'edit'
  const statusMeta = selectedNode ? STATUS_META[selectedNode.status] : null

  const linkedMachine = selectedNode?.linkedMachineId
    ? machines.find((m) => m.id === selectedNode.linkedMachineId)
    : null
  const linkedWcType = linkedMachine?.wc_type_id
    ? wcTypes.find((t) => t.id === linkedMachine.wc_type_id)
    : null
  const linkedWcTypeName = linkedWcType?.name ?? null

  // Operations compatible with this machine's WC type
  const compatibleOps = linkedWcTypeName
    ? operations.filter((op) =>
        op.wc_types.split(',').some((t) => t.trim() === linkedWcTypeName),
      )
    : []

  // Registration form state — resets when selected node changes
  const [regName,   setRegName]   = useState('')
  const [regKind,   setRegKind]   = useState<ObjectKind>('feedstock')
  const [regWcType, setRegWcType] = useState('')
  const [regOrgUnit, setRegOrgUnit] = useState('')
  const [regStatus, setRegStatus] = useState('active')
  const [registering, setRegistering] = useState(false)
  const [regError,  setRegError]  = useState<string | null>(null)
  const [orgUnits, setOrgUnits]   = useState<OrgUnit[]>([])

  useEffect(() => { api.orgUnits.list().then(setOrgUnits).catch(() => {}) }, [])

  // 3D-вид объекта = вид его ТИПА оборудования: при выборе типа модель на схеме
  // подстраивается под тип (объект на схеме и тип оборудования — одно и то же).
  const selectWcType = (typeId: string) => {
    setRegWcType(typeId)
    const t = wcTypes.find((x) => x.id === typeId)
    if (t && (PALETTE as string[]).includes(t.kind)) {
      setRegKind(t.kind as ObjectKind)
      if (selectedNode) onChangeKind(selectedNode.id, t.kind as ObjectKind)
    }
  }

  useEffect(() => {
    if (!selectedNode) return
    setRegName(selectedNode.title)
    setRegKind(selectedNode.kind)
    setRegWcType('')
    setRegOrgUnit('')
    setRegStatus('active')
    setRegError(null)
  }, [selectedNode?.id])

  const handleRegister = async () => {
    if (!regName.trim()) { setRegError('Укажите название'); return }
    setRegistering(true)
    setRegError(null)
    try {
      await onCreateMachine(selectedNode!.id, {
        name: regName, wcTypeId: regWcType,
        orgUnit: regOrgUnit, status: regStatus,
        kind: regKind,
      })
    } catch (e) {
      setRegError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setRegistering(false)
    }
  }

  return (
    <aside className="editor-panel" aria-label="Панель редактора">

      {/* Режим */}
      <div className="editor-panel__section editor-panel__section--mode">
        <button
          className={`editor-panel__mode-btn${editing ? ' editor-panel__mode-btn--on' : ''}`}
          onClick={onToggleMode}
        >
          {editing ? '● Редактирование' : 'Просмотр'}
        </button>
        {connecting && (
          <div className="editor-panel__connecting-hint">↔ Нажмите на целевой узел</div>
        )}
      </div>

      {/* Добавление объекта — только в редактировании. 3D-вид задаёт ТИП
          оборудования (выбирается справа в карточке после добавления). */}
      {editing && (
        <div className="editor-panel__section">
          <div className="editor-panel__label">Добавить объект</div>
          <button
            className="btn btn--primary"
            style={{ width: '100%' }}
            onClick={() => onAddNode((wcTypes[0]?.kind as ObjectKind) || 'marketing')}
          >
            + Добавить оборудование на схему
          </button>
          <p className="editor-panel__tip mono">
            Объект появится в центре. Выберите его и задайте справа <b>тип оборудования</b>
            (= 3D-вид), наименование и подразделение — gizmo перемещает, ↔ соединяет.
          </p>
        </div>
      )}

      {/* Инспектор */}
      {selectedNode && (
        <div className="editor-panel__section editor-panel__inspector">
          <div className="editor-panel__inspector-head">
            <div className="editor-panel__eyebrow">Объект схемы</div>
            {editing ? (
              <input
                className="editor-panel__title-input"
                value={selectedNode.title}
                onChange={(e) => onRename(selectedNode.id, e.target.value)}
                aria-label="Название"
              />
            ) : (
              <h2 className="editor-panel__title">{selectedNode.title}</h2>
            )}
            <p className="editor-panel__subtitle">{selectedNode.subtitle}</p>
            <button className="editor-panel__close" onClick={onClose} aria-label="Закрыть">✕</button>
          </div>

          {statusMeta && (
            <div className="editor-panel__status">
              <span className="editor-panel__status-dot" style={{ background: statusMeta.color }} />
              <span>{statusMeta.label}</span>
            </div>
          )}


          {selectedNode.kpis.length > 0 && (
            <>
              <div className="editor-panel__label">Показатели</div>
              <dl className="editor-panel__kpis">
                {selectedNode.kpis.map((kpi) => (
                  <div className="kpi" key={kpi.label}>
                    <dt className="kpi__label">{kpi.label}</dt>
                    <dd className="kpi__value mono">{kpi.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {/* ── Оборудование (НСИ) ─────────────────────────────────── */}
          <div className="editor-panel__label">Оборудование (НСИ)</div>

          {linkedMachine ? (
            <div className="ep-machine-card">
              <div className="ep-machine-card__name">{linkedMachine.name}</div>
              {/* Смена типа оборудования у уже зарегистрированной машины (3D-вид следует типу). */}
              {editing ? (
                <div style={{ margin: '4px 0' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Тип оборудования (= 3D-вид)</span>
                  <select className="ep-register__select" style={{ width: '100%' }}
                    value={linkedMachine.wc_type_id || ''}
                    onChange={(e) => onChangeMachineType(linkedMachine.id, e.target.value)}>
                    <option value="">— выберите тип —</option>
                    {wcTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} — {KIND_META[t.kind as ObjectKind]?.label ?? t.kind}</option>
                    ))}
                  </select>
                </div>
              ) : linkedWcTypeName && (
                <div className="ep-machine-card__type">{linkedWcTypeName}</div>
              )}
              <dl className="editor-panel__kpis" style={{ marginTop: 6 }}>
                <div className="kpi">
                  <dt className="kpi__label">Статус</dt>
                  <dd className="kpi__value">{linkedMachine.status || '—'}</dd>
                </div>
                {linkedMachine.org_unit && (
                  <div className="kpi">
                    <dt className="kpi__label">Подразделение</dt>
                    <dd className="kpi__value">{linkedMachine.org_unit}</dd>
                  </div>
                )}
                {linkedMachine.inv_no && (
                  <div className="kpi">
                    <dt className="kpi__label">Инв. №</dt>
                    <dd className="kpi__value mono">{linkedMachine.inv_no}</dd>
                  </div>
                )}
                {linkedMachine.schedule && (
                  <div className="kpi">
                    <dt className="kpi__label">Расписание</dt>
                    <dd className="kpi__value">{linkedMachine.schedule}</dd>
                  </div>
                )}
              </dl>

              {/* Доступные операции */}
              {compatibleOps.length > 0 && (
                <>
                  <div className="editor-panel__label" style={{ marginTop: 10 }}>
                    Операции ({compatibleOps.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {compatibleOps.map((op) => (
                      <div key={op.id} style={{
                        fontSize: 11, padding: '3px 6px',
                        background: 'var(--bg-card)', borderRadius: 2,
                        color: 'var(--text-secondary)',
                        display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>{op.name}</span>
                        {op.t_norm && (
                          <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {op.t_norm} мин
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {linkedWcTypeName && compatibleOps.length === 0 && (
                <p className="editor-panel__tip mono" style={{ marginTop: 6 }}>
                  Нет операций для типа «{linkedWcTypeName}».
                </p>
              )}

              {editing && (
                <button
                  className="ep-machine-card__unlink"
                  onClick={() => onLinkMachine(selectedNode.id, null)}
                >
                  Отвязать
                </button>
              )}
            </div>
          ) : editing ? (
            <div className="ep-register">
              <p className="ep-register__hint mono">
                Объект не зарегистрирован. Заполните данные и нажмите «Зарегистрировать».
              </p>
              {regError && <div className="ep-register__error">{regError}</div>}

              <label className="ep-register__label">Наименование *</label>
              <input className="ep-register__input" value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Название единицы оборудования" />

              <label className="ep-register__label">Тип оборудования (= 3D-вид на схеме)</label>
              <select className="ep-register__select" value={regWcType}
                onChange={(e) => selectWcType(e.target.value)}>
                <option value="">— выберите тип —</option>
                {wcTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {KIND_META[t.kind as ObjectKind]?.label ?? t.kind}</option>
                ))}
              </select>
              {wcTypes.length === 0 && (
                <p className="ep-register__hint mono" style={{ color: 'var(--text-muted)' }}>
                  Нет типов — создайте их в НСИ → Типы оборудования.
                </p>
              )}
              {regWcType && (
                <p className="ep-register__hint mono" style={{ color: 'var(--text-muted)' }}>
                  3D-модель: {KIND_META[regKind]?.label ?? regKind} (по типу оборудования).
                </p>
              )}

              <label className="ep-register__label">Подразделение / Цех</label>
              <select className="ep-register__select" value={regOrgUnit}
                onChange={(e) => setRegOrgUnit(e.target.value)}>
                <option value="">— выберите подразделение —</option>
                {orgUnits.map((o) => (
                  <option key={o.id} value={o.name}>{o.name}</option>
                ))}
              </select>

              <label className="ep-register__label">Статус</label>
              <select className="ep-register__select" value={regStatus}
                onChange={(e) => setRegStatus(e.target.value)}>
                <option value="active">В работе</option>
                <option value="maintenance">Техобслуживание</option>
                <option value="decommissioned">Выведено из эксплуатации</option>
              </select>

              <button className="btn btn--primary ep-register__submit"
                onClick={handleRegister} disabled={registering}>
                {registering ? 'Сохраняем…' : 'Зарегистрировать в НСИ'}
              </button>
            </div>
          ) : (
            <p className="editor-panel__tip mono">
              Не привязано. Включите «Редактирование» чтобы зарегистрировать объект в реестре.
            </p>
          )}

          <div className="editor-panel__actions">
            {hasChildren && (
              <button className="btn" onClick={() => onEnter(selectedNode.id)}>
                Войти в подсхему ↘
              </button>
            )}
            {editing && (
              <button className="btn btn--danger" onClick={() => onDelete(selectedNode.id)}>
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
