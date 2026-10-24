/**
 * Карточка единицы оборудования (НСИ) в инспекторе схемы: тип (= 3D-вид), статус чипом кита
 * по единому словарю (STATUS_META, X2 P-28), атрибуты, операции техкарт (сгруппированы по названию).
 */
import { Chip } from '../../ui/kit'
import { num } from '../../explain/format'
import { STATUS_META, statusFromNsi, type ObjectKind } from './types'
import { KIND_META } from './graph/sceneModel'
import type { Machine, Operation, WorkCenterType } from '../../lib/api'

interface OpGroup { name: string; count: number; range: string }

/** Операции группируем по названию (в реестре много одноимённых из разных техкарт). */
export function groupOps(ops: ReadonlyArray<Operation>): OpGroup[] {
  const g = new Map<string, { count: number; times: number[] }>()
  for (const op of ops) {
    const e = g.get(op.name) ?? { count: 0, times: [] }
    const t = parseFloat(op.t_norm)
    g.set(op.name, { count: e.count + 1, times: Number.isNaN(t) ? e.times : [...e.times, t] })
  }
  return [...g.entries()]
    .map(([name, e]) => {
      const min = e.times.length ? Math.min(...e.times) : null
      const max = e.times.length ? Math.max(...e.times) : null
      const range = min === null ? '' : min === max ? `${num(min)} мин` : `${num(min)}–${num(max)} мин`
      return { name, count: e.count, range }
    })
    .sort((a, b) => b.count - a.count)
}

interface MachineCardProps {
  machine: Machine
  wcTypes: WorkCenterType[]
  operations: Operation[]
  editing: boolean
  onChangeType: (machineId: string, wcTypeId: string) => void
}

export function MachineCard({ machine, wcTypes, operations, editing, onChangeType }: MachineCardProps) {
  const wcType = machine.wc_type_id ? wcTypes.find((t) => t.id === machine.wc_type_id) : null
  const wcTypeName = wcType?.name ?? null
  const compatible = wcTypeName
    ? operations.filter((op) => op.wc_types.split(',').some((t) => t.trim() === wcTypeName))
    : []
  const groups = groupOps(compatible)
  const status = statusFromNsi(machine.status)

  return (
    <div className="ep-machine-card">
      <div className="ep-machine-card__head">
        <div className="ep-machine-card__name">{machine.name}</div>
        <Chip tone={status} size="sm">{STATUS_META[status].label}</Chip>
      </div>
      {/* Смена типа оборудования у уже зарегистрированной машины (3D-вид следует типу). */}
      {editing ? (
        <label className="ep-field">
          <span className="ep-field__k">Тип оборудования (= 3D-вид)</span>
          <select className="ep-register__select" value={machine.wc_type_id || ''}
                  onChange={(e) => onChangeType(machine.id, e.target.value)}>
            <option value="">— выберите тип —</option>
            {wcTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name} — {KIND_META[t.kind as ObjectKind]?.label ?? t.kind}</option>
            ))}
          </select>
        </label>
      ) : wcTypeName && (
        <div className="ep-machine-card__type">{wcTypeName}</div>
      )}

      {/* Атрибуты: метка над значением — длинные (подразделение) переносятся */}
      <div className="ep-fields">
        {machine.org_unit && (
          <div className="ep-field">
            <span className="ep-field__k">Подразделение</span>
            <span className="ep-field__v">{machine.org_unit}</span>
          </div>
        )}
        {machine.inv_no && (
          <div className="ep-field ep-field--row">
            <span className="ep-field__k">Инв. №</span>
            <span className="ep-field__v mono">{machine.inv_no}</span>
          </div>
        )}
        {machine.schedule && (
          <div className="ep-field ep-field--row">
            <span className="ep-field__k">Расписание</span>
            <span className="ep-field__v">{machine.schedule}</span>
          </div>
        )}
      </div>

      {groups.length > 0 && (
        <div className="ep-ops-wrap">
          <div className="ep-ops__head text-caps">
            Операции<span className="ep-ops__count num">{num(compatible.length, 0)}</span>
          </div>
          <ul className="ep-ops">
            {groups.map((g) => (
              <li className="ep-op" key={g.name}>
                <span className="ep-op__name" title={g.name}>{g.name}</span>
                <span className="ep-op__meta">
                  {g.count > 1 && <span className="ep-op__count num">×{num(g.count, 0)}</span>}
                  {g.range && <span className="ep-op__time num">{g.range}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {wcTypeName && compatible.length === 0 && (
        <p className="editor-panel__tip">Нет операций для типа «{wcTypeName}».</p>
      )}

    </div>
  )
}
