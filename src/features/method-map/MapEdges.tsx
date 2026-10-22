/**
 * Рёбра L0 в SVG (UX-V2 §3.3): data — сплошная; param — тонкая с точкой; feedback —
 * пунктир против потока; control — штрих-пунктир сверху (как C в IDEF0); explain —
 * тонкий пунктир. Подпись — на середине кривой, `payload` — в подсказке. Рёбра,
 * касающиеся выбранного/наведённого узла, подсвечиваются, остальные приглушаются.
 */
import type { EdgePath } from './mapLayout'
import type { MapEdgeKind } from './types'

interface MapEdgesProps {
  paths: readonly EdgePath[]
  width: number
  height: number
  focusId: string | null
  onPick: (edgeId: string) => void
}

const KINDS: readonly MapEdgeKind[] = ['data', 'param', 'feedback', 'control', 'explain']

/** Ширина плашки подписи по длине текста (моно-оценка, без измерения DOM). */
const labelWidth = (text: string): number => Math.round(text.length * 6.4 + 14)

export function MapEdges({ paths, width, height, focusId, onPick }: MapEdgesProps) {
  const anyFocus = focusId !== null
  return (
    <svg className="mm-edges" width={width + 80} height={height + 80} viewBox={`-40 -60 ${width + 80} ${height + 80}`} aria-hidden="true" focusable="false">
      <defs>
        {KINDS.map((k) => (
          <marker key={k} id={`mm-arrow-${k}`} className={`mm-marker mm-marker--${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            {k === 'param' ? <circle cx="5" cy="5" r="3" /> : <path d="M 1 1 L 9 5 L 1 9 z" />}
          </marker>
        ))}
      </defs>
      {paths.map(({ edge, d, label, loop }) => {
        const touches = focusId === edge.from || focusId === edge.to
        const cls = `mm-edge mm-edge--${edge.kind}${anyFocus ? (touches ? ' is-lit' : ' is-dim') : ''}${loop ? ' mm-edge--loop' : ''}`
        const text = edge.label ?? ''
        const w = labelWidth(text)
        return (
          <g key={edge.id} className={cls} onClick={() => onPick(edge.id)}>
            <title>{edge.payload ? `${text} · ${edge.payload}` : text}</title>
            <path className="mm-edge__hit" d={d} />
            <path className="mm-edge__line" d={d} markerEnd={`url(#mm-arrow-${edge.kind})`} />
            {text && (
              <g className="mm-edge__label" transform={`translate(${label.x - w / 2}, ${label.y - 9})`}>
                <rect width={w} height={18} rx={4} />
                <text x={w / 2} y={12.5} textAnchor="middle">{text}</text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
