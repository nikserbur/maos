/**
 * Вкладка «Таблица» конструктора — a11y-двойник канваса: та же модель строками
 * (№ · операция · тип РЦ · время · входы · выход · управление · механизм), клик по строке
 * выделяет операцию в инспекторе; мини-полоса маршрута — внизу экрана, с перетаскиванием порядка.
 */
import { useState, type DragEvent } from 'react'
import { fmtValue } from '../../../explain/format'
import { bottleneckId, totalMinutes, type RoutingOp } from './routingModel'

interface RoutingTableProps {
  ops: ReadonlyArray<RoutingOp>
  selectedId: string | null
  onSelect: (id: string) => void
}

export function RoutingTable({ ops, selectedId, onSelect }: RoutingTableProps) {
  const bottleneck = ops.length > 1 ? bottleneckId(ops) : null
  return (
    <div className="rt-tablewrap">
      <table className="rt-table">
        <thead>
          <tr>
            <th scope="col" className="num">№</th>
            <th scope="col">Операция</th>
            <th scope="col">Тип РЦ</th>
            <th scope="col" className="num">Время, мин</th>
            <th scope="col">Входы (I)</th>
            <th scope="col">Выход (O)</th>
            <th scope="col">Управление (C)</th>
            <th scope="col">Механизм (M)</th>
          </tr>
        </thead>
        <tbody>
          {ops.length === 0 && (
            <tr><td colSpan={8} className="rt-table__empty">Операций пока нет — добавьте первую в инспекторе.</td></tr>
          )}
          {ops.map((op, i) => (
            <tr key={op.id} className={`rt-table__row${op.id === selectedId ? ' is-selected' : ''}`} onClick={() => onSelect(op.id)}
              tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(op.id) }} aria-selected={op.id === selectedId}>
              <td className="num">{i + 1}</td>
              <th scope="row">{op.title}{op.id === bottleneck && <span className="rt-table__bn" title="Узкое место: самая длинная операция"> ▲</span>}</th>
              <td className={op.wcType ? undefined : 'rt-table__missing'}>{op.wcType || 'не задан'}</td>
              <td className="num">{fmtValue(op.timeMin)}</td>
              <td>{op.inputs.map((m) => `${m.name} ×${fmtValue(m.qty)} ${m.unit}`).join(', ') || '—'}</td>
              <td>{op.outputs.join(', ') || '—'}</td>
              <td>{op.controls.join(', ') || '—'}</td>
              <td>{op.mechanisms.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
        {ops.length > 0 && (
          <tfoot>
            <tr><td /><th scope="row">Σ {ops.length} оп.</th><td /><td className="num">{fmtValue(totalMinutes(ops))}</td><td colSpan={4} /></tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

interface RouteStripProps {
  ops: ReadonlyArray<RoutingOp>
  selectedId: string | null
  onSelect: (id: string) => void
  onMoveTo: (id: string, index: number) => void
}

/** Мини-полоса маршрута «1 ▸ 2 ▸ … ▸ n»: клик — выбрать, перетаскивание — изменить порядок. */
export function RouteStrip({ ops, selectedId, onSelect, onMoveTo }: RouteStripProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const onDragStart = (e: DragEvent<HTMLButtonElement>, id: string) => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = (e: DragEvent<HTMLLIElement>, i: number) => { e.preventDefault(); setOverIdx(i) }
  const onDrop = (i: number) => { if (dragId) onMoveTo(dragId, i); setDragId(null); setOverIdx(null) }
  const bottleneck = ops.length > 1 ? bottleneckId(ops) : null
  return (
    <footer className="rt-strip">
      <ol className="rt-strip__list" aria-label="Порядок операций маршрута">
        {ops.map((op, i) => (
          <li key={op.id} className={`rt-strip__item${overIdx === i && dragId && dragId !== op.id ? ' is-over' : ''}`}
            onDragOver={(e) => onDragOver(e, i)} onDragLeave={() => setOverIdx(null)} onDrop={() => onDrop(i)}>
            <button type="button" draggable className={`rt-chip${op.id === selectedId ? ' is-selected' : ''}${op.id === bottleneck ? ' is-bottleneck' : ''}`}
              title={`${op.title} · ${fmtValue(op.timeMin, 'мин')}. Перетащите, чтобы изменить порядок`}
              onClick={() => onSelect(op.id)} onDragStart={(e) => onDragStart(e, op.id)} onDragEnd={() => { setDragId(null); setOverIdx(null) }}>
              <span className="rt-chip__n num">{i + 1}</span>
              <span className="rt-chip__t">{op.title}</span>
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
