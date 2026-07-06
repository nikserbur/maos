import { useState, useEffect } from 'react'
import type { ObjectKind } from './types'
import { STATUS_META } from './types'
import type { SceneMode } from './graph/graphReducer'
import type { SceneNode } from './graph/sceneModel'
import { KIND_META, PALETTE } from './graph/sceneModel'
import { SHOP_MODELS } from './Building'
import { type Machine, type WorkCenterType, type Operation } from '../../lib/api'

/** Статус станка → человекочитаемая метка + класс цветного бейджа. */
const MACHINE_STATUS: Record<string, { label: string; cls: string }> = {
  active:         { label: 'В работе', cls: 'ok' },
  maintenance:    { label: 'Техобслуживание', cls: 'warn' },
  decommissioned: { label: 'Выведено', cls: 'off' },
}

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
  atRoot: boolean
  currentShopName: string | null
  onCreateShop: (name: string, kind?: string) => void
  onChangeShopKind: (orgUnitId: string, kind: string) => void
  onToggleMode: () => void
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
  mode,
  connecting,
  selectedNode,
  hasChildren,
  machines,
  wcTypes,
  operations,
  atRoot,
  currentShopName,
  onCreateShop,
  onChangeShopKind,
  onToggleMode,
  onAddMachine,
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

  // Операции группируем по названию (в реестре много одноимённых из разных
  // техкарт) → компактный список: название + число + диапазон норм времени.
  const opGroups = ((): Array<{ name: string; count: number; range: string }> => {
    const g = new Map<string, { count: number; times: number[] }>()
    for (const op of compatibleOps) {
      const e = g.get(op.name) ?? { count: 0, times: [] }
      e.count += 1
      const t = parseFloat(op.t_norm)
      if (!Number.isNaN(t)) e.times.push(t)
      g.set(op.name, e)
    }
    return [...g.entries()]
      .map(([name, e]) => {
        const min = e.times.length ? Math.min(...e.times) : null
        const max = e.times.length ? Math.max(...e.times) : null
        const range = min === null ? '' : min === max ? `${min} мин` : `${min}–${max} мин`
        return { name, count: e.count, range }
      })
      .sort((a, b) => b.count - a.count)
  })()

  // Registration form state — resets when selected node changes
  const [newShopName, setNewShopName] = useState('')
  const [newShopKind, setNewShopKind] = useState('')   // '' = авто по названию
  const [addWcType,   setAddWcType]   = useState('')   // тип для нового станка
  const [regName,   setRegName]   = useState('')
  const [regKind,   setRegKind]   = useState<ObjectKind>('feedstock')
  const [regWcType, setRegWcType] = useState('')
  const [regOrgUnit, setRegOrgUnit] = useState('')
  const [regStatus, setRegStatus] = useState('active')
  const [registering, setRegistering] = useState(false)
  const [regError,  setRegError]  = useState<string | null>(null)

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
    // Станок без типа не связывается с операциями техкарт → «оборудование без операций».
    if (!regWcType) { setRegError('Выберите тип оборудования — без типа станок не получит операций из техкарт'); return }
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

      {/* Добавление — контекстное: на площадке создаём ЦЕХ, внутри цеха — станок.
          Двухуровневая иерархия: станок всегда в цехе, цех не внутри цеха. */}
      {editing && atRoot && (
        <div className="editor-panel__section">
          <div className="editor-panel__label">Уровень площадки</div>
          <input className="ep-register__input" value={newShopName}
                 onChange={(e) => setNewShopName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && newShopName.trim()) { onCreateShop(newShopName.trim(), newShopKind); setNewShopName('') } }}
                 placeholder="Название цеха (напр. «Сборочный цех»)" />
          <select className="ep-register__select" style={{ marginTop: 6 }} value={newShopKind}
                  onChange={(e) => setNewShopKind(e.target.value)}
                  title="3D-модель здания цеха на площадке">
            <option value="">Модель здания — авто по названию</option>
            {SHOP_MODELS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
          </select>
          <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                  disabled={!newShopName.trim()}
                  onClick={() => { onCreateShop(newShopName.trim(), newShopKind); setNewShopName('') }}>
            + Добавить цех
          </button>
          <p className="editor-panel__tip mono">
            Создайте цех (подразделение), затем войдите в него (2×ЛКМ) и добавляйте станки.
            Оборудование можно размещать только <b>внутри цеха</b>.
          </p>
        </div>
      )}
      {editing && !atRoot && currentShopName && (
        <div className="editor-panel__section">
          <div className="editor-panel__label">Цех: {currentShopName ?? '—'}</div>
          {wcTypes.length === 0 ? (
            <p className="editor-panel__tip mono" style={{ color: 'var(--intent-warning)' }}>
              Типов оборудования нет — сначала создайте тип в <b>Справочники → Типы
              оборудования</b>, затем добавляйте станки.
            </p>
          ) : (
            <>
              <select className="ep-register__select" value={addWcType}
                      onChange={(e) => setAddWcType(e.target.value)}>
                <option value="">— тип оборудования —</option>
                {wcTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                className="btn btn--primary"
                style={{ width: '100%', marginTop: 6 }}
                disabled={!addWcType}
                onClick={() => onAddMachine(addWcType)}
              >
                + Добавить станок
              </button>
              <p className="editor-panel__tip mono">
                Станок <b>сразу создаётся в НСИ</b> (имя «Тип №N», статус «В работе») и
                встаёт в линию цеха. 3D-модель — строго по типу оборудования.
                Gizmo перемещает, ↔ соединяет дорожкой.
              </p>
            </>
          )}
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

          {/* ── Цех: выбор 3D-модели здания (сохраняется в НСИ) ─────── */}
          {selectedNode.refType === 'shop' && (
            <>
              <div className="editor-panel__label">Модель здания</div>
              {editing ? (
                <>
                  <select className="ep-register__select" value={selectedNode.kind}
                          onChange={(e) => selectedNode.orgUnitId && onChangeShopKind(selectedNode.orgUnitId, e.target.value)}>
                    {SHOP_MODELS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
                  </select>
                  <p className="editor-panel__tip mono">
                    Вид здания на площадке: ангары с трубами и без, шед, арочный свод,
                    резервуары, градирня, башни. Выбор сохраняется за цехом.
                  </p>
                </>
              ) : (
                <p className="editor-panel__tip mono">
                  {SHOP_MODELS.find((m) => m.kind === selectedNode.kind)?.label ?? selectedNode.kind}
                  {' '}· включите «Редактирование», чтобы сменить модель.
                </p>
              )}
            </>
          )}

          {/* ── Оборудование (НСИ) — только для станков ─────────────── */}
          {selectedNode.refType !== 'shop' && (<>
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
              {/* Статус — цветной бейдж (локализованный, вместо сырого «active») */}
              {(() => {
                const st = MACHINE_STATUS[linkedMachine.status] ?? { label: linkedMachine.status || '—', cls: 'off' }
                return (
                  <span className={`ep-badge ep-badge--${st.cls}`}>
                    <span className="ep-badge__dot" />{st.label}
                  </span>
                )
              })()}

              {/* Атрибуты: метка над значением — длинные (подразделение) переносятся */}
              <div className="ep-fields">
                {linkedMachine.org_unit && (
                  <div className="ep-field">
                    <span className="ep-field__k">Подразделение</span>
                    <span className="ep-field__v">{linkedMachine.org_unit}</span>
                  </div>
                )}
                {linkedMachine.inv_no && (
                  <div className="ep-field ep-field--row">
                    <span className="ep-field__k">Инв. №</span>
                    <span className="ep-field__v mono">{linkedMachine.inv_no}</span>
                  </div>
                )}
                {linkedMachine.schedule && (
                  <div className="ep-field ep-field--row">
                    <span className="ep-field__k">Расписание</span>
                    <span className="ep-field__v">{linkedMachine.schedule}</span>
                  </div>
                )}
              </div>

              {/* Операции — сгруппированы по названию (число + диапазон времени) */}
              {opGroups.length > 0 && (
                <div className="ep-ops-wrap">
                  <div className="ep-ops__head">
                    Операции<span className="ep-ops__count">{compatibleOps.length}</span>
                  </div>
                  <ul className="ep-ops">
                    {opGroups.map((g) => (
                      <li className="ep-op" key={g.name}>
                        <span className="ep-op__name" title={g.name}>{g.name}</span>
                        <span className="ep-op__meta">
                          {g.count > 1 && <span className="ep-op__count">×{g.count}</span>}
                          {g.range && <span className="ep-op__time mono">{g.range}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
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
                <p className="ep-register__hint mono" style={{ color: 'var(--intent-warning)' }}>
                  Типов оборудования ещё нет — станок нельзя привязать к операциям техкарт.
                  Откройте <b>Справочники → Типы оборудования</b>, создайте тип
                  (например «Токарный станок ЧПУ»), затем вернитесь и выберите его здесь.
                </p>
              )}
              {regWcType && (
                <p className="ep-register__hint mono" style={{ color: 'var(--text-muted)' }}>
                  3D-модель: {KIND_META[regKind]?.label ?? regKind} (по типу оборудования).
                </p>
              )}

              <label className="ep-register__label">Цех (по контексту)</label>
              <div className="ep-register__input" style={{ opacity: 0.75, cursor: 'default' }}>
                {currentShopName ?? '— вне цеха —'}
              </div>

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
          </>)}

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
