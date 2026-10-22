/**
 * Канвас маршрута (X1 §2.1): узлы-карточки на граф-канвасе (пан/зум/вписать), ребро —
 * материальный поток (сплошное, 2 px, --chart-1), узкое место (max t) — кольцо охрой,
 * подписи переносятся в две строки и никогда не обрезаются (полный текст — в <title>).
 * Режимы: «Входы/выходы» — IDEF0-стрелки I/C/O/M; «Оборудование» — тип РЦ; «Время» — нормо-минуты.
 */
import { forwardRef, type KeyboardEvent } from 'react'
import { GraphCanvas, type GraphCanvasHandle } from '../../../ui/graph-canvas'
import { wrapLabel } from '../../../ui/charts/scale'
import { fmtValue } from '../../../explain/format'
import { bottleneckId, type RoutingOp } from './routingModel'

export type CanvasMode = 'io' | 'wc' | 'time'

export const NODE_W = 196
export const NODE_H = 76
const GAP = 84
const STEP = NODE_W + GAP
const ORIGIN_X = 120
const ORIGIN_Y = 120
const STUB = 44
/** Больше четырёх операций — маршрут укладывается «змейкой» в несколько рядов: обзор без зума 40 %. */
const MAX_PER_ROW = 4

interface Layout { perRow: number; rows: number; pitch: number }

/** Раскладка: ряды сбалансированы (8 → 4+4, 5 → 3+2), шаг ряда зависит от режима (место под стрелки C/M). */
export function layoutFor(n: number, mode: CanvasMode): Layout {
  const rows = Math.max(1, Math.ceil(n / MAX_PER_ROW))
  const perRow = Math.max(1, Math.ceil(n / rows))
  const pitch = NODE_H + (mode === 'io' ? (STUB + 40) * 2 : 72)
  return { perRow, rows, pitch }
}

const colOf = (i: number, l: Layout) => i % l.perRow
const rowOf = (i: number, l: Layout) => Math.floor(i / l.perRow)
const posX = (i: number, l: Layout) => ORIGIN_X + colOf(i, l) * STEP
const posY = (i: number, l: Layout) => ORIGIN_Y + rowOf(i, l) * l.pitch

interface RoutingCanvasProps {
  ops: ReadonlyArray<RoutingOp>
  selectedId: string | null
  mode: CanvasMode
  fitToken: number
  knownWc: ReadonlySet<string>
  onSelect: (id: string | null) => void
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}

export const RoutingCanvas = forwardRef<GraphCanvasHandle, RoutingCanvasProps>(function RoutingCanvas(
  { ops, selectedId, mode, fitToken, knownWc, onSelect, onKeyDown }, ref,
) {
  const n = ops.length
  const bottleneck = n > 1 ? bottleneckId(ops) : null
  const layout = layoutFor(n, mode)
  const cols = Math.min(n || 1, layout.perRow)
  const top = mode === 'io' ? STUB + 36 : 16
  const bounds = {
    x: ORIGIN_X - 90, y: ORIGIN_Y - top,
    w: (cols - 1) * STEP + NODE_W + 180,
    h: (layout.rows - 1) * layout.pitch + NODE_H + top + (mode === 'io' ? STUB + 36 : 32),
  }

  return (
    <GraphCanvas
      ref={ref}
      bounds={bounds}
      fitToken={fitToken}
      ariaLabel={`Маршрут: ${n} операций. Колесо — масштаб, перетаскивание — сдвиг, F — вписать`}
      className="rt-canvas"
      onBackgroundPointerDown={() => onSelect(null)}
      onKeyDown={onKeyDown}
      svg={
        <>
          <defs>
            <marker id="rt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" className="rt-arrow" />
            </marker>
          </defs>
          {n === 0 && (
            <g className="rt-empty">
              <rect x={ORIGIN_X} y={ORIGIN_Y} width={NODE_W} height={NODE_H} rx="8" />
              <text x={ORIGIN_X + NODE_W / 2} y={ORIGIN_Y + NODE_H / 2 + 4} textAnchor="middle">Добавьте первую операцию</text>
              <text x={ORIGIN_X + NODE_W / 2} y={ORIGIN_Y + NODE_H + 22} textAnchor="middle" className="rt-empty__hint">в инспекторе справа: из реестра или новую</text>
            </g>
          )}
          <FlowEdges ops={ops} mode={mode} layout={layout} />
          {ops.map((op, i) => (
            <Node key={op.id} op={op} index={i} layout={layout} mode={mode} selected={op.id === selectedId} bottleneck={op.id === bottleneck}
              known={knownWc.has(op.wcType)} onSelect={onSelect} />
          ))}
        </>
      }
    />
  )
})

/** Рёбра материального потока + внешний вход/выход; переход между рядами — «колено»; в режиме «Входы/выходы» — ещё и стрелки C/M. */
function FlowEdges({ ops, mode, layout }: { ops: ReadonlyArray<RoutingOp>; mode: CanvasMode; layout: Layout }) {
  const n = ops.length
  if (n === 0) return null
  const cy = (i: number) => posY(i, layout) + NODE_H / 2
  const first = ops[0]
  const last = ops[n - 1]
  const inText = first.inputs.length ? first.inputs.map((m) => `${m.name} ×${fmtValue(m.qty)}`).join(', ') : 'вход'
  const outText = last.outputs.length ? last.outputs.join(' + ') : 'выход'
  const lastRight = posX(n - 1, layout) + NODE_W
  return (
    <g className="rt-edges">
      <line x1={ORIGIN_X - 70} y1={cy(0)} x2={ORIGIN_X - 2} y2={cy(0)} className="rt-edge" markerEnd="url(#rt-arrow)" />
      <Label x={ORIGIN_X - 72} y={cy(0) - 12} text={inText} anchor="start" max={18} cls="rt-edge__label" />
      {ops.slice(0, -1).map((op, i) => {
        const x1 = posX(i, layout) + NODE_W
        const x2 = posX(i + 1, layout) - 2
        if (rowOf(i, layout) === rowOf(i + 1, layout)) {
          return <line key={op.id} x1={x1} y1={cy(i)} x2={x2} y2={cy(i)} className="rt-edge" markerEnd="url(#rt-arrow)" />
        }
        // Переход на следующий ряд: вправо → вниз до середины промежутка → влево к началу ряда → вниз → в порт.
        const midY = posY(i, layout) + NODE_H + (layout.pitch - NODE_H) / 2
        const d = `M ${x1} ${cy(i)} H ${x1 + GAP / 2} V ${midY} H ${ORIGIN_X - GAP / 2} V ${cy(i + 1)} H ${x2}`
        return <path key={op.id} d={d} className="rt-edge rt-edge--turn" markerEnd="url(#rt-arrow)" />
      })}
      <line x1={lastRight} y1={cy(n - 1)} x2={lastRight + 68} y2={cy(n - 1)} className="rt-edge" markerEnd="url(#rt-arrow)" />
      <Label x={lastRight + 4} y={cy(n - 1) - 12} text={outText} anchor="start" max={18} cls="rt-edge__label" />
      {mode === 'io' && ops.map((op, i) => <IdefStubs key={op.id} op={op} index={i} layout={layout} />)}
    </g>
  )
}

/** Стрелки управления (сверху) и механизмов (снизу) — только когда они заданы. */
function IdefStubs({ op, index, layout }: { op: RoutingOp; index: number; layout: Layout }) {
  const bx = posX(index, layout)
  const top = posY(index, layout)
  const bottom = top + NODE_H
  const spread = (items: string[]) => items.map((label, j) => ({ label, x: bx + ((j + 1) * NODE_W) / (items.length + 1) }))
  return (
    <g className="rt-idef">
      {spread(op.controls).map(({ label, x }, j) => (
        <g key={`c${j}`}>
          <line x1={x} y1={top - STUB} x2={x} y2={top - 2} className="rt-idef__line" markerEnd="url(#rt-arrow)" />
          <Label x={x} y={top - STUB - 8} text={label} anchor="middle" max={16} cls="rt-idef__label" />
        </g>
      ))}
      {spread(op.mechanisms).map(({ label, x }, j) => (
        <g key={`m${j}`}>
          <line x1={x} y1={bottom + STUB} x2={x} y2={bottom + 2} className="rt-idef__line" markerEnd="url(#rt-arrow)" />
          <Label x={x} y={bottom + STUB + 14} text={label} anchor="middle" max={16} cls="rt-idef__label" />
        </g>
      ))}
      {op.inputs.length > 0 && index > 0 && (
        <Label x={bx + 6} y={bottom + 16} text={`▸ ${op.inputs.map((m) => m.name).join(', ')}`} anchor="start" max={26} cls="rt-idef__label" />
      )}
    </g>
  )
}

/** Подпись с переносом в ≤ 2 строки; полный текст — в <title>. */
function Label({ x, y, text, anchor, max, cls }: { x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end'; max: number; cls: string }) {
  const lines = wrapLabel(text, max, 2)
  return (
    <text x={x} y={y} textAnchor={anchor} className={cls}>
      <title>{text}</title>
      {lines.map((ln, i) => <tspan key={i} x={x} dy={i ? 12 : 0}>{ln}</tspan>)}
    </text>
  )
}

interface NodeProps {
  op: RoutingOp
  index: number
  layout: Layout
  mode: CanvasMode
  selected: boolean
  bottleneck: boolean
  known: boolean
  onSelect: (id: string) => void
}

/** Узел-карточка 196×76: название (≤ 2 строки), вторая строка по режиму, время моно, индекс A n, бейдж НСИ. */
function Node({ op, index, layout, mode, selected, bottleneck, known, onSelect }: NodeProps) {
  const x = posX(index, layout)
  const y = posY(index, layout)
  const title = wrapLabel(op.title || 'Операция', 24, 2)
  const sub = mode === 'wc' || mode === 'io' ? (op.wcType || 'тип РЦ не задан') : `${fmtValue(op.timeMin, 'мин')} · норма`
  // Подстрока делит нижнюю строку со временем (моно ~52 px): ≤ 19 символов, хвост — «…», полный текст в <title>.
  const subLines = wrapLabel(sub, mode === 'time' ? 28 : 19, 1)
  const cls = ['rt-node', selected ? 'is-selected' : '', bottleneck ? 'is-bottleneck' : '', op.wcType ? '' : 'is-invalid'].filter(Boolean).join(' ')
  return (
    <g
      className={cls}
      data-gc-node="true"
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`Операция ${index + 1}: ${op.title}, ${op.wcType || 'без типа РЦ'}, ${fmtValue(op.timeMin, 'мин')}${bottleneck ? ', узкое место' : ''}`}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(op.id) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(op.id) } }}
    >
      <title>{`${op.title}\n${op.wcType || 'тип РЦ не задан'} · ${fmtValue(op.timeMin, 'мин')}`}</title>
      {bottleneck && <rect className="rt-node__ring" x={x - 4} y={y - 4} width={NODE_W + 8} height={NODE_H + 8} rx="12" />}
      <rect className="rt-node__box" x={x} y={y} width={NODE_W} height={NODE_H} rx="8" />
      <text className="rt-node__idx" x={x + 10} y={y + 15}>A{index + 1}</text>
      {known && <text className="rt-node__nsi" x={x + NODE_W - 10} y={y + 15} textAnchor="end">● НСИ</text>}
      <text className="rt-node__title" x={x + 10} y={y + (title.length > 1 ? 32 : 38)}>
        {title.map((ln, i) => <tspan key={i} x={x + 10} dy={i ? 15 : 0}>{ln}</tspan>)}
      </text>
      <text className={`rt-node__sub${op.wcType ? '' : ' is-missing'}`} x={x + 10} y={y + NODE_H - 10}>{subLines[0]}</text>
      {mode !== 'time' && <text className="rt-node__time" x={x + NODE_W - 10} y={y + NODE_H - 10} textAnchor="end">{fmtValue(op.timeMin, 'мин')}</text>}
      {mode === 'time' && <text className="rt-node__time rt-node__time--big" x={x + NODE_W - 10} y={y + 38} textAnchor="end">{fmtValue(op.timeMin, 'мин')}</text>}
    </g>
  )
}
