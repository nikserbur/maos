/**
 * Вкладка «Таблица» конструктора — двойник канваса: та же модель строками (№ · операция · тип станка ·
 * время «33 · 25–63» · наладка · IDEF0). Колонки IDEF0 скрыты, пока все пусты («Показать IDEF0»).
 * Мини-полоса маршрута — номера «1 ▸ 2 ▸ … 8» (название — в подсказке и для диктора), Σ справа.
 */
import { useState, type DragEvent } from 'react'
import { fmtValue, num, NBSP } from '../../../explain/format'
import { Chip } from '../../../ui/kit'
import { totalMinutes, type CapacityBottleneck, type RoutingOp } from './routingModel'
import { bottleneckText, pertText } from './RoutingCanvas'

interface RoutingTableProps {
  ops: ReadonlyArray<RoutingOp>
  selectedId: string | null
  knownWc: ReadonlySet<string> | null
  bottleneck: CapacityBottleneck | null
  onSelect: (id: string) => void
}

const UNKNOWN_INPUTS = 'входы заданы в Справочниках — здесь не редактируются'

const idefCount = (op: RoutingOp) => op.inputs.length + op.outputs.length + op.controls.length + op.mechanisms.length

export function RoutingTable({ ops, selectedId, knownWc, bottleneck, onSelect }: RoutingTableProps) {
  const anyIdef = ops.some((o) => idefCount(o) > 0 || !o.inputsKnown)
  const [showIdef, setShowIdef] = useState(false)
  const idef = anyIdef || showIdef
  const cols = idef ? 9 : 5
  return (
    <div className="rt-tablebox">
      {!anyIdef && (
        <button type="button" className="btn btn--ghost btn--sm rt-tablebox__toggle" aria-expanded={showIdef} onClick={() => setShowIdef((v) => !v)}>
          {showIdef ? 'Скрыть IDEF0' : 'Показать IDEF0'}
        </button>
      )}
      <div className="rt-tablewrap">
        <table className="rt-table">
          <thead>
            <tr>
              <th scope="col" className="num">№</th>
              <th scope="col">Операция</th>
              <th scope="col">Тип станка</th>
              <th scope="col" className="num" title="Норма · оптимистичное–пессимистичное (PERT)">Время, мин</th>
              <th scope="col" className="num">Наладка, мин</th>
              {idef && <><th scope="col">Входы (I)</th><th scope="col">Выход (O)</th><th scope="col">Управление (C)</th><th scope="col">Механизм (M)</th></>}
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 && (
              <tr><td colSpan={cols} className="rt-table__empty">Операций пока нет — добавьте первую кнопкой «+ Операция».</td></tr>
            )}
            {ops.map((op, i) => (
              <tr key={op.id} className={`rt-table__row${op.id === selectedId ? ' is-selected' : ''}`} onClick={() => onSelect(op.id)}
                tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(op.id) }} aria-selected={op.id === selectedId}>
                <td className="num">{num(i + 1, 0)}</td>
                <th scope="row">
                  {op.title}
                  {bottleneck?.id === op.id && ops.length > 1 && <span className="rt-table__bn" title={bottleneckText(bottleneck)}>узкое место</span>}
                </th>
                <td>
                  {!op.wcType ? <Chip tone="setup" size="sm">тип не задан</Chip>
                    : !knownWc || knownWc.has(op.wcType) ? op.wcType : <><Chip tone="setup" size="sm">тип не найден в Справочниках</Chip> {op.wcType}</>}
                </td>
                <td className="num">{num(op.timeMin, 0)}{pertText(op) && <span className="rt-muted"> · {num(op.tOpt, 0)}–{num(op.tPess, 0)}</span>}</td>
                <td className="num">{op.setupMin > 0 ? num(op.setupMin, 0) : <span className="rt-muted">—</span>}</td>
                {idef && (
                  <>
                    <td>{op.inputsKnown ? op.inputs.map((m) => `${m.name} ×${fmtValue(m.qty)}${NBSP}${m.unit}`).join(', ') || '—' : <span className="rt-muted">{UNKNOWN_INPUTS}</span>}</td>
                    <td>{op.outputs.join(', ') || '—'}</td>
                    <td>{op.controls.join(', ') || '—'}</td>
                    <td>{op.mechanisms.join(', ') || '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {ops.length > 0 && (
            <tfoot>
              <tr>
                <td /><th scope="row">Σ {num(ops.length, 0)} оп.</th><td />
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
      <span className="rt-strip__total num">Σ {fmtValue(totalMinutes(ops), 'мин')}</span>
    </footer>
  )
}
