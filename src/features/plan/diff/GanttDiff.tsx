/**
 * Диф Ганта «как диф кода» (UX-V2 §4.8): на станок — две синхронные дорожки (до / после) или одна
 * («До», «После»); изменённые дорожки первыми и подсвечены, неизменённые можно скрыть.
 * Классы полос: удалено — киноварный штрих, полупрозрачно; добавлено — вердигрис; перенесено —
 * охра с пунктирной стрелкой «откуда → куда» (в пределах станка) или подписью «← станок»;
 * заморожено — контур и замок. Цвет полосы — та же палитра изделий (buildPalette), подсказка —
 * та же GanttTip, ось — те же тики (ganttModel). Рисуется в SVG: геометрия — атрибуты, не стили.
 */
import { useMemo, useState, type MouseEvent } from 'react'
import { hours } from '../../../explain/format'
import { fmtTickDate, isMajorTick, makeTicks, niceStep, type Palette } from '../ganttModel'
import { GanttTip, slotClass } from '../GanttParts'
import { useMeasuredWidth } from '../../../ui/charts'
import type { DiffBar, DiffLane, ScheduleDiff } from './diffModel'
import { DIFF_KIND_LABEL } from './diffModel'

const LANE_W = 196
const SUB_H = 22
const AXIS_H = 24
const MIN_BAR = 2
const LABEL_MIN = 40
/** Средняя ширина символа 11 px шрифта — подпись обрезается по ширине полосы (SVG-текст не клипуется сам). */
const CHAR_W = 6.4

export function fitLabel(text: string, width: number): string {
  const max = Math.floor((width - 8) / CHAR_W)
  if (max <= 1) return ''
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

export type DiffMode = 'diff' | 'before' | 'after'

interface Props {
  diff: ScheduleDiff
  mode: DiffMode
  palette: Palette
  start: Date | null
  showUnchanged: boolean
  /** Ключ текущего изменения (j/k) и выбранный ход — подсветка. */
  currentKey: string | null
  selectedMove: string | null
  onPick: (key: string | null, moveId: string | undefined) => void
  /** Подпись хода по id (для подсказки). */
  moveName: (id: string) => string
}

interface Hover { x: number; y: number; bar: DiffBar }

export function GanttDiff({ diff, mode, palette, start, showUnchanged, currentKey, selectedMove, onPick, moveName }: Props) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>(960)
  const [hover, setHover] = useState<Hover | null>(null)
  const lanes = useMemo(() => diff.lanes.filter((l) => showUnchanged || l.changed), [diff.lanes, showUnchanged])
  const trackW = Math.max(320, width - LANE_W - 4)
  const px = trackW / diff.makespan
  const step = niceStep(diff.makespan, trackW)
  const ticks = makeTicks(diff.makespan, step)
  const both = mode === 'diff'

  return (
    <div ref={wrapRef} className="gd" onMouseLeave={() => setHover(null)}>
      <div className="gd-axis">
        <span className="gd-corner text-caps">{start ? 'дата' : 'часы'}</span>
        <svg className="gd-ticks" width={trackW} height={AXIS_H} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t} className={isMajorTick(t, step) ? 'is-major' : undefined} transform={`translate(${t * px},0)`}>
              <line y1={0} y2={AXIS_H} />
              <text x={4} y={AXIS_H / 2 + 4}>{fmtTickDate(t, step, start)}</text>
            </g>
          ))}
        </svg>
      </div>
      {lanes.length === 0 && <p className="pl-note gd-empty">Изменённых дорожек нет: принятые ходы не меняют расписание (например, транш) или решения ещё не приняты.</p>}
      {lanes.map((lane) => (
        <LaneRow key={lane.machineId} lane={lane} both={both} mode={mode} trackW={trackW} px={px} ticks={ticks} step={step}
          palette={palette} currentKey={currentKey} selectedMove={selectedMove} onPick={onPick}
          onHover={(e, bar) => setHover(bar ? { x: e.clientX, y: e.clientY, bar } : null)} />
      ))}
      {hover && <DiffTip hover={hover} palette={palette} moveName={moveName} />}
    </div>
  )
}

interface LaneProps {
  lane: DiffLane
  both: boolean
  mode: DiffMode
  trackW: number
  px: number
  ticks: number[]
  step: number
  palette: Palette
  currentKey: string | null
  selectedMove: string | null
  onPick: Props['onPick']
  onHover: (e: MouseEvent, bar: DiffBar | null) => void
}

function LaneRow({ lane, both, mode, trackW, px, ticks, step, palette, currentKey, selectedMove, onPick, onHover }: LaneProps) {
  const rows: Array<{ key: 'before' | 'after'; bars: DiffBar[] }> = both
    ? [{ key: 'before', bars: lane.before }, { key: 'after', bars: lane.after }]
    : [{ key: mode === 'before' ? 'before' : 'after', bars: mode === 'before' ? lane.before : lane.after }]
  const h = rows.length * SUB_H
  return (
    <div className={`gd-lane${lane.changed ? ' is-changed' : ''}`}>
      <div className="gd-lane__label" title={`${lane.wcName} · ${lane.name}`}>
        <span className="gd-lane__name">{lane.name}</span>
        <span className="gd-lane__wc">{lane.wcName}</span>
        {both && <span className="gd-lane__sub" aria-hidden="true"><i>до</i><i>после</i></span>}
      </div>
      <svg className="gd-track" width={trackW} height={h} role="img"
        aria-label={`${lane.name}: ${lane.changed ? 'есть изменения' : 'без изменений'}; до ${lane.before.length}, после ${lane.after.length} операций`}>
        <defs>
          <marker id={`gd-arrow-${lane.machineId}`} className="gd-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 1 1 L 9 5 L 1 9 z" />
          </marker>
        </defs>
        {ticks.map((t) => <line key={t} className={`gd-grid${isMajorTick(t, step) ? ' is-major' : ''}`} x1={t * px} x2={t * px} y1={0} y2={h} />)}
        {both && <line className="gd-split" x1={0} x2={trackW} y1={SUB_H} y2={SUB_H} />}
        {rows.map((row, ri) => (
          <g key={row.key} transform={`translate(0,${ri * SUB_H})`}>
            {row.key === 'after' && row.bars.filter((b) => b.kind === 'moved' && b.from && b.from.machine_id === lane.machineId).map((b) => (
              <g key={`ghost-${b.bar.job_idx}`} className="gd-ghost">
                <rect x={b.from!.start * px} y={4} width={Math.max(MIN_BAR, (b.from!.end - b.from!.start) * px)} height={SUB_H - 8} rx={3} />
                <line x1={b.from!.end * px} y1={SUB_H / 2} x2={Math.max(b.from!.end * px + 6, b.bar.start * px - 2)} y2={SUB_H / 2}
                  markerEnd={`url(#gd-arrow-${lane.machineId})`} />
              </g>
            ))}
            {row.bars.map((b) => {
              const key = `${b.kind}:${b.bar.job_idx}`
              const x = b.bar.start * px
              const w = Math.max(MIN_BAR, (b.bar.end - b.bar.start) * px)
              const cls = ['gd-bar', slotClass(palette.slotOf(b.bar.product_id)), `gd-bar--${b.kind}`,
                currentKey === key ? 'is-current' : '', b.moveId && b.moveId === selectedMove ? 'is-selected' : ''].filter(Boolean).join(' ')
              const crossLane = b.kind === 'moved' && row.key === 'after' && b.from && b.from.machine_id !== lane.machineId
              const label = crossLane ? `← ${b.from!.machine_name}` : b.kind === 'frozen' ? `■ ${b.bar.op_name}` : b.bar.op_name
              return (
                <g key={`${row.key}-${b.bar.job_idx}`} className={cls}
                  onMouseMove={(e) => onHover(e, b)} onMouseLeave={(e) => onHover(e, null)}
                  onClick={() => onPick(b.kind === 'same' ? null : key, b.moveId)}>
                  <rect x={x} y={4} width={w} height={SUB_H - 8} rx={3} />
                  {w > LABEL_MIN && <text x={x + 5} y={SUB_H / 2 + 4} className="gd-bar__label">{fitLabel(label, w)}</text>}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}

function DiffTip({ hover, palette, moveName }: { hover: Hover; palette: Palette; moveName: (id: string) => string }) {
  const b = hover.bar
  const extra: Array<[string, string]> = [['Изменение', DIFF_KIND_LABEL[b.kind]]]
  if (b.from) extra.push(['Было', `${b.from.machine_name} · ${hours(b.from.start, 1)}–${hours(b.from.end, 1)}`])
  if (b.moveId) extra.push(['Ход', moveName(b.moveId)])
  return <GanttTip bar={b.bar} x={hover.x} y={hover.y} palette={palette} extra={extra} />
}
