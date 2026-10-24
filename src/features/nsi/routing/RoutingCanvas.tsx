/**
 * Канвас маршрута (X1 §2.1, P-51/P-52): узлы — общие карточки `.gc-node` в HTML-слое граф-канваса
 * (доступны клавиатуре и диктору, текст переносится сам), рёбра — SVG (материальный поток, --chart-1).
 * Раскладка «змейкой» подбирается по ширине и высоте канваса так, чтобы при «вписать» масштаб был ≈ 1
 * (заголовки ≥ 12 px); если и так не помещается — вписывается по ширине, остальное — вертикальным сдвигом.
 * Узкое место по мощности — нейтральное кольцо и слово; тип не из Справочников — чип ▲ (только исключение).
 */
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { GraphCanvas, type GraphCanvasHandle } from '../../../ui/graph-canvas'
import { wrapLabel } from '../../../ui/charts/scale'
import { fmtValue, num, plural, NBSP } from '../../../explain/format'
import { Chip } from '../../../ui/kit'
import type { CapacityBottleneck, RoutingOp } from './routingModel'

export type CanvasMode = 'io' | 'wc' | 'time'

export const NODE_W = 196
export const NODE_H = 84
const GAP = 72
const STEP = NODE_W + GAP
const ORIGIN_X = 110
const ORIGIN_Y = 110
const STUB = 44
const MAX_PER_ROW = 6
const PAD = 48
const PAD_BOTTOM = 56
const TARGET_ZOOM = 1
const SIDE = 170 // поле слева/справа под подписи входа и выхода

interface Layout { perRow: number; rows: number; pitch: number }

const pitchOf = (mode: CanvasMode) => NODE_H + (mode === 'io' ? (STUB + 40) * 2 : 72)
const topOf = (mode: CanvasMode) => (mode === 'io' ? STUB + 36 : 16)
const bottomOf = (mode: CanvasMode) => (mode === 'io' ? STUB + 36 : 32)

function boundsOf(n: number, mode: CanvasMode, l: Layout) {
  const cols = Math.min(n || 1, l.perRow)
  const top = topOf(mode)
  return {
    x: ORIGIN_X - SIDE / 2 - 30, y: ORIGIN_Y - top,
    w: (cols - 1) * STEP + NODE_W + SIDE,
    h: (l.rows - 1) * l.pitch + NODE_H + top + bottomOf(mode),
  }
}

/**
 * Раскладка: число узлов в ряду, при котором масштаб «вписать» ближе всего к 1 (не больше — нет смысла
 * раздувать); без размера канваса — сбалансированные ряды по ≤ 4 (8 → 4+4, 5 → 3+2).
 */
export function layoutFor(n: number, mode: CanvasMode, size?: { w: number; h: number }): Layout {
  const pitch = pitchOf(mode)
  const make = (perRow: number): Layout => ({ perRow, rows: Math.max(1, Math.ceil(n / perRow)), pitch })
  if (!size || size.w <= 0 || size.h <= 0 || n <= 1) {
    const rows = Math.max(1, Math.ceil(n / 4))
    return make(Math.max(1, Math.ceil(n / rows)))
  }
  let best = make(1)
  let bestScore = -1
  for (let p = 1; p <= Math.min(n, MAX_PER_ROW); p++) {
    const l = make(Math.ceil(n / Math.ceil(n / p))) // сбалансированные ряды
    const b = boundsOf(n, mode, l)
    const k = Math.min((size.w - PAD * 2) / b.w, (size.h - PAD - PAD_BOTTOM) / b.h)
    const score = Math.min(k, TARGET_ZOOM + 0.15)
    if (score > bestScore + 1e-3 || (Math.abs(score - bestScore) <= 1e-3 && l.perRow > best.perRow)) { best = l; bestScore = score }
  }
  return best
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
  knownWc: ReadonlySet<string> | null
  bottleneck: CapacityBottleneck | null
  onSelect: (id: string | null) => void
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}

export const bottleneckText = (b: CapacityBottleneck): string =>
  b.machines > 0
    ? `узкое место по мощности · ${fmtValue(b.minutes, 'мин')} / ${num(b.machines, 0)}${NBSP}${plural(b.machines, ['станок', 'станка', 'станков'])}`
    : `узкое место по мощности · ${fmtValue(b.minutes, 'мин')}, станков этого типа нет`

export const RoutingCanvas = forwardRef<GraphCanvasHandle, RoutingCanvasProps>(function RoutingCanvas(
  { ops, selectedId, mode, fitToken, knownWc, bottleneck, onSelect, onKeyDown }, ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = ops.length
  const layout = useMemo(() => layoutFor(n, mode, size), [n, mode, size])
  // Новая раскладка — вписать заново (кнопка «вписать» снаружи тоже приходит сюда).
  const [tick, setTick] = useState(0)
  useEffect(() => { setTick((t) => t + 1) }, [layout.perRow, layout.rows, mode])

  const full = boundsOf(n, mode, layout)
  // «Вписать» не мельче 1: если весь маршрут не влезает, вписываем верх, а ниже — вертикальный сдвиг.
  const kWidth = size.w > 0 ? (size.w - PAD * 2) / full.w : TARGET_ZOOM
  const kFit = Math.min(TARGET_ZOOM, kWidth)
  const maxH = size.h > 0 ? (size.h - PAD - PAD_BOTTOM) / kFit : full.h
  const fitBounds = { ...full, h: Math.min(full.h, Math.max(NODE_H + 40, maxH)) }

  return (
    <div className="rt-canvas-wrap" ref={wrapRef}>
      <GraphCanvas
        ref={ref}
        bounds={fitBounds}
        fitToken={fitToken + tick}
        pad={PAD}
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
                <text x={ORIGIN_X + NODE_W / 2} y={ORIGIN_Y + NODE_H + 22} textAnchor="middle" className="rt-empty__hint">кнопкой «+ Операция» над канвасом</text>
              </g>
            )}
            <FlowEdges ops={ops} mode={mode} layout={layout} />
          </>
        }
      >
        {ops.map((op, i) => (
          <Node key={op.id} op={op} index={i} layout={layout} mode={mode} selected={op.id === selectedId}
            bottleneck={n > 1 && bottleneck?.id === op.id ? bottleneck : null}
            known={!op.wcType || !knownWc || knownWc.has(op.wcType)} onSelect={onSelect} />
        ))}
      </GraphCanvas>
    </div>
  )
})

/** Рёбра материального потока + внешний вход/выход; переход между рядами — «колено»; в режиме «Входы/выходы» — стрелки C/M. */
function FlowEdges({ ops, mode, layout }: { ops: ReadonlyArray<RoutingOp>; mode: CanvasMode; layout: Layout }) {
  const n = ops.length
  if (n === 0) return null
  const cy = (i: number) => posY(i, layout) + NODE_H / 2
  const first = ops[0]
  const last = ops[n - 1]
  const inText = first.inputs.length ? first.inputs.map((m) => `${m.name} ×${fmtValue(m.qty)}`).join(', ') : first.inputsKnown ? 'вход' : 'входы — в Справочниках'
  const outText = last.outputs.length ? last.outputs.join(' + ') : 'выход'
  const lastRight = posX(n - 1, layout) + NODE_W
  return (
    <g className="rt-edges">
      <line x1={ORIGIN_X - 70} y1={cy(0)} x2={ORIGIN_X - 2} y2={cy(0)} className="rt-edge" markerEnd="url(#rt-arrow)" />
      <Label x={ORIGIN_X - 72} y={cy(0) - 12} text={inText} anchor="start" max={16} cls="rt-edge__label" />
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
      <Label x={lastRight + 4} y={cy(n - 1) - 12} text={outText} anchor="start" max={16} cls="rt-edge__label" />
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

/** PERT-подпись: «25–63 · PERT», если время не детерминированное. */
export function pertText(op: Pick<RoutingOp, 'timeMin' | 'tOpt' | 'tPess'>): string {
  return op.tOpt !== op.timeMin || op.tPess !== op.timeMin ? `${num(op.tOpt, 0)}–${num(op.tPess, 0)} · PERT` : ''
}

interface NodeProps {
  op: RoutingOp
  index: number
  layout: Layout
  mode: CanvasMode
  selected: boolean
  bottleneck: CapacityBottleneck | null
  known: boolean
  onSelect: (id: string) => void
}

/** Карточка операции: «A n» и метка узкого места, название (≤ 2 строк), строка режима и время. */
function Node({ op, index, layout, mode, selected, bottleneck, known, onSelect }: NodeProps) {
  const style = { left: posX(index, layout), top: posY(index, layout), width: NODE_W, height: NODE_H } as CSSProperties
  const cls = ['gc-node', 'rt-node', selected ? 'is-selected' : '', bottleneck ? 'is-bottleneck' : '', op.wcType ? '' : 'is-invalid'].filter(Boolean).join(' ')
  const time = fmtValue(op.timeMin, 'мин')
  const pert = pertText(op)
  const sub = mode === 'time' ? (pert || 'норма') : op.wcType || 'тип станка не задан'
  return (
    <div
      className={cls}
      style={style}
      data-gc-node="true"
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`Операция ${index + 1}: ${op.title}, ${op.wcType || 'без типа станка'}, ${time}${bottleneck ? `, ${bottleneckText(bottleneck)}` : ''}`}
      title={`${op.title}\n${op.wcType || 'тип станка не задан'} · ${time}${pert ? ` (${pert})` : ''}${bottleneck ? `\n${bottleneckText(bottleneck)}` : ''}`}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(op.id) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(op.id) } }}
    >
      <span className="rt-node__head">
        <span className="rt-node__idx mono">A{index + 1}</span>
        {bottleneck && <span className="rt-node__tag">узкое место</span>}
      </span>
      <span className="rt-node__title">{op.title || 'Операция'}</span>
      <span className="rt-node__foot">
        {known ? (
          <span className={`rt-node__sub${op.wcType ? '' : ' is-missing'}`}>{sub}</span>
        ) : (
          <Chip tone="setup" size="sm" className="rt-node__chip" title={`«${op.wcType}» нет в реестре «Типы оборудования»`}>тип не найден в Справочниках</Chip>
        )}
        {mode !== 'time' && <span className="rt-node__time mono">{time}</span>}
        {mode === 'time' && <span className="rt-node__time rt-node__time--big mono">{time}</span>}
      </span>
    </div>
  )
}
