/**
 * Шапка оси и сетка Ганта (канон APS): два уровня (даты над сменами/часами), подписанные линии
 * «старт плана» и «горизонт Стадии 2», в углу — ручка ширины колонки дорожек (мышь и ←/→).
 * Геометрия (left, width) — данные, поэтому inline; оформление — классы charts.css.
 */
import { useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { hours } from '../../explain/format'
import type { AxisLevels } from './ganttTime'

export const LANE_MIN = 160
export const LANE_MAX = 420
const LANE_KEY_STEP = 16

interface AxisProps {
  levels: AxisLevels
  px: number
  trackW: number
  laneW: number
  onLaneW: (w: number) => void
  dated: boolean
}

export function GanttAxisHead({ levels, px, trackW, laneW, onLaneW, dated }: AxisProps) {
  const drag = useRef<{ x: number; w: number } | null>(null)
  const clamp = (w: number) => Math.max(LANE_MIN, Math.min(LANE_MAX, Math.round(w)))
  const onDown = (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault()
    drag.current = { x: e.clientX, w: laneW }
    const move = (ev: globalThis.MouseEvent) => { if (drag.current) onLaneW(clamp(drag.current.w + ev.clientX - drag.current.x)) }
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const onKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'ArrowLeft') { onLaneW(clamp(laneW - LANE_KEY_STEP)); e.preventDefault() }
    if (e.key === 'ArrowRight') { onLaneW(clamp(laneW + LANE_KEY_STEP)); e.preventDefault() }
  }
  return (
    <div className="pl-gantt__axis">
      <span className="pl-gantt__corner text-caps">
        {dated ? 'дата · время' : 'сутки · часы'}
        <span className="pl-gantt__resize" role="separator" aria-orientation="vertical" aria-label="Ширина колонки дорожек"
          aria-valuemin={LANE_MIN} aria-valuemax={LANE_MAX} aria-valuenow={laneW} tabIndex={0} onMouseDown={onDown} onKeyDown={onKey} />
      </span>
      <span className="pl-gantt__ticks" style={{ width: trackW }}>
        <span className="pl-gantt__lvl pl-gantt__lvl--top">
          {levels.top.map((t) => <span key={`t${t.t}`} className="pl-gantt__tick is-major" style={{ left: t.t * px }}>{t.label}</span>)}
        </span>
        <span className="pl-gantt__lvl pl-gantt__lvl--bottom">
          {levels.bottom.map((t) => <span key={`b${t.t}`} className="pl-gantt__tick" style={{ left: t.t * px }}>{t.label}</span>)}
        </span>
      </span>
    </div>
  )
}

interface GridProps {
  levels: AxisLevels
  px: number
  trackW: number
  span: number
  /** Горизонт Стадии 2, ч (0 — нет). */
  horizon: number
}

/** Сетка и подписанные опорные линии; горизонт за пределами шкалы — подпись у правого края. */
export function GanttGrid({ levels, px, trackW, span, horizon }: GridProps) {
  const showHorizon = horizon > 0
  const inside = showHorizon && horizon <= span
  return (
    <div className="pl-gantt__grid" style={{ width: trackW }} aria-hidden="true">
      {levels.bottom.map((t) => <span key={`b${t.t}`} className="pl-gantt__gl" style={{ left: t.t * px }} />)}
      {levels.top.map((t) => <span key={`t${t.t}`} className="pl-gantt__gl is-major" style={{ left: t.t * px }} />)}
      <span className="pl-gantt__ref pl-gantt__ref--start"><span className="pl-gantt__reflbl">старт плана</span></span>
      {inside && (
        <span className="pl-gantt__ref pl-gantt__ref--horizon" style={{ left: horizon * px }}>
          <span className="pl-gantt__reflbl">горизонт Стадии 2</span>
        </span>
      )}
      {showHorizon && !inside && <span className="pl-gantt__reflbl pl-gantt__reflbl--edge">горизонт Стадии 2: {hours(horizon, 0)} →</span>}
    </div>
  )
}
