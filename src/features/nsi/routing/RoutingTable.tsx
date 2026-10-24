/**
 * Вкладка «Таблица» конструктора — двойник канваса: та же модель строками (шаг · операция · тип
 * оборудования · время «33 (25–63)» · наладка · IDEF0). Таблица — на классах кита (.dk-table: гибкая
 * колонка операции, числа по содержимому). Колонки IDEF0 скрыты, пока все пусты («Показать IDEF0»).
 * Мини-полоса маршрута — номера «1 ▸ 2 ▸ … 8» (название — в подсказке и для диктора), итог справа.
 */
import { useState, type DragEvent } from 'react'
import { countText, fmtValue, num, NBSP } from '../../../explain/format'
import { Chip } from '../../../ui/kit'
import { headWidth } from '../../../ui/kit/columnLayout'
import { totalMinutes, type CapacityBottleneck, type RoutingOp } from './routingModel'
import { bottleneckText, pertText } from './RoutingCanvas'

interface RoutingTableProps {
  ops: ReadonlyArray<RoutingOp>
  selectedId: string | null
  knownWc: ReadonlySet<string> | null
  bottleneck: CapacityBottleneck | null
  onSelect: (id: string) => void
}

const UNKNOWN_INPUTS = 'Входы части операций заданы в Справочниках и здесь не редактируются.'
const OPS_FORMS = ['операция', 'операции', 'операций'] as const

const idefCount = (op: RoutingOp) => op.inputs.length + op.outputs.length + op.controls.length + op.mechanisms.length

/** Числовая шапка по ширине своего заголовка (как в DataTable): не уже половины текста — 1–2 строки, а не столбик. */
const NUM_FIT = { fit: true, right: true, primary: false } as const
const numHead = (title: string): string => `num dk-col-fit dk-thw-${headWidth(title, NUM_FIT) ?? 8}`
const TIME_TITLE = 'Время по норме (от–до), мин'
const SETUP_TITLE = 'Наладка, мин'

export function RoutingTable({ ops, selectedId, knownWc, bottleneck, onSelect }: RoutingTableProps) {
  const anyIdef = ops.some((o) => idefCount(o) > 0 || !o.inputsKnown)
  const [showIdef, setShowIdef] = useState(false)
  const idef = anyIdef || showIdef
  const cols = idef ? 9 : 5
  const someUnknown = idef && ops.some((o) => !o.inputsKnown)
  return (
    <div className="rt-tablebox">
      {!anyIdef && (
        <button type="button" className="btn btn--ghost btn--sm rt-tablebox__toggle" aria-expanded={showIdef} onClick={() => setShowIdef((v) => !v)}>
          {showIdef ? 'Скрыть IDEF0' : 'Показать IDEF0'}
        </button>
      )}
      {someUnknown && <p className="rt-tablebox__note">{UNKNOWN_INPUTS}</p>}
      <div className="dk-table-wrap dk-table-wrap--framed rt-tablewrap">
        <table className="dk-table dk-table--tight">
          <thead>
            <tr>
              <th scope="col" className={numHead('Шаг')}>Шаг</th>
              <th scope="col" className="dk-col-primary">Операция</th>
              <th scope="col" className="dk-minw-14">Тип оборудования</th>
              <th scope="col" className={numHead(TIME_TITLE)} title="Норма времени, в скобках — оптимистичная и пессимистичная оценки">{TIME_TITLE}</th>
              <th scope="col" className={numHead(SETUP_TITLE)}>{SETUP_TITLE}</th>
              {idef && <><th scope="col">Входы</th><th scope="col">Выход</th><th scope="col">Управление</th><th scope="col">Механизм</th></>}
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 && (
              <tr><td colSpan={cols} className="dk-td-empty">Операций пока нет — добавьте первую кнопкой «+ Операция».</td></tr>
            )}
            {ops.map((op, i) => (
              <tr key={op.id} className={`is-click${op.id === selectedId ? ' is-chosen' : ''}`} onClick={() => onSelect(op.id)}
                tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(op.id) }} aria-selected={op.id === selectedId}>
                <td className="num dk-col-fit">{num(i + 1, 0)}</td>
                <th scope="row" className="dk-col-primary">
                  <span className="dk-cell-block">
                    {op.title}
                    {bottleneck?.id === op.id && ops.length > 1 && <span className="rt-table__bn" title={bottleneckText(bottleneck)}>узкое место</span>}
                  </span>
                </th>
                <td className="dk-minw-14">
                  {!op.wcType ? <Chip tone="setup" size="sm">тип не задан</Chip>
                    : !knownWc || knownWc.has(op.wcType) ? op.wcType : <><Chip tone="setup" size="sm">тип не найден в Справочниках</Chip> {op.wcType}</>}
                </td>
                <td className="num dk-col-fit">{num(op.timeMin, 0)}{pertText(op) && <span className="rt-muted"> ({num(op.tOpt, 0)}–{num(op.tPess, 0)})</span>}</td>
                <td className="num dk-col-fit">{op.setupMin > 0 ? num(op.setupMin, 0) : <span className="rt-muted">—</span>}</td>
                {idef && (
                  <>
                    <td>{op.inputsKnown ? op.inputs.map((m) => `${m.name} ×${fmtValue(m.qty)}${NBSP}${m.unit}`).join(', ') || '—' : <span className="rt-muted" title={UNKNOWN_INPUTS}>в Справочниках</span>}</td>
                    <td>{op.outputs.join(', ') || '—'}</td>
                    <td>{op.controls.join(', ') || '—'}</td>
                    <td>{op.mechanisms.join(', ') || '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {ops.length > 0 && (
            <tfoot className="rt-table__foot">
              <tr>
                <td /><th scope="row">Итого: {countText(ops.length, OPS_FORMS)}</th><td />
                <td className="num">{num(totalMinutes(ops), 0)}</td>
                <td className="num">{num(ops.reduce((s, o) => s + o.setupMin, 0), 0)}</td>
                {idef && <td colSpan={4} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

interface RouteStripProps {
  ops: ReadonlyArray<RoutingOp>
  selectedId: string | null
  bottleneckId: string | null
  onSelect: (id: string) => void
  onMoveTo: (id: string, index: number) => void
}

/** Мини-полоса маршрута «1 ▸ 2 ▸ … ▸ n»: клик — выбрать, перетаскивание — изменить порядок. */
export function RouteStrip({ ops, selectedId, bottleneckId, onSelect, onMoveTo }: RouteStripProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const onDragStart = (e: DragEvent<HTMLButtonElement>, id: string) => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = (e: DragEvent<HTMLLIElement>, i: number) => { e.preventDefault(); setOverIdx(i) }
  const onDrop = (i: number) => { if (dragId) onMoveTo(dragId, i); setDragId(null); setOverIdx(null) }
  return (
    <footer className="rt-strip">
      <ol className="rt-strip__list" aria-label="Порядок операций маршрута">
        {ops.map((op, i) => (
          <li key={op.id} className={`rt-strip__item${overIdx === i && dragId && dragId !== op.id ? ' is-over' : ''}`}
            onDragOver={(e) => onDragOver(e, i)} onDragLeave={() => setOverIdx(null)} onDrop={() => onDrop(i)}>
            <button type="button" draggable className={`rt-chip${op.id === selectedId ? ' is-selected' : ''}${op.id === bottleneckId ? ' is-bottleneck' : ''}`}
              title={`${num(i + 1, 0)}. ${op.title} · ${fmtValue(op.timeMin, 'мин')}. Перетащите, чтобы изменить порядок`}
              aria-label={`Операция ${i + 1}: ${op.title}`} aria-pressed={op.id === selectedId}
              onClick={() => onSelect(op.id)} onDragStart={(e) => onDragStart(e, op.id)} onDragEnd={() => { setDragId(null); setOverIdx(null) }}>
              {num(i + 1, 0)}
            </button>
            {i < ops.length - 1 && <span className="rt-strip__arrow" aria-hidden="true">▸</span>}
          </li>
        ))}
        {ops.length === 0 && <li className="rt-strip__empty">маршрут пуст</li>}
      </ol>
      <span className="rt-strip__total num">Итого {fmtValue(totalMinutes(ops), 'мин')}</span>
    </footer>
  )
}
