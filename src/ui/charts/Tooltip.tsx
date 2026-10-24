/**
 * Единая подсказка графиков (из `tc__tip` Аналитики — самой зрелой): карточка на `--bg-elevated`,
 * заголовок X, строки «ключ-штрих ряда · имя · значение» — значение главное (жирное, `--text`),
 * имя вторичное. Рисуется внутри SVG через <foreignObject> в пиксельных координатах —
 * без inline-стилей и без масштабирования текста; ширина — по графику (в малых кратных не
 * закрывает весь плот), у правого края переворачивается влево, иначе прижимается к краю.
 */
import type { ReactNode } from 'react'

export interface TipRow {
  key: string
  label: ReactNode
  value: ReactNode
  color?: string
}

interface ChartTooltipProps {
  /** Пиксель X якоря (перекрестие или центр марки) и верх плота. */
  x: number
  y: number
  /** Ширина SVG — для переворота у правого края. */
  width: number
  /** Высота области, в которой подсказка может расти. */
  height: number
  title?: ReactNode
  rows: ReadonlyArray<TipRow>
}

export const TIP_W = 212
const TIP_MIN = 132
const TIP_GAP = 12

/** Ширина подсказки: ≤ 212 px и не больше ~половины графика (малые кратные), но не уже 132 px. */
export function tipWidth(svgWidth: number): number {
  return Math.max(TIP_MIN, Math.min(TIP_W, Math.round(svgWidth * 0.48)))
}

/**
 * Левый край подсказки: справа от якоря; не помещается — слева; не помещается нигде — со стороны,
 * где места больше, прижатая к краю (не на нуле поверх перекрестия).
 */
export function tipLeft(x: number, svgWidth: number, w: number): number {
  if (x + TIP_GAP + w <= svgWidth) return x + TIP_GAP
  if (x - TIP_GAP - w >= 0) return x - TIP_GAP - w
  return svgWidth - x >= x ? Math.max(0, Math.min(x + TIP_GAP, svgWidth - w)) : Math.max(0, Math.min(x - TIP_GAP - w, svgWidth - w))
}

export function ChartTooltip({ x, y, width, height, title, rows }: ChartTooltipProps) {
  const w = tipWidth(width)
  const left = tipLeft(x, width, w)
  return (
    <foreignObject x={left} y={y} width={w} height={Math.max(40, height)} className="ch-tipbox" aria-hidden="true">
      <div className="ch-tip">
        {title !== undefined && <div className="ch-tip__x">{title}</div>}
        {rows.map((r) => (
          <div key={r.key} className="ch-tip__row">
            {r.color && <span className="ch-tip__key" aria-hidden="true"><svg viewBox="0 0 12 4" width="12" height="4"><line x1="0" y1="2" x2="12" y2="2" stroke={r.color} strokeWidth="3" strokeLinecap="round" /></svg></span>}
            <span className="ch-tip__n">{r.label}</span>
            <span className="ch-tip__v num">{r.value}</span>
          </div>
        ))}
      </div>
    </foreignObject>
  )
}
